# CI and deployment

Port repositories build their version trees and publish to their own prefixes.
The shared shell publishes root pages, navigation and manifests. Java owns its
Kotlin and Scala prefixes; .NET owns F#. `site/src/lib/ports.ts` defines the
repositories, callers and ownership flags.

Each caller pins the builder and publisher to the same full commit SHA. The
builder resolves the requested source ref and assembles the version tree. The
publisher checks the artifact and its provenance before requesting AWS
credentials. A port's IAM role independently limits its writable prefixes and
accepted publisher revisions.

Callers pass the role and bucket secrets explicitly. The optional distribution
secret remains accepted for older callers; port publication does not use it.

## Which repos call `reusable-deploy.yml`

The current ownership split is:

| Port | Built by | Tree ownership (`ports.ts`) |
|---|---|---|
| Rust (`rs`) | `port-docs.yml` | `publishesOwnTree` |
| TypeScript (`ts`) | `port-docs.yml` | `publishesOwnTree` |
| Go (`go`) | `port-docs.yml` | `publishesOwnTree` |
| Java (`java`) | `port-docs.yml` | `publishesOwnTree` |
| .NET (`dotnet`) | `port-docs.yml` | `publishesOwnTree` |
| C++ (`cxx`) | `port-docs.yml`, with Doxygen XML | `publishesOwnTree` |
| Swift (`swift`) | `port-docs.yml`, with the symbol graph | `publishesOwnTree` |
| Ruby (`ruby`) | its own exporter | `publishesOwnTree` |
| Lua (`lua`) | its own exporter | `publishesOwnTree` |
| Python (`py`) | its own Sphinx build | `publishesOwnApi`; the shell publishes the rest |

Python's reviewed caller branch can build and publish a complete tree, but its
ownership flag still lets the shell publish the non-API pages. Migrating that
flag and the corresponding shell IAM policy remains necessary before Python
has exclusive ownership of its whole tree.

## Version, prefix and cache policy

`reusable-deploy.yml`'s `version-kind` input is a
`site/src/lib/versions.ts` `VersionKind`. It alone decides caching — a
caller states what it built, this workflow decides how it is served, so a
caller cannot hand an immutable tag a five-minute TTL by copy-paste:

| `version-kind` | Example `path-prefix` | Cache-Control |
|---|---|---|
| `tag` | `py/v0.46.2` | `public, max-age=31536000, immutable` |
| `trunk` | `py/latest` | `public, max-age=0, s-maxage=300` |
| `branch` | `py/v0.x` | `public, max-age=0, s-maxage=300` |
| `alias` | `py/stable` | `public, max-age=0, s-maxage=300` |
| `pr` | `ruby/pr-42` | `public, max-age=0, s-maxage=300` |

No column for invalidation, because this workflow issues none. Every mutable
prefix above carries `s-maxage=300`, so the edge picks up a republish within
five minutes by itself, and an immutable tag prefix never changes at all —
an invalidation there would clear a cache entry that was already correct.
The one path still invalidated is each locale's landing page, by
`deploy-shell.yml`, because it is what a person reloads immediately after a
deploy. The origin root `/` is not among them: the edge function answers it
per request, so CloudFront never caches it — it returns
`x-cache: FunctionGeneratedResponse` every time — and invalidating a URL that
is generated rather than stored clears nothing.

A tag push on a port repo normally calls `reusable-deploy.yml` twice — once
with `version-kind: tag` at the immutable prefix, once more with
`version-kind: alias` at `stable` if that tag becomes the new default — since
`/stable/` and `/latest/` are separate builds with their own base path and
canonical URL, never edge rewrites of the tag's bytes. The second call adds
`resolves-to` so the manifest entry carries `VersionEntry.resolvesTo`:

```yaml
    with:
      path-prefix: py/stable
      artifact: docs-html-stable
      version-kind: alias
      port: py
      version: stable
      resolves-to: v0.46.2
      is-default: true
      environment: docs
```

The prefix a caller passes is its own — `py/stable`, `py/v0.46.2` — and the
workflow prepends the locale before writing, so those objects land at
`en/py/stable` and `en/py/v0.46.2`. That is applied on this side rather than
asked of the caller because the caller is each port's own repository, and
moving a segment would otherwise be a coordinated edit across ten of them. A
pull-request preview keeps its own shape: it owns its whole prefix and nests
the site inside it.

`path-prefix` is validated inside the reusable workflow: non-empty, no
leading or trailing slash, no `..` segment, and never a bare reserved name
(`py`, `ruby`, `lua`, `ts`, `rs`, `go`, `java`, `dotnet`, `cxx`, `swift`, `manifest`,
`_shell`) — a caller cannot `sync --delete` an entire language root even by
mistake, because that path never validates.

## The manifest

Each self-hosted port owns exactly one manifest key,
`manifest/<port>.json`, written only by that port's own OIDC role — there is
nothing to race on across repositories, only within one repo's own retries.
`reusable-deploy.yml`'s manifest step (run when `port` is set) reads the
current document, upserts one `VersionEntry`-shaped record keyed by `slug`
into `.ports[port]` — adding `resolvesTo` when `version-kind` is `alias` and
the caller passed `resolves-to` — and writes it back with a conditional PUT:

```console
$ aws s3api put-object \
    --bucket libtmux-docs \
    --key manifest/py.json \
    --body fragment.json \
    --content-type application/json \
    --if-match "$ETAG"
```

The document and ETag come from the same GET. Only a 404 or `NoSuchKey`
response starts an empty manifest; permission, throttling, and network errors
fail the step with their original diagnostics and exit status.

`aws s3api put-object` is required here, not `aws s3 cp`/`sync` — neither
exposes `--if-match`/`--if-none-match`. A 412 means another run of the same
port's own workflow raced this one; the step re-reads and retries up to
three times before failing loudly. This is a backstop, not the correctness
mechanism — correctness comes from the manifest key being exclusive to one
port's role in the first place.

The next shell publication validates and merges all such fragments into each
locale's runtime `versions.json`. Both switchers read that file. A port upload
therefore makes a version eligible for the next shell/search publication; it
does not claim that shared Pagefind or the sitemap changed in the port job.

## Port build provenance

The shared `port-docs.yml` builder writes `build-provenance.json` inside each
version tree. Every HTML page links to it with `rel="describedby"`. The record
contains the actual source checkout HEAD, the docs checkout HEAD, each
checkout's dirty state, and a sorted SHA-256 inventory of every regular file.
Python also records the separate workspace and MCP source checkouts. Only the
record itself is excluded from the inventory; symlinks are rejected.

The shared builder snapshots inputs before native generators run and rechecks
their Git HEADs when assembly starts. Source-bound local builds capture dirty
state **before** generators update API models. They can be previewed, but the publisher rejects dirty inputs. Full
local assemblies without a selected source checkout make no provenance claim.
Run IDs and timestamps are excluded from the version tree so an identical
immutable rerun can produce identical bytes.

Selected-source builds also capture MCP contracts from the selected product's
runtime. The shared job installs its language tools before assembly: Rust and
Swift use the checkout's exact toolchain version, Go its MCP module, Bun its
package manifest, and .NET its `global.json`. Java uses the repository's JDK 25
baseline and validates the Gradle wrapper. Python installs the separate MCP
checkout's frozen lock into that checkout's virtual environment. Ruby installs
its selected locked bundle. These installations follow the input snapshot;
missing tools or contracts fail the build. Wrapper languages and Lua have no
MCP runtime and are excluded through the product catalog.

The job runs on Ubuntu 24.04 with a 30-minute limit and no restored dependency
caches. C++ uses that distribution's Clang 18/libc++ packages and the source's
compiler checks. Locked dependencies and selected toolchains constrain the
build, but the hosted image and system package updates are not byte-pinned.
Runtime capture requests advertised contracts only; the builder has no AWS
credentials or OIDC permission. Each port still needs a cold hosted build to
establish its runtime cost and compatibility.

After uploading the content artifact, the builder uploads a separate
`<artifact>-publication` descriptor containing its artifact ID, archive digest,
source SHA, repository, run ID, and attempt. The publisher uses the existing
same-run artifact token; callers do not need `actions: read`. It downloads the
exact ID, fails on GitHub digest mismatches, checks the downloaded ZIP against
the descriptor digest, and rejects unsafe archive paths before extraction.
The current run may reuse a completed earlier build attempt.

Before requesting AWS credentials, the publisher verifies repository ownership,
port/version/locale, clean inputs, source SHA, every content byte, and equality
between the builder's docs SHA and the publisher's own workflow SHA. Native
shell URL normalization runs before hashing and again during verification;
any later byte change fails the inventory check.

This contract requires **GitHub Cloud**. Its documented
[`job.workflow_repository` and `job.workflow_sha` contexts](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#example-usage-of-job-context-workflow-identity)
identify the called reusable workflow. Both workflows reject absent contexts or
a non-full SHA before checkout; GitHub Enterprise Server is not supported by
this contract. `github.workflow_sha` identifies the caller and is unsuitable.

After a successful sync, `manifest/<port>.json` records the build-record digest
and URL, artifact ID/name/digest, builder run/attempt, publisher SHA, and site
destination. The next shell publish preserves these receipts in `versions.json`.
The artifact may expire; its ID and digest remain in the receipt, and the
version's file inventory remains on the site.

For an identical immutable rerun, the publisher preserves the original receipt
and reports verification in the job summary. If those same bytes have no prior
receipt, `operation: verified-existing` describes the **current verification**;
it does not identify the original publisher. An older immutable tree without
`build-provenance.json` differs from the new artifact and fails visibly. The
publisher never adds metadata to an existing immutable tree.

This is a build and publication trace, not an attestation of which workflow
produced a caller-supplied artifact. IAM's reviewed-workflow boundary is a
separate control. Ruby/Lua custom builders and shared-root artifacts still need
their own caller migration and run evidence before claiming this contract.

## Opting in a port repo

### With `port-docs.yml`

A port whose reference this repository can build from source calls two
reusable workflows, pinned to one commit approved by its IAM trust policy. `port-docs.yml` decides which
versions the event builds and builds each from the port's source, checking
out this repository at its own commit (`job.workflow_sha`), so the caller
never pins it twice. `reusable-deploy.yml` publishes each version:

```yaml
jobs:
  build:
    uses: libtmux/docs/.github/workflows/port-docs.yml@<sha>
    with:
      port: rs
      tag-prefix: libtmux@  # stripped from a release tag; omit when tags are bare
      source-ref: ${{ inputs.source-ref }}
      version: ${{ inputs.version }}
      version-kind: ${{ inputs.version-kind }}
      is-default: ${{ inputs.is-default == true }}
      resolves-to: ${{ inputs.resolves-to }}
      publish: ${{ inputs.publish == true }}

  publish:
    needs: build
    if: needs.build.outputs.should-publish == 'true'
    concurrency: { group: 'docs-deploy-${{ github.repository }}', queue: max }
    strategy:
      fail-fast: false
      matrix: ${{ fromJSON(needs.build.outputs.matrix) }}
    permissions: { contents: read, id-token: write }
    uses: libtmux/docs/.github/workflows/reusable-deploy.yml@<sha>
    with:
      path-prefix: rs/${{ matrix.version }}
      artifact: docs-rs-${{ matrix.version }}
      version-kind: ${{ matrix.kind }}
      port: rs
      version: ${{ matrix.version }}
      is-default: ${{ matrix.isDefault }}
      resolves-to: ${{ matrix.resolvesTo }}
      environment: docs
    secrets:
      role-arn: ${{ secrets.LIBTMUX_DOCS_ROLE_ARN }}
      bucket: ${{ secrets.LIBTMUX_DOCS_BUCKET }}
```

The events it answers (`scripts/port-docs-identity.sh`):

- A pull request builds `latest` at its merge commit and publishes nothing.
- A push to the default branch publishes `latest`. It is the default only
  until the port's first stable release tag.
- A release tag publishes its version plus `next` (prerelease) or `stable`
  (release, the default).
- A dispatch publishes exactly what it names, at any ref. From the port's
  checkout:

  ```console
  $ gh workflow run docs.yml \
      --ref master \
      -f source-ref=libtmux@v0.1.0-alpha.14 \
      -f version=v0.1.0-alpha.14 \
      -f version-kind=tag \
      -f publish=true
  ```

  Use the caller branch configured in `ports.ts`. Its `docs` environment must
  admit that branch; the selected source ref is independent of the caller ref.

Set `publishesOwnTree` for the port in `site/src/lib/ports.ts` once it
publishes this way, or every shell deploy overwrites its `latest` tree.

### Publishing several ports at once

`publish.yml` dispatches each selected port through the reviewed caller in
`ports.ts` and waits for it. The catalog selects the workflow file and caller
branch independently of the source ref. Python uses `docs.yml` on
`docs-site-deploy`; `latest` still builds the core repository's `master`.
Other ports use their default branch unless the catalog names a caller branch.
A caller branch must be allowed by the port's docs environment.

The dispatcher plans first and stops there by default:

| `ports` | `ref` | Publishes |
|---|---|---|
| `all` or a list | `latest` | each default branch as `latest` |
| `all` or a list | `release` | each newest release tag, plus `next` or `stable` |
| one port | an exact ref | that ref, as `version` and `version-kind` name it |

```console
$ gh workflow run publish.yml \
    --repo libtmux/docs \
    -f ports=all \
    -f ref=release \
    -f dry-run=false
```

Kotlin and Scala dispatch through the Java repository; F# dispatches through
.NET. The dispatcher selects one language per leg, so `ports=kotlin` builds
only Kotlin and `ports=all` publishes each family member once. Siblings
share one repository lookup for their default branch and release tags.

For all ports in one run, install the `libtmux-docs-publisher` GitHub App on
the selected repositories in both `libtmux` and `tmux-python`. Set
`LIBTMUX_DOCS_APP_ID` and `LIBTMUX_DOCS_APP_KEY` on this repository. Each leg
requests an Actions-write installation token for its owner and one repository.
The dispatcher has no AWS identity. A `LIBTMUX_DOCS_DISPATCH_TOKEN` fallback
works for the repositories that token can access; a fine-grained token is
limited to one resource owner.

The workflow waits for each port's run and the final shell refresh, so success
includes the `versions.json` update. Its summary shows the caller, source and
child run. A failed dispatch, port publication or shell refresh fails the
initiating run and prints the failed steps. Each waiting job has a 45-minute
limit.

### With its own toolchain

A custom builder must produce the same assembled tree and publication
metadata as `port-docs.yml`. Its native exporter output alone is insufficient.
Ruby and Lua still use their existing custom-builder contract; migrate their
callers before selecting this publisher revision.

The required sequence is:

1. Check out the approved docs SHA and the selected port source. Snapshot
   their identities before generators write files.
2. Assemble `<locale>/<port>/<version>` with the selected source revision,
   including `build-provenance.json` and its complete file inventory.
3. Upload the version directory with hidden files included and empty uploads
   rejected. Create a separate publication descriptor from the upload's
   artifact ID and digest, source SHA, run ID and attempt.
4. Upload that descriptor as `<artifact>-publication`, then call
   `reusable-deploy.yml` at the same approved docs SHA.

The shared builder is the executable example for this sequence. Custom
builders must verify their output through the publisher before migration.
Python's native Sphinx reference must be included; other ports whose `api/`
route redirects to the shared reference can use `--skip-refs`.

### Caller configuration

Each caller needs:

- A concurrency group covering its repository's publications, with
  `queue: max`. Keep family publications serialized where they share a
  manifest or role. Do not combine queued publication with cancellation.
- An OIDC role whose trust policy admits the repository, environment and
  explicit reviewed publisher SHAs. Object writes and bucket listing must
  stay inside its locale/port or family prefixes and manifest keys. Port
  roles do not need CloudFront invalidation permission.
- A `docs` environment whose deployment policy admits the intended caller
  branches and tags. Pass its name through the reusable workflow's
  `environment` input: the called publishing job obtains the OIDC token.
- Repository- or organization-level role and bucket secrets. A calling
  `uses:` job cannot declare `environment:`, so Environment-scoped secrets
  are unavailable when that job passes them to the reusable workflow.

Add a new publisher SHA to the IAM allowlist before updating caller pins.
Retain the previous SHA until its callers have migrated and their runs pass.
A branch or tag containing the publisher is insufficient for role assumption.

## This repo's own deploy (`deploy-shell.yml`)

The shell has no versioned URL space: the bucket root is always "whatever's
on trunk," never `/latest/` or `/stable/` the way a port's prefix is. A tag
on this repo is a release marker for this repo's own history and deploys to
the same root a trunk push does — not a second prefix. Release branches are
a per-port version concept (`versions.ts`'s `'branch'` kind, e.g. `v0.x`)
with no shell equivalent, so `deploy-shell.yml` has no branch trigger beyond
the default branch.

Triggers and jobs:

| Trigger | Job | Target |
|---|---|---|
| push to `main` | `registry` → `build` → `publish-root` | bucket root, `docs` environment |
| push tag `v*` | `registry` → `build` → `publish-root` | bucket root (same as trunk) |
| `schedule` (four times an hour), `workflow_dispatch` | `registry`, then `build` → `publish-root` when the registry moved (dispatch always rebuilds) | bucket root |
| `pull_request`, same-repo head | `build` → `publish-preview` | `pr-<n>/`, `docs-preview` environment |
| `pull_request`, fork head | `build` only | no publish — see below |

`registry` resolves `site/src/data/registry.json` against the live package
registries, falling back to the `/registry.json` the last deploy published,
and hands the result to every locale's build; `publish-root` then publishes
it. Install commands therefore follow a port's release within the hour with
no commit here. A pull request builds from the committed file, so its result
depends only on the commit.

`publish-root` cannot simply call `reusable-deploy.yml`: production output
spans several top-level directories (the `docs` content collection's own
routes, and `/ja/` once translated shell prose lands), not one exclusive
prefix, and the bucket root is shared with all ten language prefixes this
repo must never touch. Instead it lists `dist/`'s top-level entries, fails
the run if any collides with a reserved language/manifest name, `sync
--delete`s each surviving directory individually, and `cp`s (no `--delete`)
the handful of root-level files — the workflow-level twin of the IAM
`NotResource` policy that should back it, so a bug here fails the run rather
than depending on IAM alone.

`publish-preview` fits `reusable-deploy.yml` cleanly: `pr-<n>/` is an
exclusive prefix like any port's, so it calls the same reusable workflow with
`version-kind: pr` and no `port` (no manifest entry for a preview).
Only callers from `libtmux/docs` or `tony/libtmux-docs` may omit `port`.
Every other caller must supply a port and pass its repository ownership,
artifact, and build provenance checks before obtaining AWS credentials.

### Fork PRs: build-only, no `workflow_run` handoff — for now

Fork PRs get no secrets on `pull_request` by design; `pull_request_target`
with a checkout of PR content is the documented foot-gun this avoids
entirely — this repo never checks out PR code under `pull_request_target`.
The two options considered:

1. **Build-only on forks** (chosen): the `build` job runs unconditionally —
   with no OIDC and no secrets in scope regardless of who owns the PR head —
   and `publish-preview`'s `if` gates on
   `github.event.pull_request.head.repo.full_name == github.repository`. A
   fork PR gets a green build check and no preview URL.
2. **`workflow_run` handoff**: a `pull_request` build with no secrets
   uploads an artifact; a separate workflow, triggered by `workflow_run` and
   so running from the default branch in this repo's own trust context,
   downloads it by run ID and publishes to a preview-only role and prefix.

This repo went public on 2026-09-06, so a fork PR is now a real scenario and
option 1 is what ships: a fork's PR builds and is checked, and gets no
preview URL. That is a degraded experience, not an exposure — no secret and
no OIDC token is in scope for a fork's `pull_request` run.

Option 2 remains the documented improvement and has not been taken. A
`workflow_run` handoff runs with secrets against a ref the forker controls,
and every published failure of that pattern comes from trusting `head_sha`
or `head_repository` without re-validating them in the trusted context. It
deserves its own change and its own review rather than being added the day
the repository's visibility changed. Widening the `if` on option 1 is never
the alternative.

## `pr-preview-cleanup.yml`

Deletes `pr-<n>/` when its PR closes, merged or not — including for fork
PRs, which never had a preview published in the first place, making the
delete a harmless no-op. It triggers on `pull_request_target: types:
[closed]` and reads only `github.event.pull_request.number`, validated as
numeric before use; it never checks out PR content, so it is safe to run
unconditionally regardless of the PR's origin. It shares its concurrency
group (`deploy-shell-pr-<n>`) with `publish-preview` so a preview publish
in flight can't race a close event and leave stale files behind.

It runs under its own `docs-preview-cleanup` environment rather than reusing
`publish-preview`'s `docs-preview` — whether `pull_request_target`'s OIDC
`sub` claim matches `pull_request`'s documented
`repo:ORG/REPO:pull_request` format is unverified, so its trust-policy entry
is kept separate and reviewed on its own.

An S3 lifecycle rule expiring objects under `pr-*/` after roughly two weeks
is the backstop for any cleanup run that never fires (a workflow disabled,
a run that errors before the delete step) — that rule is `infra/`'s
concern, not this workflow's.

## Secrets this scheme expects

| Secret | Used by | Scope | Storage level |
|---|---|---|---|
| `LIBTMUX_DOCS_BUCKET` | every workflow above | bucket name, not prefix-scoped | repo or org |
| `LIBTMUX_DOCS_DISTRIBUTION` | shell publication; optional and unused by the port publisher | one CloudFront distribution | repo or org |
| `LIBTMUX_DOCS_ROLE_ARN` | `deploy-shell.yml`'s `publish-root` (direct job, may be Environment-scoped); each port's own `docs.yml` (passed through a `uses:` job, must be repo/org) | production write role, scoped to that caller's own prefix(es) | see "Used by" |
| `LIBTMUX_DOCS_PREVIEW_ROLE_ARN` | `deploy-shell.yml`'s `publish-preview` (passed through a `uses:` job) | scoped to `pr-*/` only | repo or org |
| `LIBTMUX_DOCS_PREVIEW_CLEANUP_ROLE_ARN` | `pr-preview-cleanup.yml` (direct job, may be Environment-scoped) | scoped to `pr-*/` delete only | repo, org, or the `docs-preview-cleanup` Environment |

Any secret that flows through a `uses:`/`secrets:` pass-through — every
secret named in the "Opting in" recipe above, and `publish-preview`'s inputs
— must live at the repository or organization level, never on a GitHub
Environment: the job doing the passing can't declare `environment:`, so an
Environment-scoped secret resolves empty at that point (see "Opting in a
port repo"). Only secrets read inside a normal job that itself declares
`environment:` directly (`publish-root`, `pr-preview-cleanup.yml`'s
`cleanup`) may safely live on that Environment.

Per-port roles and bucket policies live wherever that port's own
infrastructure lives; this repo's own three roles are `infra/`'s concern,
not encoded here.

## External publication gates

Local workflow checks cannot establish the live GitHub and AWS policy. Before
the Ruby or Lua caller may publish, a maintainer must verify all of these:

- The selected site commit is public and both the docs checkout and reusable
  workflow use that identical full SHA.
- The port has repository- or organization-level bucket and role secrets. The `docs` and `docs-preview` environments admit only their
  intended refs and produce OIDC claims trusted by prefix-scoped roles.
- The production role owns only `en/<port>/*` and
  `manifest/<port>.json`; the preview role owns only
  `en/<port>/pr-*`. The cleanup role can delete only that preview space.
- The Ruby and Lua default trees publish successfully before the coordinated
  shell run that merges manifests and refreshes Pagefind, sitemap, shared
  assets, port landings, and redirects.
- The real preview is closed and its exact prefix is absent afterward, while
  trunk, aliases, immutable tags, other ports, and shared search remain.

Until those checks have live evidence, the integration is prepared but not
production-complete.
