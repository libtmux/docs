# S3 and CloudFront architecture

One bucket (`s3://libtmux-docs`), one CloudFront distribution with Origin Access Control,
one small viewer-request CloudFront Function, Cloudflare kept in front as it is today.
Every language repo writes only its own prefix; only mutable pointers get invalidated;
`/stable/` and `/latest/` are separate builds, never edge rewrites, per ledger §2.3.

## Today, verified

`~/work/python/libtmux/.github/workflows/docs.yml` builds with `docs/justfile`'s `html`
target, which runs `sphinx-build -b dirhtml` (confirmed at `docs/justfile:26`) — pretty,
extensionless URLs already, which happens to be exactly the directory shape the edge
function below assumes. It deploys with:

```console
$ aws s3 sync docs/_build/html "s3://${LIBTMUX_DOCS_BUCKET}" \
    --delete \
    --follow-symlinks
```

against the **bucket root**, sets **no `Cache-Control`** on anything, invalidates three
fixed paths (`/index.html /objects.inv /searchindex.js`), then purges Cloudflare via
`jakejarvis/cloudflare-purge-action`. The purge step only makes sense if Cloudflare is
proxying (orange-cloud) the zone — response headers from `libtmux.git-pull.com` confirm
it is: `server: cloudflare` alongside `x-cache: Hit from cloudfront`, so today's stack is
already Cloudflare in front of CloudFront in front of S3. `libtmux.org` is registered on
Cloudflare DNS with no records yet, so continuing that same layering — Cloudflare in
front of a new CloudFront distribution — is the natural move, not a new architecture.

Two live bugs migrate forward if untouched: `--delete` at the bucket root (§6, standing
rule) would erase every other language the moment a second repo lands in this bucket, and
the absence of any `Cache-Control` means every page — not just the three explicitly
invalidated files — rides CloudFront's default TTL until it happens to expire.

## Bucket layout

One bucket, one prefix per language, **no locale segment** in the per-language tree:

```
s3://libtmux-docs/py/v0.46.2/...        immutable tag
s3://libtmux-docs/py/stable/...         separate build, own canonical (§2.3)
s3://libtmux-docs/py/latest/...         separate build, rebuilt on trunk
s3://libtmux-docs/rs/v1.2.3/...         (rs is the fixed prefix, §7.4)
s3://libtmux-docs/manifest/py.json      one small fragment per repo, exclusive owner
s3://libtmux-docs/                      shell root — the shell repo's own prefix
s3://libtmux-docs/ja/                   shell prose, Japanese
```

Prefix names below the language segment follow §1's URL scheme (`{lang}/{version-or-
alias}/...`); everything below `/lang/` is that language repo's exclusive write
territory. Only `py` (existing) and `rs` (§7.4) are ledger-fixed; the other six
(`ts`, `go`, `java`, `dotnet`, `cxx`, `swift`) are this document's working names pending
`11-information-architecture.md`.

The locale axis exists only for shell prose (`/ja/concepts/...`), which lives at the
bucket root under the shell repo's own prefix, never inside a language tree — reference
content is never localised (ledger §3, "reference, never localised"). If per-port guide
prose is ever made translatable (open question, ledger §7.10 item 5), it would need its
own segment under that language's prefix; nothing in this layout forecloses it, but it
is not part of today's design.

Keep `LIBTMUX_DOCS_BUCKET` as the secret name (ledger §7.3) — the bucket itself is
renamed in spirit, not in the CI wiring.

## Origin access, the edge function, and the 404 gap

Front the bucket with the S3 **REST** endpoint under Origin Access Control, not the
website endpoint — OAC requires the REST endpoint and keeps the bucket fully private;
the website endpoint is HTTP-only and requires public objects. The cost of OAC is that
the REST endpoint has no built-in `/foo/` → `/foo/index.html` rewrite, so that logic has
to live in a viewer-request CloudFront Function. Swift DocC needs **no special case**
here: `--transform-for-static-hosting` walks every `data/**/*.json` in the archive and
writes a real `index.html` per route (ledger §2.2) — every DocC route is a genuine S3
object, exactly like the other seven languages' output.

Bucket policy granting CloudFront read access, scoped to one distribution:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontServicePrincipalReadOnly",
      "Effect": "Allow",
      "Principal": { "Service": "cloudfront.amazonaws.com" },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::libtmux-docs/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::<ACCOUNT_ID>:distribution/<DISTRIBUTION_ID>"
        }
      }
    }
  ]
}
```

The viewer-request function (`cloudfront-js-2.0`, well under the 10 KB size quota):

```js
import cf from 'cloudfront';
const kvsHandle = cf.kvs();

async function handler(event) {
    const request = event.request;
    const uri = request.uri;
    const parts = uri.split('/'); // ['', lang, rest...]

    // Bare language root only: "/py" or "/py/" -> 302 to that language's
    // current default version+alias. parts[2] must be absent (undefined,
    // "/py") or empty ("/py/") -- a qualified path like "/py/v0.46.2" or
    // "/py/stable" (missing its trailing slash) must NOT hit this branch,
    // or it silently gets redirected to the wrong version.
    if (parts[1] && !parts[2]) {
        try {
            const dest = await kvsHandle.get(`${parts[1]}:default`);
            return {
                statusCode: 302,
                statusDescription: 'Found',
                headers: {
                    location: { value: `/${parts[1]}/${dest}/` },
                    'cache-control': { value: 'no-store' },
                },
            };
        } catch (err) {
            // Not a reference-language root (e.g. a bare locale prefix
            // like "/ja") -- fall through to the generic redirect below.
        }
    }

    if (uri.endsWith('/')) {
        request.uri = uri + 'index.html';
        return request;
    }

    const lastSegment = uri.slice(uri.lastIndexOf('/') + 1);
    if (!lastSegment.includes('.')) {
        // Directory-style route with no trailing slash: redirect, don't
        // silently rewrite, so there is exactly one canonical URL per page.
        return {
            statusCode: 301,
            statusDescription: 'Moved Permanently',
            headers: {
                location: { value: uri + '/' },
                'cache-control': { value: 'public, max-age=86400' },
            },
        };
    }

    return request;
}
```

Self-check, traced against the fixed condition:

| Request URI | Branch taken | Result |
|---|---|---|
| `/` | trailing-slash | rewrite to `/index.html` |
| `/py` | KVS (`parts[2]` undefined) | 302 → `/py/stable/` |
| `/py/` | KVS (`parts[2]` is `""`) | 302 → `/py/stable/` |
| `/py/stable` | falls through KVS, no dot | 301 → `/py/stable/` |
| `/py/v0.46.2/` | trailing-slash | rewrite to `/py/v0.46.2/index.html` |
| `/ja/concepts` | KVS misses (`ja` not a key), falls through, no dot | 301 → `/ja/concepts/` |
| `/rs/stable/libtmux/struct.Session.html` | has a dot | pass through unchanged |
| `/manifest/py.json` | has a dot | pass through unchanged |

The original bare-root condition proposed in the CDN research (`parts.length <= 3 &&
parts[1]`) is a bug: it also matches `/py/v0.46.2` and `/py/stable` (three parts, no
trailing slash) and 302s them to the *default* alias instead of adding their own trailing
slash — a `/py/latest` typo-of-a-slash would silently redirect to `/py/stable/` instead
of `/py/latest/`. The fix above requires `parts[2]` to be absent or empty. One residual
edge case worth naming rather than hiding: a bare immutable tag missing its slash, e.g.
`/py/v0.46.2` with no trailing `/`, has a dot in its last segment (`v0.46.2`) and so is
treated as a file and passed straight to the origin, which 403s. Every internal link this
site emits carries a trailing slash on directory routes, so this only bites a hand-typed
URL — acceptable, but worth a line in the shell's own link-checker.

**The 404 gap (ledger §7.10 item 1).** A missing object behind OAC returns S3's raw
`AccessDenied` XML, not a styled page — OAC's private-bucket model has no equivalent of
a website endpoint's error document. Fix it with a CloudFront custom error response
remapping 403 to 404:

| Error code | Response code | Response page path | Error caching min TTL |
|---|---|---|---|
| 403 | 404 | `/404.html` | set explicitly, e.g. `60` seconds |

Set `ErrorCachingMinTTL` to a chosen number rather than relying on CloudFront's default —
that sidesteps quoting an unverified default, and a low value means a page published
moments after a stale 403 was cached doesn't stay 404-shaped for long. One `/404.html`,
owned by the shell and served from the bucket root, not per-language — a single page
avoids eight generators each needing their own error template. Two caveats worth stating
plainly: this remap also hides a genuine OAC misconfiguration behind the same 404 page
(a broken bucket policy looks identical to a missing page), and an extensionless typo
gets a 301 from the function above *before* it ever reaches this 403→404 path, since the
function runs first and always appends a trailing slash to anything without a dot.

## Cache-Control per path class, and why every release needs two sync passes

`aws s3 sync` applies one `--cache-control` value to every object a given invocation
uploads — a distinct header value is a distinct sync pass, by construction. Ledger §2.3
independently forces the same split for a different reason: `/stable/` and `/latest/`
must be **separate builds** from the tag they alias, with the base-path/canonical flag
set to the alias's own URL, because 6 of 7 generators emit page-relative links but every
one that emits a canonical tag or sitemap bakes an absolute URL at build time — serving
identical bytes at two prefixes creates real duplicate content with no dedup signal
(empirically confirmed: `doc.rust-lang.org` serves byte-identical `/book/` and
`/stable/book/` with no canonical tag on either). So each release already produces two
distinct builds; giving them two distinct Cache-Control values is the same pass, not an
extra one:

| Path class | Cache-Control | Sync cadence |
|---|---|---|
| Immutable tag (`/py/v0.46.2/`) | `public, max-age=31536000, immutable` | once, ever |
| Mutable alias (`/py/stable/`, `/py/latest/`) | `public, max-age=0, s-maxage=300` | every push/release |

Don't split by file extension instead — `searchindex.js`, `objects.inv`, `sitemap.xml`
are non-HTML *and* mutable, exactly why today's workflow invalidates two of them by name;
an `--exclude "*.html"` pass would wrongly hand them a year of `immutable`. An optional
third pass — genuinely content-hashed assets under an alias (`_astro/*`, `static.files/*`,
`pagefind/*.pf_*`) getting `immutable` even though the surrounding HTML around them is
short-TTL — is a browser-cache optimization, not a correctness requirement, since the
wildcard invalidation below already covers the alias on every push. If a second or third
pass is run, put `--delete` on **all** of them scoped to the exact same prefix — files
excluded from one pass are excluded from that pass's delete too, so a single-pass
`--delete` orphans objects the other passes never touch.

Corrected, scoped syncs (never the bucket root — today's live bug):

```console
$ aws s3 sync docs/_build/html/ \
    s3://libtmux-docs/py/v0.46.2/ \
    --delete \
    --cache-control "public, max-age=31536000, immutable"
```

```console
$ aws s3 sync docs/_build/html/ \
    s3://libtmux-docs/py/stable/ \
    --delete \
    --cache-control "public, max-age=0, s-maxage=300"
```

One migration note: `sync` only sets headers on objects it uploads, so every already-
published prefix from before this scheme has no `Cache-Control` at all and needs one
backfill pass (`aws s3 cp --recursive --metadata-directive REPLACE` against each existing
prefix) to pick up its class's header. And none of this does anything unless the
distribution's cache behavior actually forwards origin `Cache-Control` — attach a policy
that honors it (the managed `CachingOptimized` policy, or a custom one with min/default
TTL at 0) rather than a fixed-TTL policy that ignores the header entirely.

## Invalidation: mutable pointers only

Invalidate `/py/stable/*`, `/py/latest/*`, the shell's own paths, and the manifest — never
a whole language root such as `/py/*` (ledger §7.5). Immutable tag prefixes never change
their bytes, so invalidating them is pure cost for zero effect:

```console
$ aws cloudfront create-invalidation \
    --distribution-id "$LIBTMUX_DOCS_DISTRIBUTION" \
    --paths "/py/stable/*"
```

Invalidation is 1,000 free paths per **account**, not per distribution, and a wildcard
like `/py/stable/*` counts as one path regardless of how many objects it matches — every
invalidation in this design is a single wildcard, immaterial at any realistic deploy
cadence.

Cloudflare sits in front and does not see CloudFront's invalidation at all — it has its
own edge cache. With Cache Rules set to respect origin headers, a mutable path's
`s-maxage=300` bounds Cloudflare's own staleness window to 5 minutes after a deploy; that
is the number to accept if the goal is dropping today's `jakejarvis/cloudflare-purge-
action` step. If 5 minutes of possible staleness after a push is unacceptable, keep the
existing purge-everything step as a zero-staleness fallback layered on top — don't claim
the purge step becomes unconditionally unnecessary without naming that trade.

## Identity: OIDC trust, per-prefix permissions, and fork PRs

Trust policy for the docs deploy role — `git remote -v` across the checkouts confirms the
repos are not one org (`tmux-python/libtmux` plus `libtmux/libtmux-ts`, `-rs`, `-go`,
`-java`, `-dotnet`, `-cxx`, `-swift`), so both patterns are needed, plus the shell repo
explicitly — it does not match the `libtmux-*` glob used for the eight language ports:

```json
{
  "Effect": "Allow",
  "Principal": {
    "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
  },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
    },
    "StringLike": {
      "token.actions.githubusercontent.com:sub": [
        "repo:tmux-python/libtmux:environment:docs",
        "repo:libtmux/libtmux-*:environment:docs",
        "repo:libtmux/libtmux.org:environment:docs"
      ]
    }
  }
}
```

The last entry's exact name is a placeholder for the shell repo — confirm it before
shipping, since it will not be caught by the `libtmux-*` glob. Two things this policy
does *not* enforce: setting `environment: docs` (already done today) rewrites the `sub`
to `repo:ORG/REPO:environment:docs`, which **drops the `ref:` clause entirely** — so
"trunk, tags, release branches only" is enforced by each repo's GitHub Environment
**deployment branch policy** (Settings → Environments → `docs` → protected branches plus
a `v*` tag pattern), not by this IAM condition.

Per-prefix permissions, one role (or one role per language) — this is the actual fix for
the `--delete` footgun: a root-scoped `--delete` under this policy fails with
`AccessDenied` instead of silently erasing seven other languages:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListOwnPrefixOnly",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::libtmux-docs",
      "Condition": { "StringLike": { "s3:prefix": ["py/*"] } }
    },
    {
      "Sid": "ReadWriteOwnPrefixOnly",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::libtmux-docs/py/*"
    },
    {
      "Sid": "InvalidateOwnDistribution",
      "Effect": "Allow",
      "Action": "cloudfront:CreateInvalidation",
      "Resource": "arn:aws:cloudfront::<ACCOUNT_ID>:distribution/<DISTRIBUTION_ID>"
    },
    {
      "Sid": "UpdateSharedKvs",
      "Effect": "Allow",
      "Action": "cloudfront-keyvaluestore:UpdateKeys",
      "Resource": "arn:aws:cloudfront::<ACCOUNT_ID>:key-value-store/<KVS_ID>"
    }
  ]
}
```

`cloudfront:CreateInvalidation` and `cloudfront-keyvaluestore:UpdateKeys` cannot be
scoped by path or key at the IAM level — they are distribution-wide and store-wide
actions. The S3 statements are the real containment boundary; the CloudFront ones rely
on each repo's own workflow only ever calling them with its own paths and key, per §6's
"give each repository an exclusive manifest key" rule.

**Fork PRs get no secrets on `pull_request`, by design** — and `pull_request_target` with
a checkout of PR head content is a well-documented foot-gun: it hands production
credentials to a job running fork-controlled build scripts. Recommended split: `pull_
request` builds with no OIDC and no secrets, uploads the built HTML plus a JSON sidecar
(`{"pr": N, "sha": "..."}`) as an artifact; a `workflow_run` job — which runs the workflow
file from the default branch, in the base repo's trust context, immune to fork tampering —
triggers on completion, downloads the artifact via `actions/download-artifact@v4` with
`run-id: ${{ github.event.workflow_run.id }}`, assumes a **separate** `docs-preview`
OIDC role and environment (so a compromised preview role cannot touch the prod prefix),
and syncs to `s3://libtmux-docs-preview/py/pr-<N>/` on a distribution kept fully separate
from prod — a fork's build executes arbitrary `conf.py`/build-script code, and sharing an
origin with `libtmux.org` would let that code's rendered page read prod cookies/storage.

Cleanup runs on `pull_request_target: types: [closed]`, which is safe specifically
because it never checks out PR code — it only reads `github.event.number` to compute and
delete the PR's preview prefix. Whether `pull_request_target`'s `sub` claim matches
`pull_request`'s documented `repo:ORG/REPO:pull_request` format is **unverified**; give
this job its own GitHub Environment (e.g. `docs-preview-cleanup`) with its own trust
entry rather than assuming it reuses `docs-preview`'s. Add an S3 lifecycle rule expiring
objects under `*/pr-*/` after 14 days as a backstop for any cleanup run that never fires,
and comment the preview URL back onto the PR with `actions/github-script` from the
`workflow_run` job.

## Subpath vs. subdomain

Firm recommendation: **subpath** (`libtmux.org/py/`), matching ledger §1's URL scheme.

| | Subpath | Subdomain |
|---|---|---|
| ACM cert | one, no wildcard | wildcard required |
| CloudFront distributions | one | one is still possible via a `Host`-header function, but buys nothing |
| Search index | one Pagefind index, filterable by path prefix | eight indexes, or one with cross-origin wiring |
| Cookies (theme, locale) | shared automatically | isolated per subdomain unless deliberately synced |
| SEO | consolidated authority | eight domains, each starting at zero |

The one real cost of subpath is that every generator needs its base-path flag wired
correctly: Sphinx's `html_baseurl`, DocC's `--hosting-base-path`, and the equivalent
`base`/root-relative setting for the remaining six.

## CloudFront KeyValueStore: scoped to the bare-root redirect, nothing else

One KVS, associated with the function above, holding only `{lang}:default` → alias pairs
(8 keys, `py:default` → `stable`, and so on) — never a rewrite target for an
already-qualified `/lang/version/...` URI, because DocC, and any future toolchain that
bakes an absolute base path the way it does, would desync its own router from
`location.pathname` if the CDN silently swapped the version underneath it (§2.3).

| Limit | Value |
|---|---|
| Max key size | 512 bytes |
| Max value size | 1 KB |
| Max store size | 5 MB |
| `update-keys` batch | 50 keys / 3 MB |
| KVS per function | 1 |
| KVS per account | 200 |

Reads inside the function are **Promise-based**, not synchronous — `await
kvsHandle.get(...)` inside an `async function handler`, as written above; there is no
outbound network call at read time, values are decrypted in memory at the edge, but the
call still returns a Promise. AWS documents no propagation-delay SLA between an
`update-keys` call and a running function observing the new value — do not state a
number for it anywhere.

```console
$ aws cloudfront-keyvaluestore update-keys \
    --kvs-arn "$LIBTMUX_DOCS_KVS_ARN" \
    --if-match "$ETAG" \
    --puts '[{"Key":"py:default","Value":"stable"}]'
```

`--if-match`, fetched first via `describe-key-value-store`, gives optimistic-concurrency
protection if two deploys race the same store — in practice unlikely, since each
language's release cadence rarely overlaps another's within the same few seconds.

## Cost sanity check

A niche docs site should sit inside CloudFront's Free plan: 1M requests and 100 GB
transfer per month, with viewer-request Functions included. The Pro tier is a flat
$15/month for 10M requests and 50 TB if an unusual spike (an HN front page, say) blows
through Free. Every invalidation in this design is a single wildcard path, so the
1,000-free-paths-per-account-per-month quota is never in reach. S3 storage for eight
languages' worth of HTML/reference pages, even across dozens of tag prefixes, is a few
GB — cents per month at standard storage rates. KVS storage and reads are described as
bundled into function-invocation pricing on AWS's own pricing page, but that page does
not itemize the KVS cost line explicitly — treat that bundling as **unconfirmed** rather
than load-bearing. Net: expect this architecture to run free indefinitely at current
traffic, with Pro as the only line item to budget for if traffic materially grows.

## A real GitHub Actions deploy job

Concurrency **must** use `queue: max` (ledger §7.6) — the alternative silently drops
pending runs instead of queuing them, and cannot be combined with
`cancel-in-progress: true`.

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
  deploy:
    runs-on: ubuntu-latest
    environment: docs
    steps:
      - uses: actions/checkout@v7

      - name: Build documentation
        run: cd docs && just html

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: ${{ secrets.LIBTMUX_DOCS_ROLE_ARN }}
          aws-region: us-east-1

      - name: Sync immutable tag prefix
        if: startsWith(github.ref, 'refs/tags/v')
        run: |
          aws s3 sync docs/_build/html/ \
            "s3://${{ secrets.LIBTMUX_DOCS_BUCKET }}/py/${{ github.ref_name }}/" \
            --delete \
            --cache-control "public, max-age=31536000, immutable"

      - name: Sync mutable stable alias
        if: startsWith(github.ref, 'refs/tags/v')
        run: |
          aws s3 sync docs/_build/html/ \
            "s3://${{ secrets.LIBTMUX_DOCS_BUCKET }}/py/stable/" \
            --delete \
            --cache-control "public, max-age=0, s-maxage=300"

      - name: Sync mutable latest alias
        if: github.ref == 'refs/heads/master'
        run: |
          aws s3 sync docs/_build/html/ \
            "s3://${{ secrets.LIBTMUX_DOCS_BUCKET }}/py/latest/" \
            --delete \
            --cache-control "public, max-age=0, s-maxage=300"

      - name: Invalidate mutable pointers only
        if: startsWith(github.ref, 'refs/tags/v') || github.ref == 'refs/heads/master'
        run: |
          aws cloudfront create-invalidation \
            --distribution-id "${{ secrets.LIBTMUX_DOCS_DISTRIBUTION }}" \
            --paths "/py/stable/*" "/py/latest/*"
```

The `stable` alias's own build (with `html_baseurl` or its per-generator equivalent
pointed at the alias URL, per §2.3) is a separate build step from the tag build in a real
pipeline — collapsed above to one `just html` invocation for a repo where the two happen
to produce the same base-relative output; a generator with an absolute base path (DocC)
needs two distinct `docc convert --hosting-base-path` invocations here, not one build
reused for two syncs. Fork-PR builds and the `workflow_run` preview deploy are a separate
workflow file, per the identity section above; full multi-repo CI choreography is
`07-ci-topology.md`'s scope, not this document's.
