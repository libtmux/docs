import type { APIRoute } from 'astro'

/**
 * robots.txt, generated so it can name the sitemap by absolute URL.
 *
 * A static file in `public/` cannot: the sitemap's host is `site` from
 * `astro.config.ts`, and a preview deploy has a different one. Hard-coding
 * `https://libtmux.org/sitemap-index.xml` into a PR preview points crawlers
 * at production from a page that is itself `noindex`, which is the wrong
 * signal from the wrong host.
 *
 * The crawl rules deliberately restate what `Seo.astro` already puts in a
 * `robots` meta tag rather than replacing it. The meta tag is authoritative
 * per page and covers end-of-life and non-default versions with the nuance
 * they need (`noindex, follow` — do not list this, but do follow it home).
 * This file exists for the coarser job: keeping a crawler out of preview and
 * demo trees it should never have queued in the first place, and out of
 * Pagefind's index shards, which are large, numerous and meaningless as pages.
 */
export const GET: APIRoute = ({ site }) => {
  const sitemap = site ? new URL('sitemap-index.xml', site).href : '/sitemap-index.xml'

  const body = `# https://www.robotstxt.org/robotstxt.html
User-agent: *
Allow: /

# Pull-request previews. Every page in one is already noindex; this keeps
# them from being fetched at all.
Disallow: /pr-

# Component and layout demos: real URLs, no reader-facing content.
Disallow: /demo

# Pagefind's index shards — binary fragments, not documents.
Disallow: /pagefind/

Sitemap: ${sitemap}
`

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
