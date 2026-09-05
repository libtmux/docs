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
| Immutable tag | `/py/v0.46.2/` | `tag` | `public, max-age=31536000, immutable` | once, at release, never rewritten | never |
| Rebuilt version prefix | `/py/v0.x/` | `branch` | `public, max-age=0, s-maxage=300` | every push to that branch | yes, `/py/v0.x/*` |
| Mutable alias | `/py/stable/`, `/py/latest/` | `alias`, `trunk` | `public, max-age=0, s-maxage=300` | every release / every push to trunk | yes, `/<port>/<alias>/*` |
| PR preview | `/py/pr-123/` | `pr` | `public, max-age=0, s-maxage=300` | every push to the PR | yes, `/py/pr-123/*` (own preview bucket/distribution — see README) |
| Version manifest | `/versions.json` | — | `public, max-age=0, s-maxage=60` (or `no-cache`) | every publish, any port | yes, `/versions.json` |
| Shell + locale roots | `/`, `/ja/`, `/concepts/…` | — | `public, max-age=0, s-maxage=300` | every shell push | yes, shell's own paths |
| Error page | `/404.html` | — | `public, max-age=0, s-maxage=300` | every shell push | yes, `/404.html` |
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

## Invalidation: mutable pointers only

Invalidate the exact prefixes marked "yes" above — never a whole language
root such as `/py/*`, which would also invalidate every immutable tag
underneath it for zero benefit (their bytes never change, so there is nothing
stale to clear):

```console
$ aws cloudfront create-invalidation \
    --distribution-id "$LIBTMUX_DOCS_DISTRIBUTION" \
    --paths "/py/stable/*"
```

Invalidation quota is 1,000 free paths per **account** per month, not per
distribution, and a wildcard like `/py/stable/*` counts as a single path
regardless of how many objects match it — every invalidation this policy
issues is one wildcard, so the quota is not a practical constraint at any
realistic release cadence.

Cloudflare, sitting in front of CloudFront (README), never sees a CloudFront
invalidation — it has its own edge cache. With Cache Rules set to respect
origin headers, `s-maxage=300` bounds Cloudflare's own staleness window to five
minutes after a deploy; that is the trade to accept if the goal is dropping
the existing purge-everything step. If five minutes of possible staleness is
unacceptable, keep a purge-on-deploy step as a zero-staleness fallback layered
on top of, not instead of, the Cache-Control split above.
