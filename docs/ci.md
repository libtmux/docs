# CI and deployment

Nine repositories exist in this scheme — this shell repo and the eight port
repos named in `site/src/lib/ports.ts` — but only six ever write into
`s3://libtmux-docs`: three ports (Rust, Go, Java) deep-link to an ecosystem
host instead and own no prefix here at all (see the table below). Each of
the six owns and deploys its own prefix, exclusively. No repository shares a
build environment, a build job, or a piece of mutable state with any other —
the only thing shared is a file, this repo's
`.github/workflows/reusable-deploy.yml`, pinned by tag like any other
dependency.

## Why per-repo prefix ownership

The distinction that decides every choice below is **shared file vs. shared
execution**. A reusable workflow (`workflow_call`) is a shared file: each
caller pins a tag and bumps it on review, so a bad change breaks nothing
until a repo opts in. A shared CI image, matrix job, or cross-repo credential
is shared execution: one failure or one leaked credential reaches repos that
had nothing to do with it.

This repo publishes `reusable-deploy.yml`. It never installs a language
toolchain, never checks out a caller's source, and never sees a caller's
secrets except the three passed explicitly (`role-arn`, `bucket`,
`distribution`) — `secrets: inherit` is never used anywhere in this scheme. A
caller builds with its own toolchain, uploads the result as an artifact, and
hands this workflow a prefix to write it to. That is the entire contract.

## Which repos call `reusable-deploy.yml`

Only ports with `referenceMode: 'self-hosted'` in `ports.ts` have anything to
sync into this bucket at all:

| Port | `referenceMode` | Calls `reusable-deploy.yml`? |
|---|---|---|
| Python (`py`) | self-hosted | yes |
| TypeScript (`ts`) | self-hosted | yes |
| .NET (`dotnet`) | self-hosted | yes |
| C++ (`cxx`) | self-hosted | yes |
| Swift (`swift`) | self-hosted | yes |
| Rust (`rs`) | ecosystem (docs.rs) | no — nothing to publish here |
| Go (`go`) | ecosystem (pkg.go.dev) | no — nothing to publish here |
| Java (`java`) | ecosystem (javadoc.io) | no — nothing to publish here |

`ports.ts` is the single source of truth for this split (see
**Contradictions** below — some research notes in `../notes/research/` say
otherwise and are wrong).

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
| `pr` | `pr-42` | `public, max-age=0, s-maxage=300` |

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
moving a segment would otherwise be a coordinated edit across eight of them. A
pull-request preview keeps its own shape: it owns its whole prefix and nests
the site inside it.

`path-prefix` is validated inside the reusable workflow: non-empty, no
leading or trailing slash, no `..` segment, and never a bare reserved name
(`py`, `ts`, `rs`, `go`, `java`, `dotnet`, `cxx`, `swift`, `manifest`,
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

`aws s3api put-object` is required here, not `aws s3 cp`/`sync` — neither
exposes `--if-match`/`--if-none-match`. A 412 means another run of the same
port's own workflow raced this one; the step re-reads and retries up to
three times before failing loudly. This is a backstop, not the correctness
mechanism — correctness comes from the manifest key being exclusive to one
port's role in the first place.

The shell reads all such fragments at request time to build any
cross-language view (a parity table, a combined sitemap); nothing here
requires them to converge at write time.

## Opting in a port repo

A self-hosted port's own `docs.yml` builds with its own toolchain, uploads an
artifact, then calls this repo's reusable workflow:

```yaml
name: docs

on:
  push:
    branches: [master]
    tags: ['v*']

permissions:
  contents: read
  id-token: write

concurrency:
  group: docs-deploy-${{ github.repository }}
  queue: max

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: cd docs && just html
      - uses: actions/upload-artifact@v7
        with:
          name: docs-html
          path: docs/_build/html
          retention-days: 1

  publish:
    needs: build
    permissions:
      contents: read
      id-token: write
    # Full-length SHA, release name in the comment: this runs with id-token:
    # write and a bucket-writing role, and a tag can be repointed.
    uses: libtmux/docs/.github/workflows/reusable-deploy.yml@0cd5a3f10c70bf55130ab6a02d5177f6318beaca # v0.1.0-alpha.1
    with:
      path-prefix: py/v0.46.2
      artifact: docs-html
      version-kind: tag
      port: py
      version: v0.46.2
      is-default: false
      environment: docs
    secrets:
      role-arn: ${{ secrets.LIBTMUX_DOCS_ROLE_ARN }}
      bucket: ${{ secrets.LIBTMUX_DOCS_BUCKET }}
      distribution: ${{ secrets.LIBTMUX_DOCS_DISTRIBUTION }}
```

Four things every caller needs, none of which lives in this repo:

- `concurrency` at **workflow level in the caller**, with `queue: max`.
  Groups don't cross repository boundaries, so `docs-deploy-<repo>` needs no
  further suffix. `queue: max` cannot combine with `cancel-in-progress` —
  don't add one.
- An IAM role trusted for OIDC, scoped to that port's own prefix only
  (`s3:PutObject`/`s3:DeleteObject` on `libtmux-docs/py/*`,
  `cloudfront:CreateInvalidation` on the one distribution — that action
  can't be scoped by path, so the S3 statement is the real containment
  boundary). Defining these policies is `infra/`'s concern, not this
  workflow's.
- A `docs` GitHub Environment with a deployment-branch-and-tag policy
  restricting who can trigger it (`master`, `v*`) — this is what actually
  enforces "trunk, tags, release branches only," since setting
  `environment:` rewrites the OIDC `sub` claim to drop any `ref:` clause
  entirely. Pass its name through the `environment` input, not as
  `environment:` on the calling job — `workflow_call` does not support that
  keyword on the caller, and `reusable-deploy.yml`'s own `publish` job is
  the one whose OIDC token actually needs `environment:docs` in its `sub`
  claim.
- The three secrets passed explicitly, never `secrets: inherit`, and **as
  repository- or organization-level secrets, not Environment-scoped ones.**
  `${{ secrets.LIBTMUX_DOCS_ROLE_ARN }}` in the `publish` job above is
  evaluated in *that job's* context, and that job cannot declare
  `environment:` (`workflow_call` does not support it) — so if a secret only
  exists on the `docs` Environment, this expression resolves to nothing and
  `role-arn` reaches `reusable-deploy.yml` empty. `~/work/python/libtmux`'s
  existing `docs.yml` reads `LIBTMUX_DOCS_ROLE_ARN` from a job that itself
  declares `environment: docs` — moving to this scheme means moving that
  secret (and `_BUCKET`, `_DISTRIBUTION`) up to the repository or
  organization, if it lives on that Environment today. The Environment
  still does real work — its deployment branch/tag policy, and the OIDC
  `sub` claim — just applied to `reusable-deploy.yml`'s own `publish` job
  through the `environment` input, not to secret storage.

Fork PRs on a port repo are that repo's own concern; this repo's shell
handling (below) is the only fork-PR path owned here.

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
| push to `main` | `build` → `publish-root` | bucket root, `docs` environment |
| push tag `v*` | `build` → `publish-root` | bucket root (same as trunk) |
| `pull_request`, same-repo head | `build` → `publish-preview` | `pr-<n>/`, `docs-preview` environment |
| `pull_request`, fork head | `build` only | no publish — see below |

`publish-root` cannot simply call `reusable-deploy.yml`: production output
spans several top-level directories (the `docs` content collection's own
routes, and `/ja/` once translated shell prose lands), not one exclusive
prefix, and the bucket root is shared with all eight language prefixes this
repo must never touch. Instead it lists `dist/`'s top-level entries, fails
the run if any collides with a reserved language/manifest name, `sync
--delete`s each surviving directory individually, and `cp`s (no `--delete`)
the handful of root-level files — the workflow-level twin of the IAM
`NotResource` policy that should back it, so a bug here fails the run rather
than depending on IAM alone.

`publish-preview` fits `reusable-deploy.yml` cleanly: `pr-<n>/` is an
exclusive prefix like any port's, so it calls the same reusable workflow with
`version-kind: pr` and no `port` (no manifest entry for a preview).

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
| `LIBTMUX_DOCS_DISTRIBUTION` | every workflow above | one CloudFront distribution — `CreateInvalidation` can't be scoped narrower | repo or org |
| `LIBTMUX_DOCS_ROLE_ARN` | `deploy-shell.yml`'s `publish-root` (direct job, may be Environment-scoped); each port's own `docs.yml` (passed through a `uses:` job, must be repo/org) | production write role, scoped to that caller's own prefix(es) | see "Used by" |
| `LIBTMUX_DOCS_PREVIEW_ROLE_ARN` | `deploy-shell.yml`'s `publish-preview` (passed through a `uses:` job) | scoped to `pr-*/` only | repo or org |
| `LIBTMUX_DOCS_PREVIEW_CLEANUP_ROLE_ARN` | `pr-preview-cleanup.yml` (direct job, may be Environment-scoped) | scoped to `pr-*/` delete only | repo, org, or the `docs-preview-cleanup` Environment |

Any secret that flows through a `uses:`/`secrets:` pass-through — every
secret named in the "Opting in" recipe above, and `publish-preview`'s three
— must live at the repository or organization level, never on a GitHub
Environment: the job doing the passing can't declare `environment:`, so an
Environment-scoped secret resolves empty at that point (see "Opting in a
port repo"). Only secrets read inside a normal job that itself declares
`environment:` directly (`publish-root`, `pr-preview-cleanup.yml`'s
`cleanup`) may safely live on that Environment.

Per-port roles and bucket policies live wherever that port's own
infrastructure lives; this repo's own three roles are `infra/`'s concern,
not encoded here.

## Contradictions and open questions

- **Blocking, unresolved as of this writing.** The current site build
  (another subsystem's work, not this one's) emits `dist/py/`, `dist/ts/`,
  `dist/rs/`, `dist/go/`, `dist/java/`, `dist/dotnet/`, `dist/cxx/` and
  `dist/swift/` — one port landing page apiece, from a `[port]` route.
  `deploy-shell.yml`'s `publish-root` denylist refuses every one of those
  names on purpose (this document, "This repo's own deploy"), so **the
  workflow fails outright on every push until this is resolved** — that
  refusal is deliberate, not a bug to silence, because syncing one of those
  directories wholesale could `--delete` a version that port's own CI
  already published under the identical prefix. This is
  `00-DECISIONS.md` §7.10 item 5, "whether `/py/` becomes canonical or a
  landing page," still open. Two resolutions, neither implemented here:
  (a) the landing page wins — `publish-root` `cp`s (never syncs)
  `dist/<slug>/index.html` as one object, invalidates only
  `/<slug>/index.html`, and `06-aws-s3-cloudfront.md`'s bare-root 302
  function is dropped or changed to not preempt it; or (b) the port's own
  reference build owns the bare prefix entirely and the `[port]` route
  moves under a different path or is dropped. Whoever owns the `[port]`
  route and the CloudFront function should pick one; this repo's workflow
  will need a matching, deliberate edit either way, not a denylist bypass.
- **`versions.ts` describes a manifest scheme no workflow here writes.**
  `site/src/components/VersionSwitcher.astro` fetches a single
  `/versions.json` at runtime (confirmed: `rg -n versions.json site/src`),
  matching `versions.ts`'s own module comment ("at /versions.json, which CI
  rewrites on publish"). `reusable-deploy.yml` instead writes
  `manifest/<port>.json` fragments, per `notes/research/07-ci-topology.md`'s
  and `00-DECISIONS.md` §6's exclusive-manifest-key rule — a single
  cross-repo `/versions.json` is exactly the shared mutable state that rule
  forbids, and `notes/research/04-versioning.md` independently specifies
  per-language files for the same reason. Nothing in this repo currently
  writes `/versions.json`, so as shipped here `VersionSwitcher.astro` never
  learns about a version published by a port's own CI. Closing this needs
  one of: the switcher reads `manifest/<port>.json` directly instead, or the
  shell gains the aggregator `07-ci-topology.md` describes (triggered by
  each port's publish, deriving `/versions.json` from every
  `manifest/*.json`) — no such aggregator exists yet, and it is not one of
  this assignment's four files.
- `notes/research/07-ci-topology.md`'s "nine owners" table lists Rust, Go
  and Java as self-hosted, each owning a prefix and a manifest key.
  `ports.ts` — the file this repo treats as authoritative — marks all three
  `referenceMode: 'ecosystem'` with `renderer: 'none'`: they have no
  self-hosted build output at all, so nothing to sync or manifest here. Six
  repositories call `reusable-deploy.yml` (this shell plus five self-hosted
  ports), not nine. `../README.md`'s port table also lists a renderer for
  Go ("doc2go `-embed` to Astro") that contradicts `ports.ts` the same way.
- `notes/research/04-versioning.md` writes the branch-kind slug as `0.x`
  (no `v` prefix); `versions.ts`'s own doc comment writes `v0.x`. This
  document follows `versions.ts`.
- `ports.ts` lists Python's repo as `tmux-python/libtmux` — a different
  GitHub organization from `libtmux/*`. This is why `libtmux/docs` is a
  public repository. A reusable workflow in a *private* repo cannot be
  called by a public repo at all — no Actions access policy lifts that, it
  is a visibility rule — and private sharing stops at the organization
  boundary in any case, so a cross-org caller like `tmux-python/libtmux`
  could never have reached one. The shared publish step has to be reachable
  from eight public repositories across two organizations, so the repository
  holding it is public. Nothing in it is a secret: every caller passes its
  own `role-arn`, `bucket` and `distribution`.
- `../README.md`'s layout table puts "deploy workflows" under `infra/`; the
  assignment that produced this document placed them at
  `.github/workflows/` instead — the only location GitHub Actions itself
  will discover them from. `infra/` is left for non-workflow deploy
  infrastructure (bucket policy, the CloudFront function, IAM policy JSON).
