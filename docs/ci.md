# CI and deployment

Eleven repositories exist in this scheme — this shell repo and the ten port
repos named in `site/src/lib/ports.ts` — but only eight ever write into
`s3://libtmux-docs`: three ports (Rust, Go, Java) deep-link to an ecosystem
host instead and own no prefix here at all (see the table below). Each of
the seven publishing ports owns and deploys its own prefix exclusively. No repository shares a
build environment, a build job, or a piece of mutable state with any other —
the only shared executable contract is this repo's
`.github/workflows/reusable-deploy.yml`, pinned by full commit SHA like any other
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

Ports with a site-hosted version tree have something to sync into this bucket:

| Port | Reference ownership | Calls `reusable-deploy.yml`? |
|---|---|---|
| Python (`py`) | port-owned native API | yes |
| Ruby (`ruby`) | port-owned complete version tree | yes |
| Lua (`lua`) | port-owned complete version tree | yes |
| TypeScript (`ts`) | site-rendered | yes |
| .NET (`dotnet`) | site-rendered | yes |
| C++ (`cxx`) | port-owned native API | yes |
| Swift (`swift`) | port-owned native API | yes |
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

### What the artifact must contain

The assembled `<locale>/<port>/<version>` tree, not the port's own doc-tool
output. That tree is the shared shell rendered with the port's code fences,
with the port's reference nested at `api/` inside it — `build-site.sh --ports
<slug>` produces it, and a caller uploads `_site/en/<slug>/latest` verbatim.

Uploading the port's own build instead replaces the whole tree with it. That
failure publishes cleanly: the run is green and the URL returns 200, serving
the wrong site. It happened to Python's first publish, where `/en/py/latest/`
served Furo and `/en/py/latest/concepts/` 403'd.

`--skip-refs` is a per-port judgement, not a default. For nine ports `api/`
is a redirect to `/reference/<slug>/`, so skipping the reference generators
costs nothing. Python's `api/` is the real gp-sphinx render that
`site/scripts/check-style-parity.mjs` measures against, so its build must not
skip them — and its runner needs `uv`.

  publish:
    needs: build
    permissions:
      contents: read
      id-token: write
    # Full-length SHA, release name in the comment: this runs with id-token:
    # write and a bucket-writing role, and a tag can be repointed.
    uses: libtmux/docs/.github/workflows/reusable-deploy.yml@ce9d7edd63f6a543801d9b93366ecad5e158c0ec # v0.1.0-alpha.2
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

## External publication gates

Local workflow checks cannot establish the live GitHub and AWS policy. Before
the Ruby or Lua caller may publish, a maintainer must verify all of these:

- The selected site commit is public and both the docs checkout and reusable
  workflow use that identical full SHA.
- The port has repository- or organization-level bucket, distribution, and
  role secrets. The `docs` and `docs-preview` environments admit only their
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
