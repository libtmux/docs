/**
 * Viewer-request function for the libtmux.org CloudFront distribution.
 * Runtime: cloudfront-js-2.0.
 *
 * Three rules, and the order matters. The KVS lookup runs first because both
 * bare forms it targets would otherwise be swallowed: `/py` has no extension,
 * so rule 3 would 301 it to `/py/` and stop; `/py/` ends in `/`, so rule 2
 * would append `index.html` and hand the origin a 403. Running the lookup
 * first is what makes "redirect to the default version" and "append
 * index.html" mutually exclusive for those two URIs. Rules 2 and 3 cannot
 * conflict with each other — one requires a trailing slash, the other
 * requires none — so their order is free.
 *
 * Swift's DocC output needs no fourth rule: `--transform-for-static-hosting`
 * writes a real index.html per route, so every DocC page is a genuine S3
 * object. An SPA fallback here would only paper over a non-static build.
 *
 * Stay under CloudFront Functions' 10 KB quota, which counts these comments.
 * Re-check `wc -c` after editing.
 */
import cf from 'cloudfront'

const kvsHandle = cf.kvs()

async function handler(event) {
    const request = event.request
    const uri = request.uri
    const parts = uri.split('/') // '/py/stable/' -> ['', 'py', 'stable', '']

    // --- 1. Bare language root: "/py" or "/py/" -> 302 to that port's
    // current default version (e.g. "/py/stable/"), looked up in the KVS.
    //
    // The guard has three parts, all necessary:
    //   - parts[1] truthy:            there is a first segment at all (not "/").
    //   - !parts[1].includes('.'):    excludes root-level *files* that also
    //     have an empty/undefined parts[2] but are not a port slug —
    //     "/versions.json", "/404.html", "/robots.txt", "/favicon.ico".
    //     Without this, each of those pays for a KVS lookup that can only
    //     ever miss.
    //   - !parts[2]:                  parts[2] is undefined for "/py" and ""
    //     for "/py/" (split's empty trailing element) — either way, nothing
    //     follows the first segment. A qualified path like "/py/v0.46.2" or
    //     "/py/stable" has a truthy parts[2] and must NOT hit this branch:
    //     it already names a real version and must get its own trailing
    //     slash (rule 3 below), not be redirected to a *different* version.
    if (parts[1] && !parts[1].includes('.') && !parts[2]) {
        try {
            // Key shape "<slug>:default", value the alias slug it resolves
            // to — mirrors versions.ts's `defaultVersion: Record<port, slug>`
            // one-for-one. CI writes these with `update-keys --if-match` as
            // part of publishing a build that changes a port's default.
            const dest = await kvsHandle.get(`${parts[1]}:default`)
            return {
                statusCode: 302,
                statusDescription: 'Found',
                headers: {
                    location: { value: `/${parts[1]}/${dest}/` },
                    // A pointer to a pointer: never cache the redirect
                    // itself, only the page it lands on (cache-policy.md).
                    'cache-control': { value: 'no-store' },
                },
            }
        } catch (_err) {
            // kvsHandle.get() rejects both when the key is absent (this
            // isn't a port slug — e.g. the locale root "/ja") and when the
            // store itself is unreachable. Either way the right move is the
            // same: fall through to the generic rules below rather than
            // surfacing a 500 for what is, from the reader's side, an
            // ordinary path.
        }
    }

    // --- 2. Directory index: OAC's S3 REST origin has no built-in "/foo/"
    // -> "/foo/index.html" rewrite (that behaviour belongs to the S3
    // *website* endpoint, which OAC cannot front). Every generator in this
    // build emits a real index.html per directory, so a plain rewrite (not
    // a redirect — the URL the reader sees does not change) is enough.
    if (uri.endsWith('/')) {
        request.uri = `${uri}index.html`
        return request
    }

    // --- 3. Page path without its trailing slash: redirect, don't rewrite.
    // A rewrite would serve the same bytes at two URLs ("/py/stable" and
    // "/py/stable/"); a redirect keeps exactly one canonical URL per page,
    // which is what Seo.astro's canonical tag and the sitemap both assume.
    //
    // "Is this a file?" is decided by the extension, not by "contains a
    // dot". Testing for a dot looks equivalent and is not: three kinds of
    // real page carry one in their last segment — a version tag
    // ("/py/v0.46.2"), a .NET type ("/dotnet/stable/api/libtmux.client",
    // 215 of them), and a locale-tagged path — and each was silently
    // treated as a file, passed through, and 403'd at the origin. The
    // allowlist below is every extension this build actually emits.
    const lastSegment = uri.slice(uri.lastIndexOf('/') + 1)
    const dot = lastSegment.lastIndexOf('.')
    const ext = dot === -1 ? '' : lastSegment.slice(dot + 1).toLowerCase()
    if (!ASSET_EXTENSIONS[ext]) {
        return {
            statusCode: 301,
            statusDescription: 'Moved Permanently',
            headers: {
                location: { value: `${uri}/` },
                'cache-control': { value: 'public, max-age=86400' },
            },
        }
    }

    return request
}

/**
 * Every extension the assembled tree emits. An object, not a Set: property
 * lookup is the cheapest membership test in this runtime.
 *
 * A missing extension is not cosmetic. `objects.inv` is how every external
 * Sphinx project resolves an intersphinx reference into this site; redirected
 * to a trailing slash it 403s, and cross-references from other projects stop
 * resolving with nothing here reporting it.
 *
 * `scripts/check-edge-extensions.mjs` holds this list to what the build
 * actually emits, because a hand-kept list drifts the moment a generator adds
 * a file type.
 */
const ASSET_EXTENSIONS = {
    html: 1, htm: 1, xml: 1, txt: 1, json: 1, js: 1, mjs: 1, map: 1, css: 1,
    svg: 1, png: 1, jpg: 1, jpeg: 1, gif: 1, webp: 1, avif: 1, ico: 1,
    woff: 1, woff2: 1, ttf: 1, otf: 1, eot: 1,
    md: 1, pdf: 1, zip: 1, gz: 1, wasm: 1, pf_meta: 1, pf_fragment: 1,
    pf_index: 1, pf_filter: 1, pagefind: 1, log: 1, yml: 1, yaml: 1,
    doccarchive: 1, inv: 1, buildinfo: 1,
}

/**
 * Self-check — traced by hand against the three rules above, in order.
 * "port" below means any of the eight slugs in ports.ts (PORT_BY_SLUG);
 * the function itself has no list of them, it trusts the KVS lookup to
 * miss for anything that isn't one.
 *
 * | Request URI                              | Rule that fires        | Result                                   |
 * |-------------------------------------------|-------------------------|-------------------------------------------|
 * | `/`                                        | 2 (directory index)     | rewrite -> `/index.html`                   |
 * | `/py`                                      | 1 (KVS, parts[2] undef) | 302 -> `/py/stable/` (or whatever `py:default` holds) |
 * | `/py/`                                     | 1 (KVS, parts[2] "")    | 302 -> `/py/stable/`                       |
 * | `/rs`                                      | 1 attempted, KVS misses | falls through to rule 3: 301 -> `/rs/`, then rule 2 serves `/rs/index.html` — rs, go and java publish no version prefix, so they get no `<slug>:default` key to point at (notes/decisions/port-root-redirect.md) |
 * | `/py/stable`                                | 3 (extensionless)       | 301 -> `/py/stable/`                       |
 * | `/py/stable/`                               | 2 (directory index)     | rewrite -> `/py/stable/index.html`         |
 * | `/py/latest`                                | 3 (extensionless)       | 301 -> `/py/latest/` (never the KVS default — `parts[2]` is truthy) |
 * | `/py/v0.46.2/`                              | 2 (directory index)     | rewrite -> `/py/v0.46.2/index.html`        |
 * | `/py/v0.46.2` (no trailing slash)           | 3 (`2` is not an asset extension) | 301 -> `/py/v0.46.2/` |
 * | `/dotnet/stable/api/libtmux.client`         | 3 (`client` is not an asset extension) | 301 -> `/dotnet/stable/api/libtmux.client/` |
 * | `/py/stable/_astro/x.css`                   | none (`css` is an asset extension) | passes through unchanged        |
 * | `/swift/stable/documentation/libtmux/`      | 2 (directory index)     | rewrite -> `.../index.html` — a real DocC-emitted object, no SPA fallback needed |
 * | `/ja`                                      | 1 attempted, KVS misses | falls through to rule 3: 301 -> `/ja/`     |
 * | `/ja/`                                     | 1 attempted, KVS misses | falls through to rule 2: rewrite -> `/ja/index.html` |
 * | `/ja/concepts`                              | 3 (extensionless)       | 301 -> `/ja/concepts/`                     |
 * | `/versions.json`                            | none (dot excludes rule 1, `json` is an asset extension) | passes through unchanged |
 * | `/404.html`                                 | none (same as above)    | passes through unchanged                   |
 *
 * Rule 3's redirect is safe for a genuinely missing path too: `/nope` 301s to
 * `/nope/`, which rule 2 turns into `/nope/index.html`, which 403s and is
 * remapped to `/404.html`. One extra hop, same destination.
 */
