/**
 * Whether a sitemap should list a page, decided by the page's own head.
 *
 * A sitemap that lists a page the page itself marks `noindex`, redirects away
 * from, or canonicalises elsewhere contradicts that page. Reading the verdict
 * from the rendered head keeps one policy in one place: `Seo.astro` and the
 * native pages decide, and every sitemap follows, whichever renderer wrote the
 * page and whatever the policy is later promoted to.
 */

const TAG = /<(meta|link)\b([^>]*)>/gi

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined
}

const comparable = (url: string): string => {
  try {
    const { origin, pathname } = new URL(url)
    return `${origin}${pathname.replace(/\/+$/, '')}`
  } catch { return url }
}

export interface HeadVerdict {
  listed: boolean
  /** Why a page stays out of the sitemap. */
  reason?: 'noindex' | 'redirect' | 'canonical'
}

/**
 * The verdict for the page served at `url`, from its HTML.
 *
 * A page with no robots tag and no canonical, as a Sphinx page is, is listed:
 * absence of a restriction is not a restriction.
 */
export function headVerdict(html: string, url: string): HeadVerdict {
  const end = html.search(/<\/head\s*>/i)
  const head = end < 0 ? html : html.slice(0, end)
  let canonical: string | undefined
  for (const [, element, attributes] of head.matchAll(TAG)) {
    if (element!.toLowerCase() === 'meta') {
      const name = attribute(attributes!, 'name')?.toLowerCase()
      const equiv = attribute(attributes!, 'http-equiv')?.toLowerCase()
      if (equiv === 'refresh') return { listed: false, reason: 'redirect' }
      if (name === 'robots' && /\bnoindex\b/i.test(attribute(attributes!, 'content') ?? '')) return { listed: false, reason: 'noindex' }
    } else if (/\bcanonical\b/i.test(attribute(attributes!, 'rel') ?? '') && canonical === undefined) {
      canonical = attribute(attributes!, 'href')
    }
  }
  if (canonical !== undefined && comparable(canonical) !== comparable(url)) return { listed: false, reason: 'canonical' }
  return { listed: true }
}
