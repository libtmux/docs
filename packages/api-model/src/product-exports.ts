import { dirname, resolve } from 'node:path'
import type { ApiSymbol, PortSlug } from './model.ts'

interface ExportContext {
  port: PortSlug
  root?: string
  /** Package entry source files, from exports or the crate root. */
  entries: string[]
  readSource: (file: string) => string
}

const escape = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const TYPES = new Set(['class', 'struct', 'interface', 'enum', 'trait', 'typealias', 'exception'])

/** Keep public imports separate from types reachable only through a signature. */
export function scopeProductSymbols(symbols: ApiSymbol[], context: ExportContext): void {
  const exports = new Map<string, Set<string> | '*'>()
  const visited = new Set<string>()
  const collectTs = (file: string) => {
    if (visited.has(file)) return
    visited.add(file)
    const text = context.readSource(file)
    const names = new Set([...text.matchAll(/^export\s+(?:(?:async|declare|abstract|default)\s+)*(?:function|class|interface|type|const|let|enum)\s+(\w+)/gm)].map((match) => match[1]))
    exports.set(file, names)
    for (const match of text.matchAll(/^export\s+(?:type\s+)?(\*|\{[^}]+\})\s+from\s+['"]([^'"]+)['"]/gm)) {
      if (!match[2].startsWith('.')) continue
      const target = resolve(dirname(file), match[2].replace(/\.js$/, '.ts'))
      if (match[1] === '*') collectTs(target)
      else {
        const existing = exports.get(target)
        const named = existing instanceof Set ? existing : new Set<string>()
        for (const part of match[1].slice(1, -1).split(',')) {
          const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]
          if (name) named.add(name)
        }
        exports.set(target, named)
      }
    }
  }
  if (context.port === 'ts') context.entries.forEach(collectTs)
  if (context.port === 'rs') {
    for (const entry of context.entries) {
      exports.set(entry, '*')
      const text = context.readSource(entry)
      for (const match of text.matchAll(/^pub mod (\w+)\s*;/gm)) exports.set(resolve(dirname(entry), `${match[1]}.rs`), '*')
      for (const match of text.matchAll(/^pub use (\w+)::(\*|\{[^}]+\}|\w+)\s*;/gm)) {
        const target = resolve(dirname(entry), `${match[1]}.rs`)
        exports.set(target, match[2] === '*' ? '*' : new Set(match[2].replace(/[{}]/g, '').split(',').map((name) => name.trim().split(/\s+as\s+/)[0]).filter(Boolean)))
      }
    }
  }

  const roots = symbols.filter((symbol) => !symbol.parent)
  for (const symbol of roots) {
    let publicImport = true
    const file = resolve(context.root ?? '.', symbol.source.file)
    const source = context.readSource(file)
    if (context.port === 'ts' || context.port === 'rs') {
      const exported = exports.get(file)
      publicImport = exported === '*' || Boolean(exported?.has(symbol.name))
      if (context.port === 'rs' && context.entries.some((entry) => new RegExp(`^pub\\s+(?:struct|enum|trait|type|const|(?:async\\s+)?fn)\\s+${escape(symbol.name)}\\b`, 'm').test(context.readSource(entry)))) publicImport = true
      if (context.port === 'rs' && new RegExp(`#\\[cfg\\(doctest\\)\\][\\s\\S]*?pub struct ${escape(symbol.name)}\\b`).test(source)) publicImport = false
    } else if (context.port === 'java') {
      publicImport = new RegExp(`\\bpublic\\s+(?:(?:final|abstract|sealed|static)\\s+)*(?:class|record|interface|enum)\\s+${escape(symbol.name)}\\b`).test(source)
    } else if (context.port === 'py') {
      publicImport = !symbol.name.startsWith('_') && !/^(?:logger|log)$/.test(symbol.name) && !/(?:^|\/)(?!__init__\.py$)_(?:[^/]+)(?:\/|\.py$)/.test(file)
    }
    symbol.apiScope = publicImport ? 'exported' : 'internal'
  }

  const byId = new Map(symbols.map((symbol) => [symbol.id, symbol]))
  const inheritScope = (symbol: ApiSymbol): ApiSymbol['apiScope'] => {
    if (symbol.apiScope) return symbol.apiScope
    const parent = symbol.parent ? byId.get(symbol.parent) : undefined
    symbol.apiScope = parent ? inheritScope(parent) : 'internal'
    return symbol.apiScope
  }
  symbols.forEach(inheritScope)

  // A private module can supply a type on a public signature. Its contract
  // needs a page, while the index must not advertise it as a public import.
  if (context.port === 'ts' || context.port === 'rs') {
    let changed = true
    while (changed) {
      changed = false
      const signatures = symbols.filter((symbol) => symbol.apiScope !== 'internal').map((symbol) => JSON.stringify({ type: symbol.type, signatures: symbol.signatures, extends: symbol.extends, value: symbol.kind === 'typealias' ? symbol.value : undefined })).join('\n')
      for (const symbol of roots) {
        if (symbol.apiScope !== 'internal' || !TYPES.has(symbol.kind)) continue
        if (!new RegExp(`\\b${escape(symbol.name)}\\b`).test(signatures)) continue
        symbol.apiScope = 'supporting'
        for (const member of symbols) if (member.id.startsWith(`${symbol.id}.`)) member.apiScope = 'supporting'
        changed = true
      }
    }
  }
}
