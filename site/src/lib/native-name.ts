import { qualifiedNameOf, type ApiSymbol } from '@libtmux/api-model'

/**
 * The name a programmer writes for a declaration, in the language's own spelling.
 *
 * A symbol's public id is the same dotted path in every model, because the extractors share one shape. Most ports
 * write that path as it is (Python `libtmux.Server.new_session`, Go `tmux.Client.Session`), and two already keep
 * their own separators in the id (C++ `libtmux::Server`, Ruby `LibTmux::Server#list_sessions`, Lua
 * `libtmux.Buffer:reference`, Elixir `LibTmux.Capture.fetch/2`, PowerShell `LibTmux\Connect-TmuxServer`). Rust and
 * TypeScript are the two that need a spelling of their own:
 *
 * - Rust names a path with `::` from the crate: `libtmux::control::ControlSender::unmute_pane`. The id begins at the
 *   module, so the crate comes from the file the symbol is written in, and the markers the extractor adds for the
 *   product (`mcp`) and for the crate root (`src`) are not part of the path.
 * - TypeScript names a member by its owner: `Client.session`. The id begins with the file the symbol is written in
 *   (`client`), which a reader never writes; the file is the Module row of the page.
 *
 * `nativeShortName` is the short form a hover card uses for its header: the owner and the member in the language's
 * separator (`ControlSender::unmute_pane`, `Server#new_session`, `Buffer:reference`, `Capture.fetch/2`), and the bare name
 * for a declaration with no owner. The full name is the page's Qualified name row. The page heading still joins the owner
 * and the member with a dot in every port, so for Rust, C++, Ruby, Lua and PowerShell it differs from the card's header.
 *
 * This is for display. The public id, the anchors and the URLs stay as the model has them.
 */
export function nativeQualifiedName(model: { port?: string; symbols: readonly ApiSymbol[] } | undefined, symbol: ApiSymbol): string {
  const id = qualifiedNameOf(symbol)
  if (model?.port === 'rs') return rustName(model, symbol, id)
  if (model?.port === 'ts') return typescriptName(model, symbol, id)
  return id
}

const byId = new WeakMap<readonly ApiSymbol[], Map<string, ApiSymbol>>()

function symbolTable(symbols: readonly ApiSymbol[]): Map<string, ApiSymbol> {
  let table = byId.get(symbols)
  if (!table) { table = new Map(symbols.map((entry) => [entry.id, entry])); byId.set(symbols, table) }
  return table
}

/** The outermost declaration that `symbol` is written in, or `symbol` itself when it has no owner. */
function outermost(symbols: readonly ApiSymbol[], symbol: ApiSymbol): ApiSymbol {
  const table = symbolTable(symbols)
  const seen = new Set([symbol.id])
  let top = symbol
  while (top.parent) {
    const next = table.get(top.parent)
    if (!next || seen.has(next.id)) break
    seen.add(next.id)
    top = next
  }
  return top
}

/** The crate a Rust symbol is written in: a package name uses hyphens where the crate that it builds does not. */
const rustCrate = (symbol: ApiSymbol) => /^crates\/([^/]+)\/src\//.exec(symbol.source?.file ?? '')?.[1]?.replace(/-/g, '_')

/** A tuple field is named by position, which a path cannot hold: rustdoc writes `Window.0`, and so does this. */
const tupleField = (name: string) => /^\d+$/.test(name)

/**
 * The package a symbol is declared in, where the model does not say: the crate of a Rust symbol, so that a symbol of
 * `tmux_mcp` is not credited to `libtmux`. Any other port names the package of a symbol in the symbol itself, or
 * has one for the whole port.
 */
export function nativePackageName(model: { port?: string } | undefined, symbol: ApiSymbol): string | undefined {
  return symbol.package ?? (model?.port === 'rs' ? rustCrate(symbol) : undefined)
}

function rustName(model: { symbols: readonly ApiSymbol[] }, symbol: ApiSymbol, id: string): string {
  const file = symbol.source?.file ?? ''
  const crate = rustCrate(symbol)
  const path = id.split('.')
  if (symbol.product && symbol.product !== 'core' && path[0] === symbol.product) path.shift()
  // A member can be written in another file than its type, so the root is told by the file of the outermost declaration.
  if (path[0] === 'src' && /\/(?:lib|main)\.rs$/.test(outermost(model.symbols, symbol).source?.file ?? file)) path.shift()
  return [crate, ...path].filter((segment): segment is string => !!segment).reduce((name, segment) => tupleField(segment) ? `${name}.${segment}` : name ? `${name}::${segment}` : segment, '')
}

function typescriptName(model: { symbols: readonly ApiSymbol[] }, symbol: ApiSymbol, id: string): string {
  const top = outermost(model.symbols, symbol)
  const topId = qualifiedNameOf(top)
  // The file's part of the id is what comes before the name of the outermost declaration.
  const file = topId.endsWith(`.${top.name}`) ? topId.slice(0, topId.length - top.name.length) : ''
  return file && id.startsWith(file) ? id.slice(file.length) : id
}

/**
 * The owner and the member, in the separator the language writes between them. The id
 * carries that separator (Ruby `#` for an instance method and `.` for a singleton one, Lua `:`, C++ `::`); Rust's id
 * uses dots where the language writes `::`.
 */
export function nativeShortName(model: { port?: string; symbols: readonly ApiSymbol[] } | undefined, symbol: ApiSymbol): string {
  const owner = model && symbol.parent ? symbolTable(model.symbols).get(symbol.parent) : undefined
  if (!owner) return symbol.name
  if (model?.port === 'rs') return `${owner.name}${tupleField(symbol.name) ? '.' : '::'}${symbol.name}`
  const id = qualifiedNameOf(symbol), ownerId = qualifiedNameOf(owner)
  // Swift writes a member's labels in its name and fewer of them in its id, so the id is not always the owner and the name.
  const fits = id.startsWith(ownerId) && id.endsWith(symbol.name) && id.length > ownerId.length + symbol.name.length
  return `${owner.name}${(fits && id.slice(ownerId.length, id.length - symbol.name.length)) || '.'}${symbol.name}`
}
