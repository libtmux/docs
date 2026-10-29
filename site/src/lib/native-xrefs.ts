import { firstMention, mentionBadge, mentionBadgeNode, plainMention } from './mention-badge'

/**
 * Lead each cross-reference of a native Sphinx article with its kind, as a guide's mention of the same name does.
 *
 * Sphinx writes `a.reference.internal > code.xref`; the badge, the name wrapper and the density rule are the ones the
 * Markdown pipeline writes. The kind is the target's, not the role the author wrote the reference with: `kinds` maps a
 * target's fragment to the kind of the declaration Sphinx wrote there, so a property is marked as one even when it was
 * referenced as an attribute, and an exception when it was referenced as a class. A target without a declaration has no
 * kind and stays as written, as does a reference that leaves the site and a signature, which already states its kinds.
 *
 * The first mention in a section carries the mark and a later one keeps its kind in its tooltip and accessible name. A
 * heading's mention is always marked and does not use up the section's first. Returns how many references it handled,
 * so a repeat visit to a marked article changes nothing.
 */
export function markNativeXrefs(article: Element, kinds: Readonly<Record<string, string>>): number {
  const document = article.ownerDocument
  let first = firstMention()
  let marked = 0
  for (const node of article.querySelectorAll<HTMLAnchorElement>('h1, h2, h3, h4, h5, h6, a.reference.internal')) {
    if (/^H[1-6]$/.test(node.tagName)) { first = firstMention(); continue }
    const code = node.children.length === 1 && node.firstElementChild?.matches('code.xref') ? node.firstElementChild : undefined
    // The fragment is read from the attribute, not the resolved href, so it does not depend on the document's base:
    // a relative href in a document without one (about:blank) resolves differently across Node releases.
    const href = node.getAttribute('href') ?? ''
    let target = ''
    try { target = href.includes('#') ? decodeURIComponent(href.slice(href.indexOf('#') + 1)) : '' } catch { /* A malformed fragment names no declaration. */ }
    const kind = Object.hasOwn(kinds, target) ? kinds[target] : undefined
    const badge = kind ? mentionBadge(kind, kind) : undefined
    if (!code || !badge || node.classList.contains('api-mention') || node.closest('dt.sig')) continue
    node.classList.add('api-mention')
    marked++
    if (!node.closest('h1, h2, h3, h4, h5, h6') && !first(`${kind}:${node.href}`)) {
      const plain = plainMention(badge.kind, code.textContent ?? '', node.title || undefined)
      node.title = plain.title
      node.dataset.apiKind = plain.dataApiKind
      node.setAttribute('aria-label', plain.ariaLabel)
      continue
    }
    const name = document.createElement('span')
    name.className = 'api-symbol-link__name'
    name.append(code)
    node.replaceChildren(mentionBadgeNode(document, badge), name)
  }
  return marked
}
