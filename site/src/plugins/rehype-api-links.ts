import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { visit } from 'unist-util-visit'
import { isLikelyReference, notApiReason, type ApiProduct } from '@libtmux/api-model'
import { createProseLinker, PORT_BY_LABEL, protocolRunMentions } from '../lib/prose-resolver'
import { PORT_BY_SLUG } from '../lib/ports'
import { API_MODELS, pageSlug } from '../lib/api-models'
import { kindMark, markClass } from '../lib/api-labels'
import { docsPath, isTmuxProse } from '../lib/docs-paths'
import { MCP_REFERENCE, mcpObjects } from '../lib/mcp-catalog'
import { mergeMentions, tmuxMentions, type Mention } from '../lib/tmux-links'
import { isLibraryPage, workspaceNames } from '../lib/workspace-links'

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

/** tmux kinds read as words in the badge's tooltip; the glyph stays in `kindMark`. */
const TMUX_KIND_TITLES: Record<string, string> = {
  command: 'tmux command', option: 'tmux option', hook: 'tmux hook', format: 'tmux format variable',
}

/** The same kind badge that API mentions carry, so both inherit one treatment. */
function withKindBadge(anchor: El, kind: string, mark: string, title?: string): El {
  anchor.children = [{ type: 'element', tagName: 'span', properties: {
    className: ['api-symbol-link__name'],
  }, children: anchor.children }]
  anchor.children.unshift({ type: 'element', tagName: 'span', properties: {
    className: ['api-link-kind', 'api-nav__kind', `api-badge--kind-${kind}`],
    dataApiKind: kind, ariaHidden: 'true', title,
  }, children: [{ type: 'element', tagName: 'span', properties: { className: ['api-badge__label'], dataMark: markClass(mark) }, children: [{ type: 'text', value: mark }] }] })
  return anchor
}

/** The kind as a word, for a tooltip and an accessible name. */
const kindWord = (kind: string) => TMUX_KIND_TITLES[kind] ?? kind.replace(/-/g, ' ')

/**
 * A later mention in a section: the link alone. The kind stays in the tooltip and
 * the accessible name, so the reader who needs it can hover or listen for it.
 */
function plainKind(anchor: El, kind: string, title?: string): El {
  const word = kindWord(kind)
  anchor.properties = { ...anchor.properties, title: title ?? word, dataApiKind: kind, ariaLabel: `${word}: ${textOf(anchor).trim()}` }
  return anchor
}

/** Mark the first mention of a name in a section; every later one stays a plain code link. */
type First = (key: string) => boolean

function mentionAnchor(mention: Mention, children: El[], badge = true, first: First = () => true): El {
  const anchor: El = { type: 'element', tagName: 'a', properties: { href: mention.href }, children }
  if (!badge) return anchor
  anchor.properties!.className = [`${mention.family ?? 'tmux'}-mention`]
  const title = mention.title ?? TMUX_KIND_TITLES[mention.kind]
  if (!first(`${mention.kind}:${mention.href}`)) return plainKind(anchor, mention.kind, title)
  return withKindBadge(anchor, mention.kind, kindMark(mention.kind)!, title)
}

/** Names in prose carry a badge; inside one code run they keep the run's own flow. */
function mentionNodes(text: string, mentions: Mention[], code = false, first: First = () => true): El[] {
  const linked: El[] = []
  let end = 0
  for (const mention of mentions) {
    if (mention.start > end) linked.push({ type: 'text', value: text.slice(end, mention.start) })
    linked.push(mentionAnchor(mention, [{ type: 'text', value: mention.text }], !code, first))
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
function addKindBadge(anchor: El, port?: string, route?: string, first: First = () => true): void {
  const href = anchor.properties?.href
  if (typeof href !== 'string' || href.startsWith('#') || !anchor.children?.length || anchor.properties?.dataApiKind || anchor.children.some(child => child.properties?.dataApiKind)) return
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
  if (!first(`${kind}:${url.pathname}${fragment ? `#${fragment}` : ''}`)) plainKind(anchor, kind, title)
  else withKindBadge(anchor, kind, mark, title)
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
  return (tree: unknown, file?: { path?: string; data?: { astro?: { frontmatter?: { port?: string; product?: ApiProduct; route?: string; symbols?: boolean; sidebar?: { group?: string } } } } }) => {
    const frontmatter = file?.data?.astro?.frontmatter
    const buildPort = frontmatter?.port ?? (process.env.LIBTMUX_DOCS_PORT || undefined)
    const source = file?.path?.replaceAll('\\', '/').match(/\/content\/(docs|_workspace-shared)\/(.+)\.mdx?$/)
    const id = source ? `${source[1] === '_workspace-shared' ? `ports/${buildPort}/` : ''}${source[2]}`.replace(/(?:^|\/)index$/, '') : undefined
    const route = frontmatter?.route ?? (id !== undefined ? docsPath({ id, data: { ...frontmatter, port: buildPort } }) : undefined)
    // Native tmux prose and wrapper references own their names; a library's
    // similarly named symbol is not evidence for a link from those pages.
    const nativeTmux = isTmuxProse({ id: id ?? '', data: { ...frontmatter, port: buildPort } })
    // `symbols: false` is for generated text whose names are arguments, not library symbols.
    const resolveMentions = !nativeTmux && frontmatter?.symbols !== false && (!buildPort || PORT_BY_SLUG[buildPort]?.referenceKind !== 'guide')
    begin()
    const product = file?.data?.astro?.frontmatter?.product
    const link = createProseLinker(product)
    const sections: { depth: number; port?: string }[] = []
    // A bare `load` or `start_directory` is a workspace name on a user-facing workspace page.
    // Library pages talk about the function and the field, so only `<program> <command>` is evidence there.
    const bareWorkspaceNames = product === 'workspace' && !isLibraryPage(route, frontmatter?.sidebar?.group)
    // The first cell of a table row defines the entry it names, and a heading names its own section.
    const definitionCells = new WeakSet<El>()
    let definitions = 0
    let headings = 0
    // The first mention of a name in each section carries the mark; the rest are plain code links.
    // A heading starts a new section and its own names are always marked.
    const seen = new Set<string>()
    const first: First = (key) => {
      if (headings) return true
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }

    const walk = (node: El, inLink: boolean, rowPort: string | undefined, fence: { lang?: string }, before: { text: string }) => {
      const kids = node.children
      if (!Array.isArray(kids)) return

      // A port-labelled row lends its language to the cells beside it.
      if (node.tagName === 'tr') {
        const cells = kids.filter((c) => c.tagName === 'td')
        const label = cells.length ? textOf(cells[0]!).trim() : ''
        rowPort = PORT_BY_LABEL[label] ?? rowPort
        if (cells[0]) definitionCells.add(cells[0])
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
        seen.clear()
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
          const mentions = inLink ? [] : tmuxMentions(child.value ?? '')
          if (mentions.length) {
            const linked = mentionNodes(child.value ?? '', mentions, false, first)
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
          addKindBadge(child, buildPort, route, first)
          continue
        }
        if (child.tagName === 'code' && !inLink) {
          const raw = textOf(child)
          const text = raw.trim()
          if (containsAnchor(child)) { scope.text += text; continue }
          const explicitPort = child.properties?.dataDocPort
          const pagePort = (typeof explicitPort === 'string' ? explicitPort : undefined)
            ?? buildPort ?? rowPort ?? fence.lang ?? sections.at(-1)?.port
          // The page's own product and port name things the language API and tmux also name.
          const names = pagePort
            ? workspaceNames(text, { port: pagePort, route, bare: bareWorkspaceNames, definition: definitions > 0 })
            : { mentions: [], defined: false }
          // A heading names its own section, so it links nothing; neither does the place that defines a name.
          const own = headings ? [] : names.mentions
          if (!own.length && (names.defined || names.mentions.length)) { scope.text += text; continue }
          const next = kids[i + 1]
          const tmux = tmuxMentions(text, { code: true, before: scope.text, after: next?.type === 'text' ? next.value : '' })
          const mentions = mergeMentions(own, mergeMentions(tmux, product === 'mcp' && pagePort ? protocolRunMentions(link, text, pagePort) : []))
          // One name takes the whole span; several split it and keep its code font.
          const linkMentions = () => {
            const lead = raw.length - raw.trimStart().length
            if (mentions.length === 1 && !mentions[0].inline) kids[i] = mentionAnchor(mentions[0], [child], true, first)
            else if (mentions.length && child.children?.every((node) => node.type === 'text')) {
              child.children = mentionNodes(raw, mentions.map((mention) => ({ ...mention, start: mention.start + lead, end: mention.end + lead })), true)
            } else return false
            return true
          }
          // A command or a workspace name claims its span; a library symbol outranks an option, hook or format variable.
          if ((own.length || tmux.some((mention) => mention.kind === 'command')) && linkMentions()) {
            scope.text += text
            continue
          }
          if (!resolveMentions) {
            linkMentions()
            continue
          }
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
            addKindBadge(kids[i]!, buildPort, route, first)
          } else {
            if (decision.kind === 'unresolved' && !decision.file &&
              (text.startsWith('mcp:') || (pagePort && isLikelyReference(text) && !notApiReason(text)))) {
              record({ port: pagePort ?? 'shared', text, why: decision.why })
            }
            linkMentions()
          }
          scope.text += text
          continue
        }
        const heading = /^h[1-6]$/.test(child.tagName ?? '')
        const definition = definitionCells.has(child)
        if (heading) headings++
        if (definition) definitions++
        walk(child, inLink, rowPort, fence, scope)
        if (heading) headings--
        if (definition) definitions--
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
