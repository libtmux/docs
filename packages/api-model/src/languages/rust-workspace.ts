import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'smol-toml'
import type { ApiModel, ApiSymbol, ExtractOptions } from '../model.ts'
import { extractProject } from '../project.ts'

export interface RustCrate {
  name: string
  namespace: string
  root: string
  inventory: string
}

const crate = (name: string): RustCrate => ({
  name, namespace: name.replaceAll('-', '_'), root: `crates/${name}/src`,
  inventory: `crates/${name}/docs/public-api.txt`,
})
const drivers = ['libtmux-core', 'libtmux-blocking', 'libtmux-tokio', 'libtmux']

/** Choose package boundaries from the selected source, preserving older release identities. */
export function rustWorkspaceLayout(read: (file: string) => string | undefined): RustCrate[] | undefined {
  if (!drivers.slice(0, 3).some((name) => read(`crates/${name}/Cargo.toml`) !== undefined)) return undefined
  const crates = drivers.map(crate)
  for (const entry of crates) {
    const raw = read(`crates/${entry.name}/Cargo.toml`)
    const manifest = raw === undefined ? undefined : parse(raw)
    const packageInfo = manifest?.package
    if (!packageInfo || typeof packageInfo !== 'object' || Array.isArray(packageInfo) ||
      packageInfo instanceof Date || !('name' in packageInfo) || packageInfo.name !== entry.name) {
      throw new Error(`Incomplete Rust driver layout: ${entry.name}`)
    }
  }
  if (read('crates/tmux-workspace/Cargo.toml') !== undefined) crates.push(crate('tmux-workspace'))
  return crates
}

/** Qualify declarations before combining crates so equally named owners cannot merge. */
export async function extractRustWorkspace(options: {
  root: string
  revision?: string
  options?: Partial<ExtractOptions>
}): Promise<ApiModel> {
  const read = (file: string) => existsSync(join(options.root, file))
    ? readFileSync(join(options.root, file), 'utf8') : undefined
  const layout = rustWorkspaceLayout(read)
  if (!layout) return extractProject({
    port: 'rs', root: join(options.root, 'crates/libtmux/src'),
    roots: ['libtmux', 'tmux-workspace'].map((name) => join(options.root, `crates/${name}/src`))
      .filter(existsSync), revision: options.revision, options: options.options,
  })
  const models = []
  for (const entry of layout) {
    const model = await extractProject({
      port: 'rs', root: join(options.root, entry.root), revision: options.revision, options: options.options,
    })
    const qualify = (id: string) => `${entry.namespace}.${id.replace(/^src\./, '')}`
    for (const symbol of model.symbols) {
      const declared = symbol.id
      symbol.id = qualify(declared)
      symbol.publicId = qualify(symbol.publicId ?? declared)
      if (symbol.parent) symbol.parent = qualify(symbol.parent)
      if (symbol.inheritedFrom) symbol.inheritedFrom = qualify(symbol.inheritedFrom)
      symbol.namespace = entry.namespace
      symbol.qualifiedName = symbol.id
    }
    models.push(model)
  }
  const symbols = models.flatMap((model) => model.symbols)
  qualifyRustPublicIds(symbols, read)
  return {
    port: 'rs', revision: options.revision, extractor: '@libtmux/api-model@0.0.1', symbols,
    ...(models.some((model) => model.pruned) ? { pruned: {
      kept: symbols.length, dropped: models.reduce((sum, model) => sum + (model.pruned?.dropped ?? 0), 0),
      rules: [...new Set(models.flatMap((model) => model.pruned?.rules ?? []))],
    } } : {}),
  }
}

/** Resolve native public paths only within each defining crate's committed inventory. */
export function qualifyRustPublicIds(symbols: ApiSymbol[], read: (file: string) => string | undefined): void {
  const layout = rustWorkspaceLayout(read)
  if (!layout) return
  const owners = symbols.filter((symbol) => !symbol.parent)
  const paths = new Map<ApiSymbol, string>()
  const aliases = new Map<string, Record<string, string>>()
  const visiblePaths = new Map<string, Set<string>>()
  for (const entry of layout) {
    const raw = read(entry.inventory)
    if (raw === undefined && entry.name === 'tmux-workspace') continue
    if (raw === undefined) throw new Error(`Missing Rust native inventory: ${entry.inventory}`)
    const native = [...raw.matchAll(/^(struct|enum|union|trait|type|typealias|type_alias|function|constant|assoc_const|assoc_type|struct_field|variant|module) (\w+(?:::\w+)*)(?=[<(: ]|$)/gm)]
      .map((match) => ({ kind: ['type', 'type_alias'].includes(match[1]) ? 'typealias' : match[1], path: match[2].replaceAll('::', '.') }))
      .filter((item) => item.path.startsWith(`${entry.namespace}.`))
    visiblePaths.set(entry.namespace, new Set(native.map((item) => item.path)))
    const own = owners.filter((symbol) => symbol.namespace === entry.namespace)
    for (const symbol of own) {
      const candidates = native.filter((item) => item.kind === symbol.kind && item.path.endsWith(`.${symbol.name}`))
      const exact = candidates.find((item) => item.path === symbol.id)
      if (exact || candidates.length === 1) paths.set(symbol, (exact ?? candidates[0]).path)
    }
    const imports: Record<string, string> = {}
    for (const item of native) {
      const name = item.path.split('.').at(-1)!
      const ownMatch = own.filter((symbol) => symbol.name === name && symbol.kind === item.kind)
      const candidates = ownMatch.length ? ownMatch : owners.filter((symbol) => symbol.name === name && symbol.kind === item.kind)
      if (candidates.length === 1) imports[name] = candidates[0].id
    }
    aliases.set(entry.namespace, imports)
  }
  const byId = new Map(symbols.map((symbol) => [symbol.id, symbol]))
  const publicId = (symbol: ApiSymbol): string => paths.get(symbol) ?? (symbol.parent && byId.has(symbol.parent)
    ? `${publicId(byId.get(symbol.parent)!)}.${symbol.name}` : symbol.id)
  for (const symbol of symbols) {
    if (!symbol.namespace) continue
    symbol.qualifiedName ??= symbol.id
    symbol.publicId = publicId(symbol)
    const imports = Object.fromEntries(Object.entries(aliases.get(symbol.namespace) ?? {})
      .map(([name, id]) => [name, byId.has(id) ? publicId(byId.get(id)!) : id]))
    symbol.imports = { ...imports, ...symbol.imports }
  }
  // Hidden modules remain available to syntax extraction so visible aliases and
  // signature types can be documented. The native ledger defines which of those
  // declarations and members can become reference pages or search entries.
  const visible = symbols.filter((symbol) => !symbol.namespace || !visiblePaths.has(symbol.namespace) ||
    visiblePaths.get(symbol.namespace)!.has(symbol.publicId ?? symbol.id))
  symbols.splice(0, symbols.length, ...visible)
}
