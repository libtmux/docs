# infra

Hosting for libtmux.org: one S3 bucket, one CloudFront distribution with
Origin Access Control, one small viewer-request CloudFront Function, with
Cloudflare kept in front the way it already is today.

## Files here

| File | Owns |
| --- | --- |
| `cloudfront-function.js` | Viewer-request logic: directory index, extensionless-to-trailing-slash redirect, bare-language-root redirect via a CloudFront KeyValueStore. |
| `bucket-policy.json` | Grants the CloudFront distribution (and only that distribution) read access to the bucket, scoped by `AWS:SourceArn`. |
| `cache-policy.md` | `Cache-Control` per path class, why a release needs at least two `sync` passes, and what to invalidate. |

Deploy workflows, the OIDC trust policy, and per-repo IAM live in each port
repo's own CI, not here — this directory is the shared distribution's
configuration, owned once, referenced by every port's pipeline.

## Where this sits today, and where it's going

`libtmux.org` is registered on Cloudflare DNS with **no records yet** — this
is a fresh distribution, not a migration of live traffic.

The existing docs domain, `libtmux.git-pull.com`, already runs the same
layering this design keeps: Cloudflare in front of CloudFront in front of S3
(confirmed from live response headers — `server: cloudflare` alongside
`x-cache: Hit from cloudfront`). Its deploy step syncs Sphinx's `dirhtml`
output to the **bucket root** with `--delete` and sets no `Cache-Control` at
all. Both of those are bugs that must not migrate forward:

- `--delete` at the bucket root erases every other port the moment a second
  one shares the bucket. Every `sync` in this design is scoped to a version
  prefix (`s3://libtmux-docs/py/v0.46.2/`, never `s3://libtmux-docs/`).
- No `Cache-Control` means every page rides CloudFront's default TTL until it
  happens to expire, which is why `libtmux.git-pull.com`'s workflow has to
  invalidate three files by name after every deploy instead of relying on
  headers. `cache-policy.md` replaces "invalidate by name" with "cache by
  class."

## Origin: the S3 REST endpoint, not the website endpoint

OAC requires the bucket's REST endpoint. The S3 *website* endpoint is
HTTP-only and requires the bucket (or the objects in it) to be public, which
defeats the point of OAC. The cost of that choice: the REST endpoint has no
built-in `/foo/` → `/foo/index.html` rewrite — that behavior belongs to the
website endpoint alone — so `cloudfront-function.js` has to do it.

`bucket-policy.json` grants `s3:GetObject` only, to the CloudFront service
principal, conditioned on this one distribution's ARN. It deliberately grants
no `s3:ListBucket`, so a missing object returns a raw `AccessDenied` XML body
with a 403 status, not a 404 — the permission that would let S3 tell the
difference and return `NoSuchKey`/404 is exactly the one this policy omits,
and OAC's private-bucket model has no
equivalent of a website endpoint's error document. Fix that at the
distribution, not the bucket policy: add a custom error response remapping
403 to 404, serving `/404.html`, with `ErrorCachingMinTTL` set to a chosen
number (e.g. `60`) rather than left at whatever CloudFront defaults to today —
a low, explicit value means a page published moments after a stale 403 was
cached doesn't stay 404-shaped for long. One `/404.html`, owned by the shell
and served from the bucket root, not per-port. Worth naming plainly: this
remap also hides a genuine OAC misconfiguration (a broken bucket policy)
behind the same 404 page — if every path 404s, check the policy before
assuming content is missing.

Swift needs no special handling anywhere in this stack.
`--transform-for-static-hosting` writes a real `index.html` per DocC route at
build time (verified against swift-docc's
`StaticHostableTransformer.transform()`, which walks every JSON file under
`data/` in the archive) — every DocC page is a genuine S3 object,
indistinguishable at the origin from the other seven generators' output. Do
not add a SPA fallback for it; there is nothing for a fallback to catch.

## PR previews: a separate bucket and distribution, not a prefix here

`cache-policy.md` lists `/py/pr-123/`-style paths, but they are not written to
`s3://libtmux-docs` at all. A fork's PR build runs that fork's own
`conf.py`/build-script code; sharing prod's bucket and distribution would let
a malicious PR's rendered page read `libtmux.org`'s cookies and storage. The
`pull_request` job therefore gets no AWS credentials and only uploads a build
artifact; a separate `workflow_run` job, running from the base branch in the
base repo's trust context, assumes a distinct `docs-preview` OIDC role and
syncs to its own `s3://libtmux-docs-preview` bucket behind its own
distribution. Give that bucket a lifecycle rule expiring `*/pr-*/` objects
after 14 days as a backstop for any cleanup job that never fires. This
distribution is out of scope for the three files above, which configure
`libtmux-docs` and its distribution only.

## The bare-language-root redirect and its KeyValueStore

`/py` and `/py/` 302 to that port's current default version (normally
`/py/stable/`). The destination comes from one CloudFront KeyValueStore,
associated with `cloudfront-function.js`, holding one key per port slug:

```
py:default     -> "stable"
ts:default     -> "stable"
rs:default     -> "stable"
...
```

This mirrors `versions.ts`'s `VersionManifest.defaultVersion` — a
`Record<portSlug, versionSlug>` — one for one; it exists in the KVS at all
only because a CloudFront Function cannot read `/versions.json` off the
origin at request time. Whichever pipeline publishes a new default version
writes the matching key with `cloudfront-keyvaluestore update-keys
--if-match <etag>` (the `--if-match`, from `describe-key-value-store` first,
guards against two deploys racing the same store). AWS documents no
propagation-delay SLA between that write and a running function observing
the new value — nothing in this repo states a number for it, and nothing
should.

The KVS holds **only** these bare-root pointers, never a rewrite target for
an already-qualified `/<port>/<version>/...` path. DocC bakes an absolute
`--hosting-base-path` into every page it renders; if the edge silently
swapped the version under an already-loaded DocC page, the page's own router
would desync from `location.pathname`. `/py/v0.46.2` and `/py/stable` (note:
no trailing slash) are handled by the *generic* extensionless-redirect rule,
not this one — see the self-check table inside `cloudfront-function.js` for
the full trace, including why the bare-root check has to run before the two
generic rules rather than after them as a naive reading of "directory index,
then redirect, then bare-root" would suggest.

Limits, all enforced by the service rather than by anything in this repo:
key ≤ 512 B, value ≤ 1 KB, store ≤ 5 MB, `update-keys` batch ≤ 50 keys / 3 MB,
one KVS per function. Eight ports at a handful of bytes each is nowhere near
any of these.

## Cloudflare's role

Cloudflare stays in front, proxying (orange-cloud) the zone, exactly as
`libtmux.git-pull.com` does today. It has its own edge cache, entirely
separate from CloudFront's — a CloudFront invalidation does not reach it. With
Cache Rules set to respect origin headers, `cache-policy.md`'s `s-maxage=300`
on mutable paths bounds Cloudflare's own staleness window to five minutes
after a deploy. That is the number to accept if the goal is retiring the
purge-everything step the current pipeline runs on every deploy; if five
minutes of possible staleness is unacceptable, keep a purge step as a
zero-staleness fallback layered on top, not a replacement for the
Cache-Control split.
