import type { Node } from 'web-tree-sitter'
import type { ApiModel, ApiSymbol } from '../model.ts'
import { parserFor } from '../parser.ts'

interface Import { path: string[]; alias?: string; wildcard?: boolean }
type Export = { module: string } | { symbol: ApiSymbol }
interface Module {
  crate: string
  path: string[]
  children: Map<string, string>
  exports: Map<string, Export>
  imports: Import[]
}

function imports(node: Node, prefix: string[] = []): Import[] {
  if (node.type === 'use_list') return node.namedChildren.flatMap((child) => child ? imports(child, prefix) : [])
  if (node.type === 'scoped_use_list') {
    return imports(node.childForFieldName('list')!, [...prefix, ...node.childForFieldName('path')!.text.split('::')])
  }
  if (node.type === 'use_as_clause') {
    return [{ path: [...prefix, ...node.childForFieldName('path')!.text.split('::')], alias: node.childForFieldName('alias')!.text }]
  }
  if (node.type === 'use_wildcard') return [{ path: [...prefix, ...node.text.replace(/::\*$/, '').split('::')], wildcard: true }]
  if (['identifier', 'scoped_identifier', 'self', 'crate', 'super'].includes(node.type)) {
    return [{ path: [...prefix, ...node.text.split('::')] }]
  }
  throw new Error(`Unsupported Rust public import: ${node.text}`)
}

function hidden(node: Node): boolean {
  for (let prior = node.previousNamedSibling; prior; prior = prior.previousNamedSibling) {
    if (prior.type === 'attribute_item') {
      if (/\bcfg\s*\(\s*(?:test|doctest)\s*\)|\bdoc\s*\(\s*hidden\s*\)/.test(prior.text)) return true
    } else if (!['line_comment', 'block_comment'].includes(prior.type)) break
  }
  return false
}

/** Resolve split crates through authored exports and the compiler's public inventory. */
export async function attachRustPackageExports(model: ApiModel, read: (path: string) => string | undefined): Promise<void> {
  const crates = ['libtmux', 'libtmux-core', 'libtmux-tokio'].filter((name) => read(`crates/${name}/src/lib.rs`) !== undefined)
  if (crates.length < 2) return
  const parser = await parserFor('rust')
  const modules = new Map<string, Module>()
  const byNamespace = new Map(crates.map((name) => [name.replaceAll('-', '_'), name]))
  const inventory = new Map(crates.map((name) => [name, new Set(
    [...(read(`crates/${name}/docs/public-api.txt`) ?? '').matchAll(/^\w+ ([\w:]+)(?=<|: | = |$)/gm)].map((match) => match[1]),
  )]))
  const key = (crate: string, path: string[]) => [crate.replaceAll('-', '_'), ...path].join('.')
  const load = (crate: string, path: string[], inline?: { file: string; body: Node }): string | undefined => {
    const id = key(crate, path)
    if (modules.has(id)) return id
    const stem = `crates/${crate}/src/${path.join('/')}`
    const candidates = path.length ? [`${stem}.rs`, `${stem}/mod.rs`] : [`${stem}lib.rs`]
    const file = inline?.file ?? candidates.find((candidate) => read(candidate) !== undefined)
    if (!file) return undefined
    const tree = inline ? undefined : parser.parse(read(file)!)
    const body = inline?.body ?? tree?.rootNode
    if (!body) throw new Error(`Cannot parse Rust export module: ${file}`)
    try {
      const module: Module = { crate, path, children: new Map(), exports: new Map(), imports: [] }
      modules.set(id, module)
      const excluded = new Set(body.namedChildren.filter((node) => node && hidden(node))
        .map((node) => node?.childForFieldName('name')?.text))
      const nested = body.namedChildren.filter((node) => node?.type === 'mod_item')
        .map((node) => node?.childForFieldName('body')).filter((node) => node !== null && node !== undefined)
      const contains = (node: Node, line: number) => line >= node.startPosition.row + 1 && line <= node.endPosition.row + 1
      for (const symbol of model.symbols) {
        if (symbol.parent || excluded.has(symbol.name) || !(symbol.source.file === file || symbol.source.file.endsWith(`/${file}`))) continue
        const line = symbol.source.line
        if (line === undefined) throw new Error(`Rust package export lacks a source line: ${symbol.id}`)
        const direct = body.namedChildren.some((node) => node?.childForFieldName('name')?.text === symbol.name &&
          node.startPosition.row + 1 === line)
        if (!contains(body, line) || (!direct && nested.some((node) => contains(node, line)))) continue
        symbol.package ??= crate
        module.exports.set(symbol.name, { symbol })
      }
      for (const node of body.namedChildren) {
        if (!node || hidden(node)) continue
        const publicItem = node.namedChildren.some((child) => child?.type === 'visibility_modifier' && child.text === 'pub')
        if (node.type === 'mod_item') {
          const name = node.childForFieldName('name')!.text
          const nested = node.childForFieldName('body')
          const child = load(crate, [...path, name], nested ? { file, body: nested } : undefined)
          if (child) {
            module.children.set(name, child)
            if (publicItem) module.exports.set(name, { module: child })
          }
        } else if (node.type === 'use_declaration' && publicItem) {
          module.imports.push(...imports(node.childForFieldName('argument')!))
        }
      }
      return id
    } finally {
      tree?.delete()
    }
  }
  try {
    crates.forEach((crate) => load(crate, []))
  } finally {
    parser.delete()
  }
  const resolve = (module: Module, path: string[]): Export | undefined => {
    const parts = [...path]
    let current = key(module.crate, module.path)
    if (byNamespace.has(parts[0])) current = key(byNamespace.get(parts.shift()!)!, [])
    else if (parts[0] === 'crate') { parts.shift(); current = key(module.crate, []) }
    else if (parts[0] === 'self') parts.shift()
    else while (parts[0] === 'super') { parts.shift(); current = current.split('.').slice(0, -1).join('.') }
    let entry: Export | undefined = { module: current }
    for (const name of parts) {
      if (!entry || !('module' in entry)) return undefined
      const owner = modules.get(entry.module)
      entry = owner?.children.has(name) ? { module: owner.children.get(name)! } : owner?.exports.get(name)
    }
    return entry
  }
  // Reexports can cross several private modules before reaching the root.
  for (let pass = 0; pass <= modules.size; pass++) {
    let changed = false
    for (const module of modules.values()) for (const item of module.imports) {
      const target = resolve(module, item.path)
      const entries = target && item.wildcard && 'module' in target
        ? modules.get(target.module)?.exports ?? []
        : target ? [[item.alias ?? item.path.at(-1)!, target] as const] : []
      for (const [name, exported] of entries) if (!module.exports.has(name)) {
        module.exports.set(name, exported)
        changed = true
      }
    }
    if (!changed) break
  }
  const descendants = (owner: ApiSymbol) => model.symbols.filter((symbol) => symbol.id === owner.id || symbol.id.startsWith(`${owner.id}.`))
  const aliases: ApiSymbol[] = []
  const paths = new Map<ApiSymbol, string>()
  for (const crate of crates) {
    const walk = (moduleId: string, path: string[], visited: Set<string>) => {
      if (visited.has(moduleId)) return
      for (const [name, entry] of modules.get(moduleId)?.exports ?? []) {
        const publicPath = [...path, name]
        if ('module' in entry) { walk(entry.module, publicPath, new Set([...visited, moduleId])); continue }
        const native = publicPath.join('::')
        if (!inventory.get(crate)?.has(native)) continue
        if (entry.symbol.package === crate) {
          const existing = paths.get(entry.symbol)
          if (!existing || publicPath.length < existing.split('.').length) paths.set(entry.symbol, publicPath.join('.'))
        } else {
          for (const original of descendants(entry.symbol)) {
            const suffix = original.id.slice(entry.symbol.id.length)
            const qualifiedName = publicPath.join('.') + suffix
            const aliasRoot = crate === 'libtmux' && entry.symbol.package === 'libtmux-core'
              ? entry.symbol.id.replace(/^libtmux_core\./, '') : publicPath.join('.')
            const aliasId = aliasRoot + suffix
            if (!inventory.get(crate)?.has(qualifiedName.replaceAll('.', '::'))) continue
            if (aliases.some((symbol) => symbol.id === aliasId) || model.symbols.some((symbol) => symbol.id === aliasId)) continue
            aliases.push({ ...structuredClone(original), id: aliasId, publicId: aliasId, qualifiedName,
              package: crate, publicOwner: original.id,
              parent: suffix ? aliasRoot + original.parent!.slice(entry.symbol.id.length) : undefined })
          }
        }
      }
    }
    walk(key(crate, []), [crate.replaceAll('-', '_')], new Set())
  }
  for (const [owner, path] of paths) for (const symbol of descendants(owner)) {
    symbol.qualifiedName = path + symbol.id.slice(owner.id.length)
  }
  const publicSymbols = new Set([...paths.keys()].flatMap(descendants))
  model.symbols = model.symbols.filter((symbol) => !crates.includes(symbol.package ?? '') || publicSymbols.has(symbol))
  model.symbols.push(...aliases)

  // Keep existing reference routes when a verified export moves its source file.
  const legacyIds: Record<string, string> = {
    'libtmux.control.Event': 'control.Event',
    'libtmux.IdParseError': 'error.IdParseError',
    'libtmux.TmuxText': 'formats.text.TmuxText',
    'libtmux.SessionName': 'target.SessionName',
    'libtmux.SessionNameError': 'target.SessionNameError',
    'libtmux.TmuxArg': 'target.TmuxArg',
    'libtmux.escape_format': 'target.escape_format',
    'libtmux.ReleaseSuffix': 'version.ReleaseSuffix',
    'libtmux.ReleaseVersion': 'version.ReleaseVersion',
  }
  const moved = model.symbols.filter((symbol) => symbol.package === 'libtmux' && !symbol.parent &&
    symbol.qualifiedName && legacyIds[symbol.qualifiedName] && symbol.id !== legacyIds[symbol.qualifiedName])
    .map((symbol) => [symbol.id, legacyIds[symbol.qualifiedName!]] as const)
  const remap = (id: string) => {
    const move = moved.find(([old]) => id === old || id.startsWith(`${old}.`))
    return move ? move[1] + id.slice(move[0].length) : id
  }
  for (const symbol of model.symbols) {
    for (const field of ['id', 'publicId', 'parent', 'publicOwner', 'inheritedFrom'] as const) {
      if (symbol[field]) symbol[field] = remap(symbol[field])
    }
  }
  if (new Set(model.symbols.map((symbol) => symbol.id)).size !== model.symbols.length) {
    throw new Error('Rust package exports produced duplicate reference IDs')
  }
}
