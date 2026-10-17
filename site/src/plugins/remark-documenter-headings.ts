import { fromMarkdown } from 'mdast-util-from-markdown'
import { visit } from 'unist-util-visit'
import { resolvePortContent } from '../lib/workspace-shared-slots.ts'

/** One native heading rule shared by HTML navigation and Markdown exports. */
export function documenterHeading(source: string) {
  const named = /^#{1,6}\s+\[(.+)\]\(@id ([A-Za-z0-9][A-Za-z0-9_.:-]*)\)\s*$/.exec(source)
  if (!named) return
  const label = fromMarkdown(named[1]!).children
  if (label.length !== 1 || label[0]?.type !== 'paragraph') return
  return { label: named[1]!, id: named[2]!, children: label[0].children }
}

/** Retain native Documenter heading IDs before Astro collects headings and row links. */
export function remarkDocumenterHeadings() {
  return (tree: ReturnType<typeof fromMarkdown>, file: {
    value?: unknown
    data?: { astro?: { frontmatter?: { port?: string } } }
  }) => {
    const port = file.data?.astro?.frontmatter?.port ?? process.env.LIBTMUX_DOCS_PORT
    if (port !== 'julia') return
    // remarkPortCode reparses selected content, so positions refer to that body.
    const { body: source } = resolvePortContent(String(file.value ?? ''), port)
    visit(tree, 'heading', (node) => {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start === undefined || end === undefined) return
      const named = documenterHeading(source.slice(start, end))
      if (!named) return
      node.children = named.children
      const properties = node.data && 'hProperties' in node.data ? node.data.hProperties : undefined
      node.data = { ...node.data, hProperties: {
        ...(properties && typeof properties === 'object' ? properties : {}), id: named.id,
      } }
    })
  }
}
