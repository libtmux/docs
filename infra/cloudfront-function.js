/**
 * Viewer-request function for the libtmux.org CloudFront distribution.
 * Runtime: cloudfront-js-2.0.
 *
 * Four rules, and the order matters. The origin root is answered first and
 * alone; every other path is already below a locale. The KVS lookup runs next
 * because both
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

/** The locale the site is published under. Every page lives below it. */
const DEFAULT_LOCALE = 'en'

async function handler(event) {
    const request = event.request
    const uri = request.uri
    const parts = uri.split('/') // '/py/stable/' -> ['', 'py', 'stable', '']

    // --- 0. The origin root. Every page is published under a locale, so the
    // bare root is the one URL with nothing behind it.
    //
    // A fixed target, not negotiated on Accept-Language: a negotiated redirect
    // may not be shared between readers, and this is the site's most linked
    // URL. Cached as a mutable pointer (cache-policy.md), so changing the
    // default locale takes effect within the edge TTL.
    if (uri === '/') {
        return {
            statusCode: 302,
            statusDescription: 'Found',
            headers: {
                location: { value: `/${DEFAULT_LOCALE}/` },
                'cache-control': { value: 'public, max-age=0, s-maxage=300' },
            },
        }
    }

    // --- 1. Bare port root under a locale: "/en/py" or "/en/py/" -> 302 to
    // that port's current default version, looked up in the KVS.
    //
    // Anchored on the locale, so an unprefixed "/py" is not claimed by this
    // rule and falls through to a 404. Ports live below a locale now; the
    // short form belongs to nothing.
    //
    // The rest of the guard:
    //   - parts[2] truthy:            there is a port segment at all.
    //   - !parts[2].includes('.'):    excludes files that sit directly under
    //     the locale — "/en/versions.json", "/en/404.html" — each of which
    //     would otherwise pay for a lookup that can only miss.
    //   - !parts[3]:                  nothing follows the port. "/en/py/stable"
    //     already names a version and must get its own trailing slash from
    //     rule 3, not be redirected to a different one.
    if (parts[1] === DEFAULT_LOCALE && parts[2] && !parts[2].includes('.') && !parts[3]) {
        try {
            // Key shape "<slug>:default", value the alias slug it resolves
            // to — mirrors versions.ts's `defaultVersion: Record<port, slug>`
            // one-for-one. CI writes these with `update-keys --if-match` as
            // part of publishing a build that changes a port's default.
            const dest = await kvsHandle.get(`${parts[2]}:default`)
            return {
                statusCode: 302,
                statusDescription: 'Found',
                headers: {
                    location: { value: `/${parts[1]}/${parts[2]}/${dest}/` },
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
 * The rule each URL shape takes, traced by hand, lives in infra/README.md
 * under "Viewer-request rules". It is prose rather than a comment here
 * because CloudFront counts comments against this file's 10 KB source quota,
 * and the table is the largest thing in it.
 */
