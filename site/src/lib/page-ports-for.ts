import { getCollection } from 'astro:content'
import { DEFAULT_LOCALE } from '../i18n/locales'
import { localeOf } from '../i18n/resolve'
import { pagePortLinks, type PagePortLink } from './page-port-links'

/**
 * The other languages this page exists in, for the control on its title row.
 *
 * The inputs — the port defaults from the environment, the docs collection
 * filtered to one locale — were worked out once in `BaseLayout` and needed
 * twice more when the control moved onto the page itself, where it belongs.
 * A layout that renders it should not have to know that the collection has to
 * be narrowed to the default locale first, or that an unconfigured build
 * falls back to each port's latest tree.
 */
export async function pagePortsFor(pagePath: string, portSlug?: string): Promise<PagePortLink[]> {
  let defaults: Record<string, string> = {}
  try {
    defaults = JSON.parse(process.env.LIBTMUX_DOCS_PORT_DEFAULTS || '{}')
  } catch {
    /* Unconfigured builds use each port's latest tree. */
  }
  return pagePortLinks({
    pagePath,
    portSlug,
    version: defaults[portSlug ?? ''] ?? 'latest',
    defaults,
    docs: (await getCollection('docs')).filter((entry) => localeOf(entry.id) === DEFAULT_LOCALE),
  })
}
