/** Content ownership shared by rendering, Markdown exports and source scanners. */
import { PORTS } from './ports.ts'

/**
 * Ports the generic, unreleased native `tmux-workspace` CLI documentation
 * covers. Ruby ships its own released `libtmux-workspace`, and Lua has no
 * workspace product at all — neither belongs to this shared narrative, so
 * callers filter their per-port synthesis against this set rather than
 * against every port `ports.ts` lists.
 */
export const KNOWN_PORTS = new Set(['py', 'ts', 'rs', 'go', 'java', 'dotnet', 'cxx', 'swift'])

const CONTENT_PORTS = new Set([...PORTS.map((port) => port.slug), 'root'])
const SLOT_TAG = /<!--\s*port:([\s\S]*?)-->|<!--\s*\/port\s*-->/gi

/** Markdown examples can show ownership syntax literally; other fences may contain slots. */
function fencedRanges(raw: string): [number, number][] {
  const ranges: [number, number][] = []
  let fence: { marker: string; length: number; start: number; literal: boolean } | undefined
  let offset = 0
  for (const line of raw.split(/(?<=\n)/)) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)/.exec(line.replace(SLOT_TAG, ''))
    if (match) {
      const [, marker, rest] = match
      if (!fence && !(marker[0] === '`' && rest.includes('`'))) {
        fence = { marker: marker[0], length: marker.length, start: offset, literal: /^(?:markdown|md)\b/.test(rest.trim()) }
      } else if (fence && marker[0] === fence.marker && marker.length >= fence.length && !rest.trim()) {
        if (fence.literal) ranges.push([fence.start, offset + line.length])
        fence = undefined
      }
    }
    offset += line.length
  }
  if (fence?.literal) ranges.push([fence.start, raw.length])
  return ranges
}

export interface SlotNode {
  /** `null` for the implicit root, which every port keeps. */
  ports: Set<string> | null
  children: (string | SlotNode)[]
}

/** Parse `<!-- port:a,b -->...<!-- /port -->` into a tree; nesting is allowed. */
export function parseSlots(raw: string): SlotNode {
  const root: SlotNode = { ports: null, children: [] }
  const stack: SlotNode[] = [root]
  const fences = fencedRanges(raw)
  let last = 0
  for (const m of raw.matchAll(SLOT_TAG)) {
    let idx = m.index ?? 0
    if (fences.some(([start, end]) => idx >= start && idx < end)) continue
    let end = idx + m[0].length
    const lineStart = raw.lastIndexOf('\n', idx - 1) + 1
    const newline = raw.indexOf('\n', end)
    const lineEnd = newline < 0 ? raw.length : newline
    // A directive on its own line contributes no Markdown blank line. This
    // keeps scoped table rows contiguous in both root and port documents.
    if (!raw.slice(lineStart, idx).trim() && !raw.slice(end, lineEnd).trim()) {
      idx = lineStart
      end = newline < 0 ? raw.length : newline + 1
    }
    const text = raw.slice(last, idx)
    if (text) stack[stack.length - 1]!.children.push(text)
    last = end
    if (m[1] !== undefined) {
      const ports = new Set(
        m[1]
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean),
      )
      if (!ports.size) throw new Error('port-content: empty port list')
      for (const port of ports) {
        if (!CONTENT_PORTS.has(port)) {
          throw new Error(`port-content: unknown port "${port}" in <!-- port:${m[1]} -->`)
        }
      }
      const node: SlotNode = { ports, children: [] }
      stack[stack.length - 1]!.children.push(node)
      stack.push(node)
    } else {
      if (stack.length === 1) throw new Error('workspace-shared: <!-- /port --> with no open <!-- port:... --> block')
      stack.pop()
    }
  }
  const tail = raw.slice(last)
  if (tail) stack[stack.length - 1]!.children.push(tail)
  if (stack.length !== 1) throw new Error('workspace-shared: unclosed <!-- port:... --> block')
  return root
}

/** Root pages keep all languages; a port keeps only its own regions. */
export function resolveSlots(node: SlotNode, port?: string): string {
  if (port && node.ports && !node.ports.has(port)) return ''
  return node.children.map((child) => (typeof child === 'string' ? child : resolveSlots(child, port))).join('')
}

/** Resolve ownership and retain the context needed to link root-page API names. */
export function resolvePortContent(raw: string, port?: string): { body: string; portAt: (offset: number) => string | undefined } {
  const parts: string[] = []
  const regions: { start: number; end: number; port: string }[] = []
  let offset = 0
  const append = (node: SlotNode, inherited?: string) => {
    if (port && node.ports && !node.ports.has(port)) return
    const owners = node.ports && [...node.ports].filter((owner) => owner !== 'root')
    const owner = owners?.length ? (owners.length === 1 ? owners[0] : undefined) : inherited
    for (const child of node.children) {
      if (typeof child !== 'string') { append(child, owner); continue }
      parts.push(child)
      if (owner) regions.push({ start: offset, end: offset + child.length, port: owner })
      offset += child.length
    }
  }
  append(parseSlots(raw))
  return {
    body: parts.join(''),
    portAt: (position) => regions.find(({ start, end }) => position >= start && position < end)?.port,
  }
}

/** Resolve a shared page's raw body to the text one port renders. */
export function resolvePortBody(raw: string, port?: string): string {
  return resolvePortContent(raw, port).body
}

export interface SharedFrontmatter {
  ports?: Record<string, Record<string, unknown>>
  [key: string]: unknown
}

/** Merge a shared page's defaults with one port's overrides. */
export function resolvePortData(frontmatter: SharedFrontmatter, port: string, product: string): Record<string, unknown> {
  const { ports: overrides, ...defaults } = frontmatter
  return { ...defaults, ...overrides?.[port], port, product }
}
