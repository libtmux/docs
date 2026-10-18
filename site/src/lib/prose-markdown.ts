import { fromMarkdown } from 'mdast-util-from-markdown'
import { SKIP, visit } from 'unist-util-visit'
import { proseMentions, type ApiProduct } from '@libtmux/api-model'
import { resolvePortContent } from './workspace-shared-slots'
import { createProseLinker, PORT_BY_LABEL, protocolRunMentions } from './prose-resolver'
import { PORT_BY_SLUG } from './ports'
import { rewriteMarkdownLinks } from '../plugins/remark-port-code.mjs'
import { mentionMarkdown, mergeMentions, tmuxMentions } from './tmux-links'
import { isLibraryPage, workspaceNames } from './workspace-links'
import { docsPath, isTmuxProse, type DocsPage } from './docs-paths'
import { documenterHeading } from '../plugins/remark-documenter-headings'

interface MarkdownLinkProjection {
  /** The same source identity and route that determine HTML ownership. */
  page?: DocsPage
  /** Resolved API URLs already include their deployment prefix. */
  resolved?: (href: string) => string
  /** Authored links need the ownership region and the selected build version. */
  authored?: (href: string, owner?: string) => string
}

/** Add resolved links without reserializing prose or executable examples. */
export function linkProseMarkdown(raw: string, port?: string, product?: ApiProduct, project: MarkdownLinkProjection = {}): string {
  const { body, portAt } = resolvePortContent(raw, port)
  const linkApi = (!project.page || !isTmuxProse(project.page, port))
    && (!port || PORT_BY_SLUG[port]?.referenceKind !== 'guide')
  const spans = new Set<number>()
  const edits: { start: number; end: number; text: string }[] = []
  const unclaimed: typeof edits = []
  const link = createProseLinker(product)
  const route = project.page ? docsPath(project.page) : undefined
  // The same rule as the rendered page: a bare workspace name is evidence only on a user-facing workspace page.
  const bareWorkspaceNames = product === 'workspace' && !isLibraryPage(route, project.page?.data.sidebar?.group)
  // The first cell of a table row defines the entry it names.
  const inFirstCell = (offset: number) => /^\s*\|[^|]*$/.test(body.slice(body.lastIndexOf('\n', offset - 1) + 1, offset))
  let htmlDepth = 0
  visit(fromMarkdown(body), (node, _index, parent) => {
    if (node.type === 'heading' && node.position?.start.offset !== undefined && node.position.end.offset !== undefined) {
      const start = node.position.start.offset, end = node.position.end.offset
      const owner = portAt(start) ?? port
      if (owner === 'julia') {
        const named = documenterHeading(body.slice(start, end))
        if (named) {
          const label = linkProseMarkdown(named.label, owner, product, project)
          edits.push({ start, end, text: `<a id="${named.id}"></a>\n\n${'#'.repeat(node.depth)} ${label}` })
          return SKIP
        }
      }
    }

    if ((node.type === 'link' || node.type === 'definition') && (project.authored || node.url.startsWith('mcp:'))) {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start !== undefined && end !== undefined) {
        const owner = portAt(start) ?? port
        edits.push({ start, end, text: rewriteMarkdownLinks(body.slice(start, end), (href: string) => {
          if (href.startsWith('mcp:')) {
            const paragraph = body.lastIndexOf('\n\n', start)
            const before = body.slice(paragraph < 0 ? 0 : paragraph + 2, start)
            const decision = link(href, { pagePort: owner, before })
            if (decision.kind === 'link') return project.resolved?.(decision.href) ?? decision.href
            return href
          }
          return project.authored?.(href, owner) ?? href
        }) })
      }
    }
    if (['link', 'linkReference', 'image', 'imageReference', 'code', 'definition'].includes(node.type)) return SKIP
    if (node.type === 'html') {
      for (const tag of node.value.matchAll(/<(\/?)(?:a|code|pre)\b[^>]*>/gi)) {
        htmlDepth = Math.max(0, htmlDepth + (tag[1] ? -1 : 1))
      }
    }
    if ((node.type === 'inlineCode' || node.type === 'text') && !htmlDepth && node.position?.start.offset !== undefined) {
      const start = node.position.start.offset
      const end = node.position.end.offset!
      const code = node.type === 'inlineCode'
      const owner = portAt(start) ?? port
      // The page's own product and port name things the language API and tmux also name.
      const names = code && owner
        ? workspaceNames(node.value, { port: owner, route, bare: bareWorkspaceNames, definition: inFirstCell(start) })
        : { mentions: [], defined: false }
      // A heading names its own section, so it links nothing; neither does the place that defines a name.
      const own = parent?.type === 'heading' ? [] : names.mentions
      if (!own.length && (names.defined || names.mentions.length)) return SKIP
      const tmux = tmuxMentions(node.value, { code, before: body.slice(Math.max(0, start - 48), start), after: body.slice(end, end + 48) })
      const native = mentionMarkdown(node.value, code, mergeMentions(own, mergeMentions(tmux,
        code && owner && product === 'mcp' ? protocolRunMentions(link, node.value, owner) : [])), project.resolved)
      if (native && (code || body.slice(start, end) === node.value)) {
        // A command or a workspace name claims its span; a library symbol outranks an option, hook or format variable.
        if (linkApi && code && !own.length && !tmux.some((mention) => mention.kind === 'command')) {
          unclaimed.push({ start, end, text: native })
          spans.add(start)
        } else edits.push({ start, end, text: native })
        return SKIP
      }
    }
    if (linkApi && node.type === 'inlineCode' && !htmlDepth && node.position?.start.offset !== undefined) {
      spans.add(node.position.start.offset)
    }
  })
  for (const mention of proseMentions(body, PORT_BY_LABEL, portAt)) {
    if (!spans.has(mention.start)) continue
    const decision = link(mention.text, { pagePort: portAt(mention.start) ?? port ?? mention.port, before: mention.before })
    if (decision.kind !== 'link') continue
    // Angle destinations preserve balanced punctuation in API slugs.
    const href = (project.resolved?.(decision.href) ?? decision.href).replaceAll('<', '%3C').replaceAll('>', '%3E')
    edits.push({ start: mention.start, end: mention.end, text: `[${body.slice(mention.start, mention.end)}](<${href}>)` })
  }
  for (const edit of unclaimed) if (!edits.some((claimed) => claimed.start === edit.start)) edits.push(edit)
  let out = body
  for (const edit of edits.sort((a, b) => b.start - a.start)) out = `${out.slice(0, edit.start)}${edit.text}${out.slice(edit.end)}`
  return out
}
