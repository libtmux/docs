import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { visit } from 'unist-util-visit'
import { isLikelyReference, notApiReason, type ApiProduct } from '@libtmux/api-model'
import { createProseLinker, PORT_BY_LABEL } from '../lib/prose-resolver'
import { PORT_BY_SLUG } from '../lib/ports'
import { API_MODELS, pageSlug } from '../lib/api-models'
import { kindMark } from '../lib/api-labels'
import { docsPath, isTmuxProse } from '../lib/docs-paths'
import { MCP_REFERENCE, mcpObjects } from '../lib/mcp-reference'
import { tmuxCommandMentions } from '../lib/tmux-links'

/** Link inline API and source references using their prose ownership. */
const here = dirname(fileURLToPath(import.meta.url))

export interface DanglingReference {
  port: string
  text: string
  why: string
}

/**
 * Unresolved references, written to a file rather than shared in memory.
 *
 * docutils ends reference resolution with `ReportDanglingReferences` rather
 * than leaving a link silently unrendered, and it is right to: the failure
 * buckets are actionable — an extractor bug, a missing inventory, prose that
 * elides its receiver — and all of them are invisible if an unresolved
 * reference simply renders as plain text.
 *
 * Getting the *reporting* right took three attempts and the first two both
 * reported "no dangling API references" from a build that had plenty:
 *
 * 1. A module-level array. Astro loads markdown plugins and config
 *    integrations as separate module instances, so one wrote and the other
 *    read an empty array.
 * 2. `globalThis` with a symbol key. Better, but the markdown pipeline runs
 *    inside a Vite module runner with its *own* realm — a different
 *    `globalThis`, and a `console` whose output never reached the build log,
 *    which is how the second attempt looked like it worked once.
 *
 * A file crosses both. It is also the only version that cannot silently
 * report success from a pass that never ran: an absent file means "did not
 * run", which is a different answer from "ran and found nothing".
 */
const REPORT = join(here, '../../.astro/dangling-refs.json')

/**
 * Ensure this build's report exists, so an absent file has exactly one
 * meaning: the linking pass never ran.
 *
 * Without this the file appears only when something fails, and a clean run is
 * indistinguishable from a run that never happened — the very conflation the
 * file was introduced to remove. It is the third form of that bug: a
 * module-level array, then a `globalThis` key, then a file that existed only
 * on failure. Each reported "no dangling API references" from a build that
 * had not looked.
 *
 * `appendFileSync` of nothing creates without truncating, so it stays correct
 * if Astro ever renders in more than one realm — a truncating version would
 * have each realm erase the others' entries on its first transform. The
 * integration's `rmSync` at config setup is the single truncation point.
 */
function begin(): void {
  try {
    mkdirSync(dirname(REPORT), { recursive: true })
    appendFileSync(REPORT, '')
  } catch {
    /* reporting must never fail a render */
  }
}

/**
 * Append one unresolved reference, as a line of NDJSON.
 *
 * Appended rather than read-modify-written: Astro renders pages
 * concurrently, and the read-modify-write form drops whichever entry loses
 * the race — silently, which is exactly the failure this file exists to
 * prevent.
 */
function record(entry: DanglingReference): void {
  try {
    appendFileSync(REPORT, JSON.stringify(entry) + '\n')
  } catch {
    /* reporting must never fail a render */
  }
}

/** Blocks whose text is one context for the sentence rule. */
const BLOCKS = new Set(['p', 'li', 'td', 'th', 'dd', 'dt', 'figcaption', 'blockquote'])

type El = { type?: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: El[] }
const containsAnchor = (node: El): boolean => node.tagName === 'a' || Boolean(node.children?.some(containsAnchor))

function commandNodes(text: string, code = false): El[] {
  const linked: El[] = []
  let end = 0
  for (const mention of tmuxCommandMentions(text, { code })) {
    if (mention.start > end) linked.push({ type: 'text', value: text.slice(end, mention.start) })
    linked.push({ type: 'element', tagName: 'a', properties: { href: mention.href }, children: [{ type: 'text', value: mention.text }] })
    end = mention.end
  }
  if (end < text.length) linked.push({ type: 'text', value: text.slice(end) })
  return linked
}

const symbolsByPage = new Map(Object.entries(API_MODELS).flatMap(([port, model]) => model.symbols.map(symbol => [
  `${port}/${symbol.product && symbol.product !== 'core' ? `${symbol.product}/` : ''}${symbol.slug ?? pageSlug(symbol.publicId ?? symbol.id)}`,
  symbol,
] as const)))
const protocolByPage = new Map(Object.keys(MCP_REFERENCE).flatMap(port => mcpObjects(port).map(object => [
  `${port}/${object.path}`, object,
] as const)))

/** Only mark links whose actual destination names a known declaration. */
function addKindBadge(anchor: El, port?: string, route?: string): void {
  const href = anchor.properties?.href
  if (typeof href !== 'string' || href.startsWith('#') || !anchor.children?.length || anchor.children.some(child => child.properties?.dataApiKind)) return
  // Relative links require the real page route, including product nesting.
  if (route === undefined && !/^(?:\/|[a-z][a-z0-9+.-]*:)/i.test(href)) return
  let url: URL
  try { url = new URL(href, `https://libtmux.org/${port ?? '_'}/latest/${(route ?? '').replace(/\/$/, '')}/`) } catch { return }
  if (url.origin !== 'https://libtmux.org') return
  let fragment: string
  try { fragment = decodeURIComponent(url.hash.slice(1)) } catch { return }
  const match = /\/([^/]+)\/[^/]+\/(?:(mcp|workspace)\/)?reference\/([^/]+)\/?$/.exec(url.pathname)
  const protocol = /\/([^/]+)\/[^/]+\/(mcp\/(?:tools|prompts|resources)\/.+?)\/?$/.exec(url.pathname)
  let kind: string | undefined
  let title: string | undefined
  if (match && PORT_BY_SLUG[match[1]!]) {
    let slug: string
    try { slug = decodeURIComponent(match[3]!) } catch { return }
    const symbol = symbolsByPage.get(`${match[1]}/${match[2] ? `${match[2]}/` : ''}${slug}`)
    if (!symbol || (fragment && fragment !== (symbol.publicId ?? symbol.id))) return
    kind = symbol.kind
    title = symbol.command?.kind ?? kind
  } else if (protocol && PORT_BY_SLUG[protocol[1]!]) {
    let path: string
    try { path = decodeURIComponent(protocol[2]!) } catch { return }
    const object = protocolByPage.get(`${protocol[1]}/${path}`)
    if (!object || (fragment && fragment !== object.id)) return
    kind = object.kind
    title = `MCP ${kind}`
  }
  if (!kind) return
  const mark = kindMark(kind)
  if (!mark) return
  anchor.children.unshift({ type: 'element', tagName: 'span', properties: {
    className: ['api-link-kind', 'api-nav__kind', `api-badge--kind-${kind}`],
    dataApiKind: kind, ariaHidden: 'true', title,
  }, children: [{ type: 'element', tagName: 'span', properties: { className: ['api-badge__label'] }, children: [{ type: 'text', value: mark }] }] })
}

/**
 * Link every mention in the document, not only the ones inside a table.
 *
 * The previous version visited `<table>` and read the row's first cell for
 * the port, which linked 294 spans and left 1,257 alone — including every
 * mention in a paragraph, which is where most of them are. It now walks the
 * whole tree and asks `decideMention`, the same function
 * `scripts/check-api-links.mjs` asks, so the lint and the build cannot drift
 * apart about what should have been linked.
 *
 * Context, in the order the resolver prefers it: the port named in the
 * sentence, then the row label if this is a port-labelled table, then the
 * language of the fence above, then the port this build is for.
 */
export function rehypeApiLinks() {
  return (tree: unknown, file?: { path?: string; data?: { astro?: { frontmatter?: { port?: string; product?: ApiProduct; route?: string } } } }) => {
    const frontmatter = file?.data?.astro?.frontmatter
    const buildPort = frontmatter?.port ?? (process.env.LIBTMUX_DOCS_PORT || undefined)
    const source = file?.path?.replaceAll('\\', '/').match(/\/content\/(docs|_workspace-shared)\/(.+)\.mdx?$/)
    const id = source ? `${source[1] === '_workspace-shared' ? `ports/${buildPort}/` : ''}${source[2]}`.replace(/(?:^|\/)index$/, '') : undefined
    const route = frontmatter?.route ?? (id !== undefined ? docsPath({ id, data: { ...frontmatter, port: buildPort } }) : undefined)
    // Native tmux prose and wrapper references own their names; a library's
    // similarly named symbol is not evidence for a link from those pages.
    const nativeTmux = isTmuxProse({ id: id ?? '', data: { ...frontmatter, port: buildPort } })
    const resolveMentions = !nativeTmux && (!buildPort || PORT_BY_SLUG[buildPort]?.referenceKind !== 'guide')
    begin()
    const link = createProseLinker(file?.data?.astro?.frontmatter?.product)
    const sections: { depth: number; port?: string }[] = []

    const walk = (node: El, inLink: boolean, rowPort: string | undefined, fence: { lang?: string }, before: { text: string }) => {
      const kids = node.children
      if (!Array.isArray(kids)) return

      // A port-labelled row lends its language to the cells beside it.
      if (node.tagName === 'tr') {
        const cells = kids.filter((c) => c.tagName === 'td')
        const label = cells.length ? textOf(cells[0]!).trim() : ''
        rowPort = PORT_BY_LABEL[label] ?? rowPort
      }
      // A fence sets the language for the prose that follows it.
      if (node.tagName === 'pre') {
        const code = kids.find((c) => c.tagName === 'code')
        const cls = code?.properties?.className
        const list = Array.isArray(cls) ? cls : typeof cls === 'string' ? [cls] : []
        for (const c of list) {
          const m = /^language-(.+)$/.exec(String(c))
          if (m) fence.lang = LANG_TO_PORT[m[1]!.toLowerCase()]
        }
        return
      }
      if (/^h[1-6]$/.test(node.tagName ?? '')) {
        const depth = Number(node.tagName![1])
        while (sections.length && sections.at(-1)!.depth >= depth) sections.pop()
        sections.push({ depth, port: PORT_BY_LABEL[textOf(node).trim()] ?? sections.at(-1)?.port })
        fence.lang = undefined
      }

      const block = node.tagName && BLOCKS.has(node.tagName)
      const scope = block ? { text: '' } : before

      for (let i = 0; i < kids.length; i++) {
        const child = kids[i]!
        if (child.type === 'text') {
          const mentions = !inLink ? tmuxCommandMentions(child.value ?? '') : []
          if (mentions.length) {
            const linked = commandNodes(child.value ?? '')
            kids.splice(i, 1, ...linked)
            i += linked.length - 1
          }
          scope.text += child.value ?? ''
          continue
        }
        if (child.tagName === 'a') {
          const href = child.properties?.href
          if (typeof href === 'string' && href.startsWith('mcp:')) {
            const pagePort = buildPort ?? rowPort ?? fence.lang ?? sections.at(-1)?.port
            const decision = link(href, { pagePort, before: scope.text })
            if (decision.kind === 'link') child.properties!.href = decision.href
            else if (decision.kind === 'unresolved') record({ port: pagePort ?? 'shared', text: href, why: decision.why })
          }
          walk(child, true, rowPort, fence, scope)
          scope.text += textOf(child)
          addKindBadge(child, buildPort, route)
          continue
        }
        if (child.tagName === 'code' && !inLink) {
          const text = textOf(child).trim()
          if (containsAnchor(child)) { scope.text += text; continue }
          const commands = tmuxCommandMentions(text, { code: true })
          if (commands.length === 1) {
            kids[i] = { type: 'element', tagName: 'a', properties: { href: commands[0].href }, children: [child] }
            scope.text += text
            continue
          }
          if (commands.length > 1 && child.children?.every((node) => node.type === 'text')) {
            child.children = commandNodes(textOf(child), true)
            scope.text += text
            continue
          }
          if (!resolveMentions) continue
          const explicitPort = child.properties?.dataDocPort
          const pagePort = (typeof explicitPort === 'string' ? explicitPort : undefined)
            ?? buildPort ?? rowPort ?? fence.lang ?? sections.at(-1)?.port
          const decision = link(text, { pagePort, before: scope.text })
          if (decision.kind === 'link') {
            kids[i] = {
              type: 'element', tagName: 'a', children: [child],
              properties: {
                href: decision.href,
                class: decision.file ? 'api-mention api-mention--file' : 'api-mention',
                title: decision.title,
                ...(decision.external ? { rel: 'nofollow noopener' } : {}),
              },
            }
            addKindBadge(kids[i]!, buildPort, route)
          } else if (decision.kind === 'unresolved' && !decision.file &&
            (text.startsWith('mcp:') || (pagePort && isLikelyReference(text) && !notApiReason(text)))) {
            record({ port: pagePort ?? 'shared', text, why: decision.why })
          }
          scope.text += text
          continue
        }
        walk(child, inLink, rowPort, fence, scope)
        scope.text += textOf(child)
      }
    }

    walk(tree as El, false, undefined, {}, { text: '' })
  }
}

const LANG_TO_PORT: Record<string, string> = {
  python: 'py', py: 'py', typescript: 'ts', ts: 'ts', javascript: 'ts', js: 'ts',
  rust: 'rs', rs: 'rs', go: 'go', java: 'java', csharp: 'csharp', cs: 'csharp',
  cpp: 'cxx', 'c++': 'cxx', swift: 'swift',
  powershell: 'powershell', pwsh: 'powershell', ps1: 'powershell', julia: 'julia',
}

function textOf(node: unknown): string {
  let out = ''
  visit(node as never, 'text', (t: never) => {
    out += (t as { value: string }).value
  })
  return out
}
