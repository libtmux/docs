# Cache-Control policy

`aws s3 sync` sets one `--cache-control` value per invocation — every object it
uploads in that run gets the same header. A path class that needs a different
header therefore needs its own sync pass; this is not extra work layered on
top of the version scheme, it falls out of it. `versions.ts`'s `VersionKind`
already splits every version into "built once, byte-identical forever" (tag)
versus "same prefix, rebuilt whenever something upstream moves" (trunk,
branch, alias, pr), and that split is exactly the cache boundary below.

None of this does anything unless the distribution's cache behavior actually
forwards the origin's `Cache-Control` header — attach the managed
`CachingOptimized` policy, or a custom one with min/default TTL at `0`, not a
fixed-TTL policy that ignores the header outright.

## Path classes

| Path class | Example | `VersionKind` | Cache-Control | Sync cadence | Invalidated? |
| --- | --- | --- | --- | --- | --- |
| Immutable tag | `/en/py/v0.46.2/` | `tag` | `public, max-age=31536000, immutable` | once, at release, never rewritten | never — the bytes never change |
| Rebuilt version prefix | `/en/py/v0.x/` | `branch` | `public, max-age=0, s-maxage=300` | every push to that branch | no — expires in 5 min |
| Mutable alias | `/en/py/stable/`, `/en/py/latest/` | `alias`, `trunk` | `public, max-age=0, s-maxage=300` | every release / every push to trunk | no — expires in 5 min |
| PR preview | `/pr-123/en/` | `pr` | `public, max-age=0, s-maxage=300` | every push to the PR | no — expires in 5 min, and is deleted when the PR closes |
| Version manifest | `/en/versions.json` | — | `public, max-age=0, s-maxage=60` (or `no-cache`) | every publish, any port | no — its own TTL is already a minute |
| Locale landing page | `/en/`, `/ja/` | — | `public, max-age=0, s-maxage=300` | every shell push | **yes** — the one path still spent |
| Origin root | `/` | — | `public, max-age=0, s-maxage=300` | never written; the edge function answers it | cannot be — generated per request, never stored |
| Shell prose | `/en/concepts/…` | — | `public, max-age=0, s-maxage=300` | every shell push | no — expires in 5 min |
| Error page | `/en/404.html` | — | `public, max-age=0, s-maxage=300` | every shell push | no — expires in 5 min |
| Content-hashed assets (optional 3rd pass) | `/py/stable/_astro/*.css` | — | `public, max-age=31536000, immutable` | every push that changes the hash | never (name changes instead) |

Only a `tag` prefix is immutable. A `branch` version (`v0.x`) *looks* like a
version prefix the same shape as a tag, but `versions.ts` documents it as
"Rebuilt on every push" — treat it like an alias for caching purposes, not
like a tag, or a maintenance-branch docs fix will sit stale until someone
notices and invalidates it by hand — and a browser that cached it as
`immutable` won't even revalidate then.

`versions.json` gets its own row because every build's version switcher
fetches it client-side (`versions.ts`'s header comment) — a build published
today must see a version published five minutes from now without a rebuild.
A long-cached copy doesn't just show stale prose, it hides the existence of
whatever just shipped from every switcher on the site until it expires.

Don't split by file extension instead of by path class. `searchindex.js` /
`objects.inv`-equivalents and `sitemap.xml` are non-HTML *and* mutable —
exactly why today's `libtmux.git-pull.com` workflow already invalidates two of
them by name (see README). An `--exclude "*.html"` pass would hand them a
year of `immutable` by accident.

## Why every release needs (at least) two sync passes

A tag release and its rolling alias are separate builds with separate
`base`/canonical-URL flags (Astro's `LIBTMUX_DOCS_BASE` — see
`astro.config.ts`), not one build copied twice: most renderers emit
page-relative links, but every one of them that emits a canonical tag or a
sitemap bakes an *absolute* URL at build time, so serving the tag's bytes
unmodified at the alias's own prefix would be true duplicate content with no
dedup signal. Since the two prefixes already come from two distinct build
outputs, giving each its own `--cache-control` is the natural second `sync`,
not an extra one:

```console
$ aws s3 sync ./dist-v0.46.2/ \
    s3://libtmux-docs/py/v0.46.2/ \
    --delete \
    --cache-control "public, max-age=31536000, immutable"
```

```console
$ aws s3 sync ./dist-stable/ \
    s3://libtmux-docs/py/stable/ \
    --delete \
    --cache-control "public, max-age=0, s-maxage=300"
```

Both passes are scoped to a version prefix, never the bucket root — see
`README.md`'s note on `--delete`.

If a `--cache-control` value ever needs to vary *within* one of these
outputs (the optional third, content-hashed-assets pass), put `--delete` on
every pass that touches the same prefix, scoped identically. `sync --delete`
only removes objects the *current invocation's* file filter would have
uploaded; a file excluded from one pass by `--exclude`/`--include` is excluded
from that pass's delete too, so running one filtered pass with `--delete` and
assuming it cleans up everything under the prefix silently orphans whatever
the other passes never touch.

## Migrating already-published prefixes

`sync` only sets headers on objects it actually uploads. Any prefix published
before this policy existed has no `Cache-Control` at all and needs one
backfill pass to pick up its class's header without re-uploading content:

```console
$ aws s3 cp s3://libtmux-docs/py/stable/ \
    s3://libtmux-docs/py/stable/ \
    --recursive \
    --metadata-directive REPLACE \
    --cache-control "public, max-age=0, s-maxage=300"
```

## Invalidation: almost never

The deploy workflows issue one invalidation path per publish — each locale's
landing page, `/en/` or `/ja/` — and nothing else:

```console
$ aws cloudfront create-invalidation \
    --distribution-id "$LIBTMUX_DOCS_DISTRIBUTION" \
    --paths "/en/"
```

Everything else is left to expire. Every mutable object is written with
`s-maxage=300`, so the edge refreshes it within five minutes unprompted, and
an immutable tag prefix never changes at all — invalidating either clears a
cache entry that was already going to be correct. The landing page is the
exception only because it is what a person reloads to see whether a deploy
landed.

`/` is deliberately not invalidated, and cannot usefully be. The edge
function answers the origin root itself, so CloudFront never stores it:

```console
$ curl -sI https://libtmux.org/ | grep -i x-cache
x-cache: FunctionGeneratedResponse from cloudfront
```

A generated response has no cache entry to clear. `/en/` by contrast answers
`x-cache: Hit from cloudfront` with an `age`, which is what makes a path
spent there worth something.

### What a path costs

The quota is 1,000 free paths per **account** per month — across every
distribution in it, not per distribution, so this site shares the allowance
with every other site in `~/work/tf-config`. Above that, AWS charges per
path.

A wildcard counts as a single path regardless of how many objects it matches:
`/*` against a bucket of 100,000 objects is one path, not 100,000. The charge
is per path *submitted*, so bundling many paths into one `create-invalidation`
call saves nothing — the old shell publish sent about thirty paths per locale
in a single request and was billed for all of them.

That makes the direct cost of invalidation small at any realistic cadence.
It is not why this policy invalidates so little: the reason is that a path
buys five minutes against `s-maxage=300`, and mostly on pages nobody has
requested yet.

See <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/PayingForInvalidation.html>.

### Cloudflare in front

Cloudflare never sees a CloudFront invalidation — it has its own edge cache,
so a purge there is a separate action. Measured on the live site, it is not
currently caching HTML at all:

```console
$ curl -sI https://libtmux.org/en/ | grep -i cf-cache-status
cf-cache-status: DYNAMIC
```

So Cloudflare adds no staleness window today. If that changes — a Cache Rule
that starts respecting `s-maxage` — the bound becomes five minutes after a
deploy, and a purge step would be the way to shorten it.

