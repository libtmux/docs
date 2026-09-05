import { gunzipSync, inflateSync, deflateSync } from 'node:zlib'
import type { ApiModel, ApiSymbol, PortSlug, SymbolKind } from './model.ts'

/**
 * Sphinx `objects.inv` v2, read and written.
 *
 * The format is four plaintext header lines followed by a zlib stream of
 * records — read out of `sphinx/util/inventory.py` rather than recalled:
 *
 *   {fullname} {domain}:{role} {priority} {uri} {dispname}
 *
 * Two space optimisations that the reader reverses and a writer must apply,
 * or Sphinx's own reader produces wrong URLs rather than an error:
 *
 * - an anchor equal to the object's own name collapses to `$`
 * - a `dispname` equal to `fullname` collapses to `-`
 *
 * Publishing this is what makes libtmux.org linkable from any Sphinx project,
 * including our own: the Python docs are Sphinx, so with libtmux.org in their
 * `intersphinx_mapping` a docstring can write ``:class:`libtmux-rs:Pane` `` and
 * get a working link. That is cross-language linking through the mechanism
 * Sphinx already ships, rather than one invented here.
 */

/**
 * Model kind to Sphinx domain role.
 *
 * Sphinx has real domains for Python, C++ and JavaScript, and those are used
 * so an external consumer's `:py:class:` resolves the way it expects. The
 * other five languages have no domain, and inventing `rs:struct` would produce
 * a role no reader has ever heard of — those go to `std:label`, which every
 * Sphinx understands and which `:ref:` resolves.
 */
const DOMAIN: Record<PortSlug, string> = {
  py: 'py',
  cxx: 'cpp',
  ts: 'js',
  rs: 'std',
  go: 'std',
  java: 'std',
  dotnet: 'std',
  swift: 'std',
}

const PY_ROLE: Partial<Record<SymbolKind, string>> = {
  module: 'module',
  class: 'class',
  exception: 'exception',
  function: 'function',
  method: 'method',
  property: 'attribute',
  attribute: 'attribute',
  constant: 'data',
  typealias: 'data',
  interface: 'class',
  struct: 'class',
  enum: 'class',
  trait: 'class',
}

const CPP_ROLE: Partial<Record<SymbolKind, string>> = {
  class: 'class',
  struct: 'struct',
  interface: 'class',
  enum: 'enum',
  function: 'function',
  method: 'function',
  attribute: 'member',
  property: 'member',
  constant: 'var',
  typealias: 'type',
  module: 'namespace',
}

const JS_ROLE: Partial<Record<SymbolKind, string>> = {
  class: 'class',
  interface: 'class',
  function: 'function',
  method: 'method',
  property: 'attribute',
  attribute: 'attribute',
  constant: 'data',
  module: 'module',
  enum: 'class',
  struct: 'class',
  typealias: 'data',
}

function roleFor(port: PortSlug, kind: SymbolKind): string {
  const domain = DOMAIN[port]
  const table = domain === 'py' ? PY_ROLE : domain === 'cpp' ? CPP_ROLE : domain === 'js' ? JS_ROLE : undefined
  // `std:label` is the honest home for a language Sphinx has no domain for.
  return `${domain}:${table?.[kind] ?? 'label'}`
}

export interface InventoryEntry {
  name: string
  /** `py:class`, `std:label`, … */
  type: string
  priority: number
  /** Relative to the inventory's own base URL. */
  uri: string
  dispname: string
}

export interface InventoryOptions {
  project: string
  version: string
  /** Where a symbol's page lives, relative to the inventory's base URL. */
  uriFor: (symbol: ApiSymbol) => string
}

/** Serialise a model as `objects.inv` bytes. */
export function writeInventory(model: ApiModel, options: InventoryOptions): Buffer {
  const header =
    '# Sphinx inventory version 2\n' +
    `# Project: ${escape(options.project)}\n` +
    `# Version: ${escape(options.version)}\n` +
    '# The remainder of this file is compressed using zlib.\n'

  const lines: string[] = []
  // Sorted, so the file is byte-stable across runs and a diff means a real
  // change rather than a map iteration order.
  const sorted = [...model.symbols].sort((a, b) =>
    (a.publicId ?? a.id).localeCompare(b.publicId ?? b.id),
  )
  for (const symbol of sorted) {
    const name = symbol.publicId ?? symbol.id
    // Records are whitespace-delimited, so a name containing whitespace is
    // not representable — Sphinx's reader mis-splits it and the entry is
    // silently lost. Two Java symbols disappeared exactly this way, because
    // the extractor had put a field's initialiser into its name. Refusing
    // loudly is the only way that stays found: an inventory two entries short
    // looks identical to a correct one.
    if (/\s/.test(name)) {
      throw new Error(
        `objects.inv: symbol name contains whitespace and cannot be serialised: ${JSON.stringify(name)}. ` +
          'This is an extractor bug — a name should never contain a space.',
      )
    }
    let uri = options.uriFor(symbol)
    // `#name` at the end collapses to `#$`; Sphinx's own comment puts the
    // saving at up to 25% of the file.
    if (uri.endsWith(`#${name}`)) uri = `${uri.slice(0, -name.length)}$`
    lines.push(`${name} ${roleFor(model.port, symbol.kind)} 1 ${uri} -\n`)
  }

  return Buffer.concat([Buffer.from(header, 'utf8'), deflateSync(Buffer.from(lines.join(''), 'utf8'), { level: 9 })])
}

const escape = (s: string): string => s.replace(/\s+/g, ' ')

/**
 * Parse `objects.inv` bytes.
 *
 * Accepts both zlib and gzip bodies: some mirrors serve the file
 * content-encoded and a naive fetch hands you the gzip wrapper.
 */
export function readInventory(buffer: Buffer): {
  project: string
  version: string
  entries: InventoryEntry[]
} {
  const text = buffer.toString('latin1')
  const headerEnd = nthIndexOf(text, '\n', 4)
  if (!text.startsWith('# Sphinx inventory version 2')) {
    throw new Error('objects.inv: not a version 2 inventory')
  }
  const header = text.slice(0, headerEnd).split('\n')
  const project = header[1]?.replace(/^# Project:\s*/, '') ?? ''
  const version = header[2]?.replace(/^# Version:\s*/, '') ?? ''

  const body = buffer.subarray(headerEnd + 1)
  const raw = body[0] === 0x1f && body[1] === 0x8b ? gunzipSync(body) : inflateSync(body)

  const entries: InventoryEntry[] = []
  // Sphinx's own pattern. Names may contain spaces; the uri may not.
  const record = /^(.+?)\s+(\S+)\s+(-?\d+)\s+?(\S*)\s+(.*)$/
  for (const line of raw.toString('utf8').split('\n')) {
    const m = record.exec(line.trimEnd())
    if (!m) continue
    const [, name, type, priority, uri, dispname] = m
    if (!type.includes(':')) continue
    entries.push({
      name,
      type,
      priority: Number(priority),
      // `#$` expands back to the object's own name.
      uri: uri.endsWith('$') ? uri.slice(0, -1) + name : uri,
      dispname: dispname === '-' ? name : dispname,
    })
  }
  return { project, version, entries }
}

function nthIndexOf(text: string, needle: string, n: number): number {
  let index = -1
  for (let i = 0; i < n; i++) {
    index = text.indexOf(needle, index + 1)
    if (index === -1) return text.length
  }
  return index
}
