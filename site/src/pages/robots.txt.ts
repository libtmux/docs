import type { APIRoute } from 'astro'
import { LOCALES, localeRoot } from '../i18n/locales'

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
  /*
   * Written for the origin root, because that is the only place a crawler
   * reads it — `build-site.sh` lifts this file out of the default locale's
   * tree to the bucket root. So it names every locale's paths, not this
   * build's own: composing through the site root described `/en/` alone and
   * left `/ja/pagefind/` advertised to crawlers as ordinary pages.
   */
  const perLocale = (path: string) => LOCALES.map((l) => `Disallow: ${localeRoot(l)}${path}`).join('\n')
  const sitemapFor = (l: string) => {
    const path = `${localeRoot(l)}sitemap-index.xml`
    return site ? new URL(path, site).href : path
  }

  const body = `# https://www.robotstxt.org/robotstxt.html
User-agent: *
Allow: /

# Pull-request previews. Every page in one is already noindex; this keeps
# them from being fetched at all. Unprefixed: a preview mounts the whole
# site, locales included, at the origin root as /pr-42/ — so this rule sits
# above the locale segment rather than inside one.
Disallow: /pr-

# Component and layout demos: real URLs, no reader-facing content.
${perLocale('demo')}

# Pagefind's index shards — binary fragments, not documents. One index per
# locale, so one rule per locale.
${perLocale('pagefind/')}

${LOCALES.map((l) => `Sitemap: ${sitemapFor(l)}`).join('\n')}
`

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
