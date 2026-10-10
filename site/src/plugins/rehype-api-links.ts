import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { visit } from 'unist-util-visit'
import { isLikelyReference, notApiReason, type ApiProduct } from '@libtmux/api-model'
import { createProseLinker, PORT_BY_LABEL } from '../lib/prose-resolver'
import { PORT_BY_SLUG } from '../lib/ports'

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
  return (tree: unknown, file?: { data?: { astro?: { frontmatter?: { port?: string; product?: ApiProduct } } } }) => {
    const buildPort = file?.data?.astro?.frontmatter?.port ?? (process.env.LIBTMUX_DOCS_PORT || undefined)
    // Native wrapper references own their symbols. Resolving the same short
    // name against another language's model would create a misleading link.
    if (buildPort && PORT_BY_SLUG[buildPort]?.referenceKind === 'guide') return
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
          scope.text += child.value ?? ''
          continue
        }
        if (child.tagName === 'a') {
          walk(child, true, rowPort, fence, scope)
          scope.text += textOf(child)
          continue
        }
        if (child.tagName === 'code' && !inLink) {
          const text = textOf(child).trim()
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
          } else if (decision.kind === 'unresolved' && !decision.file && pagePort && isLikelyReference(text) && !notApiReason(text)) {
            record({ port: pagePort, text, why: decision.why })
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
}

function textOf(node: unknown): string {
  let out = ''
  visit(node as never, 'text', (t: never) => {
    out += (t as { value: string }).value
  })
  return out
}
