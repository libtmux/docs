/**
 * Pure text operations behind the shared-workspace-page mechanism.
 *
 * Dependency-free on purpose: `site/src/loaders/workspace-shared.ts` (the
 * Astro content loader) and `scripts/gen-mentions.mjs` (a plain-Node
 * filesystem scanner outside the site's own dependency resolution root, see
 * that script's comment) both import this module directly by relative path.
 * Neither `astro` nor any of its markdown helpers are reachable from
 * `scripts/`, so nothing here may depend on them.
 */

/**
 * Ports the generic, unreleased native `tmux-workspace` CLI documentation
 * covers. Ruby ships its own released `libtmux-workspace`, and Lua has no
 * workspace product at all — neither belongs to this shared narrative, so
 * callers filter their per-port synthesis against this set rather than
 * against every port `ports.ts` lists.
 */
export const KNOWN_PORTS = new Set(['py', 'ts', 'rs', 'go', 'java', 'dotnet', 'cxx', 'swift'])

const SLOT_TAG = /<!--\s*port:([a-z0-9,\s-]+?)\s*-->|<!--\s*\/port\s*-->/gi

export interface SlotNode {
  /** `null` for the implicit root, which every port keeps. */
  ports: Set<string> | null
  children: (string | SlotNode)[]
}

/** Parse `<!-- port:a,b -->...<!-- /port -->` into a tree; nesting is allowed. */
export function parseSlots(raw: string): SlotNode {
  const root: SlotNode = { ports: null, children: [] }
  const stack: SlotNode[] = [root]
  let last = 0
  for (const m of raw.matchAll(SLOT_TAG)) {
    const idx = m.index ?? 0
    const text = raw.slice(last, idx)
    if (text) stack[stack.length - 1]!.children.push(text)
    last = idx + m[0].length
    if (m[1] !== undefined) {
      const ports = new Set(
        m[1]
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean),
      )
      for (const port of ports) {
        if (!KNOWN_PORTS.has(port)) {
          throw new Error(`workspace-shared: unknown port "${port}" in <!-- port:${m[1]} -->`)
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

/** Render a slot tree for one port: drop every node whose ports exclude it. */
export function resolveSlots(node: SlotNode, port: string): string {
  if (node.ports && !node.ports.has(port)) return ''
  return node.children.map((child) => (typeof child === 'string' ? child : resolveSlots(child, port))).join('')
}

/** Resolve a shared page's raw body to the text one port renders. */
export function resolvePortBody(raw: string, port: string): string {
  return resolveSlots(parseSlots(raw), port)
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
