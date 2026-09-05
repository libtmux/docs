# CI/CD topology across eight repositories

Each of the eight port repositories owns and deploys its own path prefix in
`s3://libtmux-docs`, using a version-pinned reusable workflow published by the shell
repo. No repository shares a build environment, a build job, or a piece of mutable
state with any other — the only thing shared is a file, a `workflow_call` definition,
exactly as coupled as any other pinned dependency.

The distinction that decides every choice below is **shared file vs. shared
execution**. A reusable workflow is a shared file: each caller pins a tag (`@v1`) and
bumps it on review, so a bad change breaks nothing until a repo opts in. A shared CI
image, matrix job, or cross-repo token is shared execution: one failure or one leaked
credential reaches repos that had nothing to do with it. Every topology below is a
variation on how much shared execution it smuggles back in.

## The four topologies

| | Build environment | Blast radius of one toolchain bump | Cross-repo credential needed | Required-check isolation |
|---|---|---|---|---|
| **Central pull** (a crawler in the shell repo builds all eight) | One shared image, all eight toolchains | All eight builds break together | Read access to eight repos | One repo, one job — a broken Rust build can fail the run |
| **Per-repo prefix ownership** (recommended) | Native — each repo's own toolchain(s) | Isolated to that repo | None | Untouched by the other seven |
| **Submodule monorepo** | Shared unless matrixed; still one workflow file | A root-workflow syntax error fails all eight matrix legs | Push access to bump each submodule pointer | One PR touches the shared file for all eight |
| **`repository_dispatch` fan-in** | Native — build stays in the owning repo | Isolated to the dispatching repo | A token in all eight repos, scoped to dispatch into the shell repo | Isolated; only an *optional* aggregation job depends on the fan-in |

Central pull is docs.rs's actual architecture — one build-server loop over a
Postgres-backed queue (`crates/bin/docs_rs_builder/src/queue_builder.rs`) — earning
that complexity by solving a problem this project doesn't have: building **untrusted,
arbitrary third-party source** safely, at crates.io's scale. All eight ports are repos
you own; there's no trust boundary to cross centrally, so a sandboxed central builder
buys nothing here.

Submodule monorepo and fan-in both reduce, on inspection, to the same admission:
neither avoids a shared credential — one needs push access to bump eight submodule
pointers, the other dispatch access from eight repos into the shell repo. Per-repo
prefix ownership needs neither: each repo's existing OIDC role, already proven in
`~/work/python/libtmux/.github/workflows/docs.yml`, is enough.

**Verdict: per-repo prefix ownership**, with `repository_dispatch` kept only as an
*optional*, non-load-bearing signal for the secondary aggregation job below — never as
something a language's own publish depends on.

## Why one CI image is a bad trade — honestly estimated

It's tempting to estimate this by disk footprint, but that doesn't hold up: GitHub's
own `ubuntu-24.04` runner image (`ubuntu-latest`'s current target, version
`20260823.283.1`, checked against the `actions/runner-images` manifest on 2026-09-02)
already preinstalls Python, Go, a JDK line with Gradle, the .NET SDK, Rust via rustup,
CMake, vcpkg, Node.js, Kotlin, and **Swift 6.3.3**. Of the eight toolchains named in
this brief, only bun is absent, and `oven-sh/setup-bun` installs it in seconds — the
action `libtmux-ts/publish.yml` already uses. A claim of several gigabytes and 8–15
minutes of setup for a combined image does not survive checking the manifest.

That doesn't save the shared-image idea; it relocates the cost from disk to
coordination, which is worse:

1. **Every port pins its own exact version, not the image default** —
   `libtmux-go/tests.yml` matrixes `go-version`, `libtmux-swift/ci.yml` pins
   `swift-version: "6.2"` (one release *behind* the image's 6.3.3), `libtmux-java/ci.yml`
   matrixes `java-version`. A combined docs job has to reproduce all eight pins in one
   file, so a routine version bump — normally a one-line change in that repo — becomes a
   change to a workflow the other seven share.
2. **A single job's steps run sequentially.** Restoring each ecosystem's own
   dependencies — `uv sync`, `bun install`, `cargo doc`'s crates.io fetch, a Gradle run,
   `dotnet restore`, DocC's symbol-graph build — still happens once per language even
   with the compiler preinstalled, so wall-clock time is the *sum* of eight steps, and a
   failure partway through stops every step after it unless each carries `if: always()`.
3. **Matrixing removes the sequential-time cost but reintroduces the coupling this
   document argues against**: parallel jobs in one workflow file, needing their own
   trigger for "port X's source changed" — a cron poll (docs.rs's watcher, solving a
   trust problem this project doesn't have), a cross-repo dispatch, or submodule
   pointers. No version of "one image" avoids becoming one of the other three
   topologies just to trigger it.

## Nine owners, nine exclusive keys

Manifest consistency is solved by construction: every repository writes to a key no
other repository ever touches, so there is nothing to race on.

| Repo | Owns prefix | Manifest key | Extra toolchain in its own CI | S3 resource for its role |
|---|---|---|---|---|
| `libtmux` (Python) | `py/*` | `manifest/py.json` | — | `arn:aws:s3:::libtmux-docs/py/*` |
| `libtmux-cxx` | `cxx/*` | `manifest/cxx.json` | — | `arn:aws:s3:::libtmux-docs/cxx/*` |
| `libtmux-ts` | `ts/*` | `manifest/ts.json` | bun + our Astro renderer (api-extractor JSON has no native page renderer) | `arn:aws:s3:::libtmux-docs/ts/*` |
| `libtmux-rs` | `rs/*` | `manifest/rs.json` | — | `arn:aws:s3:::libtmux-docs/rs/*` |
| `libtmux-go` | `go/*` | `manifest/go.json` | our Astro renderer, wrapping doc2go's `-embed` fragments | `arn:aws:s3:::libtmux-docs/go/*` |
| `libtmux-java` | `java/*` | `manifest/java.json` | — (Dokka is self-hosting) | `arn:aws:s3:::libtmux-docs/java/*` |
| `libtmux-dotnet` | `dotnet/*` | `manifest/dotnet.json` | Node/bun for the Astro satellite rendering `docfx metadata` YAML | `arn:aws:s3:::libtmux-docs/dotnet/*` |
| `libtmux-swift` | `swift/*` | `manifest/swift.json` | — | `arn:aws:s3:::libtmux-docs/swift/*` |
| shell repo | bucket root: `/`, `/ja/`, `concepts/**`, `_shell/v*/**` | `manifest/manifest.json` (optional aggregate) | Astro/Node | see below |

Three ports — TypeScript, Go, .NET — run a Node/bun build **in addition to** their
native toolchain, since their reference has no themable native generator (ledger
§2.1, §7.2) and renders through our own Astro components instead: the honest
counterweight to "no shared image," though both toolchains stay inside that repo's own
CI per ledger §7.7, never a shared job. How the satellite obtains the renderer
components is `24-astro-shell.md`'s concern.

**The shell repo is the one owner whose output lands at the bucket root**, making it
most likely to reproduce the bug already in
`~/work/python/libtmux/.github/workflows/docs.yml` — `aws s3 sync ... --delete` with no
prefix — and erase all eight language prefixes on the next shell deploy. Scope the
sync command, and back it with IAM so a workflow bug fails closed instead of deleting
the site:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ShellPutAnywhereInBucket",
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::libtmux-docs/*"
    },
    {
      "Sid": "ShellDeleteExceptLanguagePrefixes",
      "Effect": "Allow",
      "Action": "s3:DeleteObject",
      "NotResource": [
        "arn:aws:s3:::libtmux-docs/py/*",
        "arn:aws:s3:::libtmux-docs/ts/*",
        "arn:aws:s3:::libtmux-docs/rs/*",
        "arn:aws:s3:::libtmux-docs/go/*",
        "arn:aws:s3:::libtmux-docs/java/*",
        "arn:aws:s3:::libtmux-docs/dotnet/*",
        "arn:aws:s3:::libtmux-docs/cxx/*",
        "arn:aws:s3:::libtmux-docs/swift/*"
      ]
    }
  ]
}
```

`NotResource` grants delete on everything the shell role's `Allow` covers *except*
those eight prefixes, so a copy-pasted root `--delete` becomes `AccessDenied` on them
instead of an incident. Each port's own role is the mirror image —
`Resource: arn:aws:s3:::libtmux-docs/py/*` and nothing else, plus a bucket-level
`s3:ListBucket` grant scoped by an `s3:prefix` condition (`py/*`, `manifest/py.json`),
needed for the manifest derivation below.

## Manifest consistency by construction

Each fragment is **derived from the bucket, not appended to** — the losing side of a
race recomputes from current state instead of retrying stale bytes:

```console
$ aws s3api list-objects-v2 \
    --bucket libtmux-docs \
    --prefix py/ \
    --delimiter / \
    --query 'CommonPrefixes[].Prefix' \
    --output json
```

That lists every top-level object under `py/` — each version tag plus `stable/` and
`latest/` — which a small `jq` filter turns into `{"lang": "py", "versions": [...]}`.
`manifest/py.json` is exclusive to Python's own OIDC role, so there is no other writer
to race against in steady state; the compare-and-swap below is a backstop against a
manual re-run, not the primary correctness mechanism:

```console
$ aws s3api put-object \
    --bucket libtmux-docs \
    --key manifest/py.json \
    --body "$RUNNER_TEMP/manifest-fragment.json" \
    --content-type application/json \
    --if-match "$etag"
```

`aws s3api put-object` is required, not `aws s3 cp`/`sync` — neither exposes
`--if-match`/`--if-none-match`. S3 conditional writes are GA since August 2024:
`--if-match` fails with 412 on a mismatch, `--if-none-match "*"` fails with 412 if the
key exists, both over SigV4. A 412 means re-`head-object` for the current ETag and
re-derive from a fresh `list-objects-v2` — never retry the same bytes against a new
ETag, since the state that made them correct may have moved.

The shell's homepage reads all eight fragments at request time (same-origin,
cacheable, no CORS) rather than requiring convergence at write time. An **optional**
aggregate `manifest/manifest.json` — for a sitemap or `llms.txt` index — can live in
the shell repo, triggered by `repository_dispatch` from any port's publish, serialized
with `concurrency: {group: manifest-aggregate, queue: max}`, and backstopped by a
`schedule: cron: '*/15 * * * *'` re-derivation — the one place `repository_dispatch`
earns a role, as an optional accelerant for a job that also runs on a timer.

## A reusable workflow, not a shared job

The split that keeps "no port needs a shared build environment" literally true: the
caller job builds with its own toolchain and uploads an artifact; the *called*
workflow only downloads it, syncs it, derives the manifest fragment, and invalidates
mutable paths. The called workflow never installs a language toolchain, so it can't
couple one port's toolchain choice to another's.

Each port's own `docs.yml` (caller):

```yaml
name: docs

on:
  push:
    branches: [master]

concurrency:
  group: docs-deploy
  queue: max

permissions:
  contents: read
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: astral-sh/setup-uv@v10.0.1
      - run: cd docs && just html
      - uses: actions/upload-artifact@v7
        with:
          name: docs-html
          path: docs/_build/html
          retention-days: 1

  publish:
    needs: build
    uses: <org>/libtmux-docs/.github/workflows/publish-docs.yml@v1
    with:
      lang: py
      prefix: py/v0.46.2
      artifact: docs-html
      invalidate: /py/stable/*
    secrets:
      role-arn: ${{ secrets.LIBTMUX_DOCS_ROLE_ARN }}
      bucket: ${{ secrets.LIBTMUX_DOCS_BUCKET }}
      distribution: ${{ secrets.LIBTMUX_DOCS_DISTRIBUTION }}
```

`concurrency` sits on the caller at workflow level — the only verified precedent for
`queue: max` is workflow-level, in `libtmux-ts/publish.yml`; groups don't cross
repository boundaries, so `docs-deploy` needs no per-repo suffix. `prefix` is
version-qualified (`py/v0.46.2`, or `py/stable` on the alias rebuild in ledger §2.3 —
a tag push calls this workflow twice, once per prefix), so the reused `sync --delete`
never reaches outside that one build's own directory. Secrets are explicit, never
`secrets: inherit`.

The called workflow (`publish-docs.yml`, shell repo, tagged `v1`):

```yaml
name: publish-docs

on:
  workflow_call:
    inputs:
      lang:
        required: true
        type: string
      prefix:
        required: true
        type: string
      artifact:
        required: true
        type: string
      invalidate:
        required: false
        type: string
        default: ""
    secrets:
      role-arn:
        required: true
      bucket:
        required: true
      distribution:
        required: true

permissions:
  contents: read
  id-token: write

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v7
        with:
          name: ${{ inputs.artifact }}
          path: dist

      - uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: ${{ secrets.role-arn }}
          aws-region: us-east-1

      - name: Sync this language's prefix only
        run: |
          aws s3 sync dist "s3://${{ secrets.bucket }}/${{ inputs.prefix }}" \
            --delete --follow-symlinks

      - name: Derive and write this language's manifest fragment
        run: scripts/write-manifest-fragment.sh "${{ inputs.lang }}" "${{ secrets.bucket }}"

      - name: Invalidate mutable paths
        if: inputs.invalidate != ''
        run: |
          aws cloudfront create-invalidation \
            --distribution-id "${{ secrets.distribution }}" \
            --paths "${{ inputs.invalidate }}"
```

Every port pins `@v1`, so a shell-repo change reaches a port only when its own PR
bumps the tag, reviewed like any other dependency update.

## The runtime-loaded shell: chrome fixes without redeploying versions

CI's job here is narrow: never bake the shared header, footer, switcher, or dark-mode
shim into a language's build output. Each port's theme instead references a stable,
semver-scoped URL — `/_shell/v1/shell.js` and `shell.css` — pinned to a **major**
version at build time. The shell repo publishes patches and minors to that same prefix
with a short TTL, so a footer fix reaches every published immutable version within
minutes and zero invalidations; a breaking change bumps the prefix to `/_shell/v2/`,
which existing builds never load until they rebuild. This satisfies ledger §6's
standing rule — chrome fixes reach published versions without a rebuild — and is why
ledger §7.5's invalidation scope never touches a whole language's version tree, only
`/_shell/v1/*` and the mutable pointers. Bucket layout belongs to
`06-aws-s3-cloudfront.md`; this document's stake is only that no port's CI writes the
shell into its own build output.

## Per-port failure isolation and required checks

This is close to free under per-repo prefix ownership: eight separate PR queues and
required-checks lists mean a failing Rust doc build cannot appear on a TypeScript PR —
no shared workflow file exists for a path filter to mis-skip. The one place this needs
handling is inside each port's own `docs.yml`, using the pattern already proven in
`~/work/python/libtmux/.github/workflows/docs.yml`: the workflow always triggers on
`push`, and `dorny/paths-filter` gates individual *steps*, not the whole job. Gating the
job itself with a top-level `paths:` filter would leave the required check permanently
pending on PRs that don't touch docs — GitHub's own troubleshooting guidance names this
as the standard way to break required status checks. Tag-triggered releases
(`libtmux-rs/release.yml`, `libtmux-ts/publish.yml`) skip the path filter entirely: no
meaningful base ref exists to diff a tag push against.

## Preview environments

A same-repository PR branch can have `pull_request`'s OIDC token assume that repo's
preview role directly and sync to `previews/<lang>/pr-<n>/` under a short TTL, with an
S3 lifecycle rule expiring the prefix after roughly two weeks as a backstop for any
cleanup job that fails to run.

Fork PRs need a different path, and research sources disagree here — flagged rather
than silently picked. Both agree `pull_request_target` is wrong: it runs workflow code
from the fork with the base repo's secrets, the vulnerability GitHub's docs warn
against. Where they diverge is scope: one gives fork PRs a build-only check with no
live preview; the other has a `pull_request` build with **no OIDC or secrets** that
uploads the HTML as a plain artifact, and a `workflow_run` workflow — running from the
default branch, so it executes in the base repo's trust context even though the
artifact came from a fork — downloads it by run ID, assumes a role scoped to
`previews/<lang>/*`, and publishes it. This document takes the second path: barely
more surface than a build-only check, and external contributors get the same preview
signal without fork code ever touching real credentials. Whether the preview lands in
the production bucket or a separate one is `06-aws-s3-cloudfront.md`'s call — prefer a
separate origin, since a fork's build runs arbitrary code and same-origin with
`libtmux.org` would let a malicious preview read production cookies and storage.

## The smoke test the design set doesn't have yet

Ledger §7.10 names a real gap: nothing checks that all eight generators' injection
points still mount the shared header, footer, switcher, and dark-mode shim after a
tool's version bump. A DOM-presence assertion closes it, run two ways:

1. **In each port's own `publish-docs.yml` run**, after the artifact downloads and
   before the S3 sync: serve the built directory locally, load one representative page
   with Playwright, and assert `document.querySelector('[data-libtmux-shell="header"]')`
   (and `footer`, `version-switcher`, `theme-toggle`) is non-null *and* a known piece of
   the generator's own content is still present — catching "the shell failed to mount"
   and "the injection replaced the content instead of wrapping it" alike. This lives
   once, in the shared reusable workflow, so no Sphinx/native-skinned port needs its own
   Playwright dependency.
2. **In the shell repo's own CI**, against one frozen fixture page per generator
   (`fixtures/py/index.html`, `fixtures/rs/index.html`, and so on). Every change to
   `_shell/v1/shell.js` or `shell.css` runs the same assertion against all eight
   fixtures first — the direction that matters most, since the shell is loaded at
   runtime by already-published versions, so a regression reaches production the moment
   it's deployed, with no per-language rebuild to catch it. Direction 1 catches "this
   port's build broke mounting"; direction 2 catches "the shared shell broke a port"
   before either ships.
