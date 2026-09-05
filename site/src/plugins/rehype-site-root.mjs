import { visit } from 'unist-util-visit'

/**
 * Rewrite root-relative links against the deploy root.
 *
 * A page is built once per port and version, so the same Markdown renders at
 * /guides/x/ and at /cxx/stable/guides/x/. A relative link cannot express
 * "the site root" across both: ../../py/ resolves to /py/ from the first and
 * to /cxx/stable/py/ from the second, which is how 104 links broke the moment
 * per-language builds started.
 *
 * So content writes /py/ and this prefixes the deploy root — '/' normally,
 * '/pr-123/' for a preview where the whole site is nested. That is the one
 * thing the build knows and the Markdown cannot.
 */
export function rehypeSiteRoot() {
  const root = (process.env.LIBTMUX_DOCS_ROOT || '/').replace(/\/+$/, '')
  if (!root) return () => {}

  return (tree) => {
    visit(tree, 'element', (node) => {
      const attr = node.tagName === 'a' ? 'href' : node.tagName === 'img' ? 'src' : null
      if (!attr) return
      const value = node.properties?.[attr]
      // Only single-leading-slash paths: '//host' is protocol-relative.
      if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return
      node.properties[attr] = `${root}${value}`
    })
  }
}
