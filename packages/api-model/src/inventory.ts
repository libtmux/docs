import { gunzipSync, inflateSync, deflateSync } from 'node:zlib'
import type { ApiModelBase, ApiSymbol, PortSlug, SymbolKind } from './model.ts'
import { qualifiedNameOf } from './modules.ts'

/** Sphinx v2 uses object types in records; roles resolve those types. */
const DOMAIN: Record<PortSlug, string> = {
  py: 'py',
  ruby: 'std',
  lua: 'std',
  powershell: 'std',
  julia: 'std',
  elixir: 'std',
  cxx: 'cpp',
  ts: 'js',
  rs: 'std',
  go: 'std',
  java: 'std',
  kotlin: 'std',
  scala: 'std',
  fsharp: 'std',
  csharp: 'std',
  swift: 'std',
}

const PY_TYPE: Partial<Record<SymbolKind, string>> = {
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

const CPP_TYPE: Partial<Record<SymbolKind, string>> = {
  class: 'class',
  struct: 'class',
  union: 'union',
  interface: 'class',
  enum: 'enum',
  function: 'function',
  method: 'function',
  attribute: 'member',
  property: 'member',
  constant: 'member',
  typealias: 'type',
}

const JS_TYPE: Partial<Record<SymbolKind, string>> = {
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

const C_TYPE: Partial<Record<SymbolKind, string>> = {
  struct: 'struct', union: 'union', enum: 'enum', function: 'function',
  typealias: 'type', attribute: 'var', constant: 'var',
}

function objectTypeFor(language: string, kind: SymbolKind): string {
  const domain = language === 'c' ? 'c' : DOMAIN[language as PortSlug] ?? 'std'
  const table = domain === 'py' ? PY_TYPE : domain === 'cpp' ? CPP_TYPE : domain === 'js' ? JS_TYPE : domain === 'c' ? C_TYPE : undefined
  // `std:label` is the honest home for a language Sphinx has no domain for.
  const type = table?.[kind]
  return type ? `${domain}:${type}` : 'std:label'
}

/** Built-in Sphinx object type, which can differ from the role's spelling. */
export function inventoryType(symbol: ApiSymbol, language: string, parentKind?: SymbolKind): string {
  if (language === 'c') {
    if (symbol.modifiers.includes('macro')) return 'c:macro'
    if (symbol.kind === 'constant' && parentKind === 'enum') return 'c:enumerator'
    if (symbol.parent && ['attribute', 'property'].includes(symbol.kind)) return 'c:member'
  }
  if (language === 'cxx' && symbol.kind === 'constant' && parentKind === 'enum') return 'cpp:enumerator'
  return objectTypeFor(language, symbol.kind)
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

const BUILTIN_TYPES = new Set([
  ...['label', 'doc', 'term', 'token', 'envvar', 'cmdoption', 'confval'].map((type) => `std:${type}`),
  ...['module', 'class', 'exception', 'function', 'method', 'attribute', 'data'].map((type) => `py:${type}`),
  ...['class', 'union', 'enum', 'enumerator', 'function', 'member', 'type', 'concept'].map((type) => `cpp:${type}`),
  ...['module', 'class', 'function', 'method', 'attribute', 'data'].map((type) => `js:${type}`),
  ...['struct', 'union', 'enum', 'enumerator', 'function', 'member', 'var', 'type', 'macro'].map((type) => `c:${type}`),
])

/** Serialize records understood by an unextended Sphinx installation. */
export function writeInventoryEntries(entries: readonly InventoryEntry[], options: Pick<InventoryOptions, 'project' | 'version'> & { legacyCaseSensitiveLabels?: boolean }): Buffer {
  const header = '# Sphinx inventory version 2\n' +
    `# Project: ${escape(options.project)}\n# Version: ${escape(options.version)}\n` +
    '# The remainder of this file is compressed using zlib.\n'
  const seen = new Set<string>()
  const lines = [...entries].sort((a, b) => compare(`${a.type}\0${a.name}`, `${b.type}\0${b.name}`)).map((entry) => {
    const { name, type, priority, dispname } = entry
    if (!name || /[\r\n\t]/.test(name) || /[\r\n]/.test(dispname)) throw new Error(`objects.inv: invalid record text: ${name}`)
    if (!BUILTIN_TYPES.has(type)) throw new Error(`objects.inv: unsupported object type: ${type}`)
    if (!Number.isInteger(priority)) throw new Error(`objects.inv: invalid priority: ${priority}`)
    if (/\s/.test(entry.uri)) throw new Error(`objects.inv: invalid URI: ${entry.uri}`)
    const key = `${type}\0${!options.legacyCaseSensitiveLabels && (type === 'std:label' || type === 'std:term') ? name.toLowerCase() : name}`
    if (seen.has(key)) throw new Error(`objects.inv: duplicate reference: ${type} ${name}`)
    seen.add(key)
    // A terminal dollar is substitution syntax even when it is a literal URI byte.
    let uri = entry.uri.replace(/\$$/, '%24')
    if (entry.uri.endsWith(`#${name}`) && !name.endsWith('$')) uri = `${entry.uri.slice(0, -name.length)}$`
    return `${name} ${type} ${priority} ${uri} ${dispname === name || !dispname.trim() ? '-' : dispname}\n`
  })
  return Buffer.concat([Buffer.from(header), deflateSync(Buffer.from(lines.join('')), { level: 9 })])
}

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

/** Serialise a model as `objects.inv` bytes. */
export function writeInventory(model: ApiModelBase & { port?: string; language?: string }, options: InventoryOptions): Buffer {
  const entries: InventoryEntry[] = []
  const parentKinds = new Map(model.symbols.map((symbol) => [symbol.id, symbol.kind]))
  const symbolRole = (symbol: ApiSymbol) => inventoryType(symbol, model.language ?? model.port ?? '', symbol.parent ? parentKinds.get(symbol.parent) : undefined)
  const cName = (symbol: ApiSymbol) => symbolRole(symbol) === 'c:enumerator' ? symbol.name : qualifiedNameOf(symbol)
  const spellings = new Map<string, number>()
  if (model.language === 'c') for (const symbol of model.symbols) {
    const key = `${symbolRole(symbol)}:${cName(symbol)}`
    spellings.set(key, (spellings.get(key) ?? 0) + 1)
  }
  // Sorted, so the file is byte-stable across runs and a diff means a real
  // change rather than a map iteration order.
  const sorted = [...model.symbols].sort((a, b) =>
    (a.publicId ?? a.id).localeCompare(b.publicId ?? b.id),
  )
  for (const symbol of sorted) {
    const role = symbolRole(symbol)
    const spelling = cName(symbol)
    // Sphinx consumers ask for C spellings, not our declaration IDs. A
    // duplicated file-local name or an anonymous type keeps its scoped ID.
    const name = model.language === 'c' && !/\s/.test(spelling) && spellings.get(`${role}:${spelling}`) === 1
      ? spelling : symbol.publicId ?? symbol.id
    // Legacy model exports require declaration IDs. Spaces usually mean an
    // extractor captured a field initializer or a type expression as its name.
    if (/\s/.test(name)) {
      throw new Error(
        `objects.inv: symbol name contains whitespace and cannot be serialised: ${JSON.stringify(name)}. ` +
          'This is an extractor bug — a name should never contain a space.',
      )
    }
    entries.push({ name, type: role, priority: 1, uri: options.uriFor(symbol), dispname: qualifiedNameOf(symbol) })
  }
  return writeInventoryEntries(entries, { ...options, legacyCaseSensitiveLabels: true })
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
