import { describe, expect, it } from 'vitest'
import { qualifiedNameOf, type ApiSymbol } from '@libtmux/api-model'
import { API_MODELS } from '../src/lib/api-models'
import { symbolPreview } from '../src/lib/link-preview'
import { nativeQualifiedName, nativeShortName } from '../src/lib/native-name'
import { productApiHref } from '../src/lib/product-api'

/**
 * The page's Qualified name row says a declaration the way the language writes it, in full: Rust spells a path with `::`
 * from its crate and TypeScript names a member by its owner, and every other port already keeps its own spelling in the
 * public id, which must stay as it was. A card's header says it in short, as the page heading does: the owner and the
 * member in the language's separator.
 */
const symbolNamed = (port: string, id: string) => {
  const symbol = API_MODELS[port].symbols.find((entry) => (entry.publicId ?? entry.id) === id)
  if (!symbol) throw new Error(`${port} has no ${id}`)
  return symbol
}
const name = (port: string, id: string) => nativeQualifiedName(API_MODELS[port], symbolNamed(port, id))

/** What is wrong with a Rust display name, so that a control can show the check is able to fail. */
function rustProblems(symbol: ApiSymbol, shown: string): string[] {
  const problems: string[] = []
  if (/\./.test(shown)) problems.push('has a dot where a path has `::`')
  if (!/^[a-z][a-z0-9_]*::/.test(shown)) problems.push('does not begin at its crate')
  if (!shown.endsWith(`::${symbol.name}`)) problems.push('does not end with its own name')
  if (/^[a-z_]+::(?:src|mcp)(?:::|$)/.test(shown)) problems.push('keeps the extractor\'s marker for the crate root or the product')
  return problems
}

describe('Rust names', () => {
  it('spell the path from the crate with `::`, as `use` writes it', () => {
    expect(name('rs', 'control.ControlSender.unmute_pane')).toBe('libtmux::control::ControlSender::unmute_pane')
    expect(name('rs', 'blocking.Runtime.new')).toBe('libtmux::blocking::Runtime::new')
    expect(name('rs', 'client.Client')).toBe('libtmux::client::Client')
    expect(name('rs', 'error.scoped.ScopeError.Creation')).toBe('libtmux::error::scoped::ScopeError::Creation')
  })

  it('take the crate each product is built in, with the underscores its path uses', () => {
    expect(name('rs', 'config.ConfigError')).toBe('tmux_workspace::config::ConfigError')
    expect(name('rs', 'mcp.caller.Relation')).toBe('tmux_mcp::caller::Relation')
  })

  it('leave out the marker for the crate root and the marker for the product', () => {
    const root = API_MODELS.rs.symbols.find((symbol) => (symbol.publicId ?? symbol.id).startsWith('src.') && symbol.source.file.endsWith('/lib.rs') && !symbol.parent)!
    expect(nativeQualifiedName(API_MODELS.rs, root)).toBe(`libtmux::${root.name}`)
    expect(name('rs', 'mcp.cli.Options')).toBe('tmux_mcp::cli::Options')
    expect(name('rs', 'mcp.src.TmuxTools.new')).toBe('tmux_mcp::TmuxTools::new')
  })

  it('read as a path for every symbol of the port', { timeout: 30_000 }, () => {
    for (const symbol of API_MODELS.rs.symbols) {
      const shown = nativeQualifiedName(API_MODELS.rs, symbol)
      expect(rustProblems(symbol, shown), `${qualifiedNameOf(symbol)} -> ${shown}`).toEqual([])
    }
  })

  it('has a control: the public id is not a Rust path, and the check says why', () => {
    const symbol = symbolNamed('rs', 'control.ControlSender.unmute_pane')
    expect(rustProblems(symbol, nativeQualifiedName(API_MODELS.rs, symbol))).toEqual([])
    expect(rustProblems(symbol, qualifiedNameOf(symbol))).toEqual(['has a dot where a path has `::`', 'does not begin at its crate', 'does not end with its own name'])
  })
})

describe('TypeScript names', () => {
  it('name a member by its owner and leave out the file it is written in', () => {
    expect(name('ts', 'client.Client.session')).toBe('Client.session')
    expect(name('ts', 'client.Client')).toBe('Client')
    expect(name('ts', 'common.isSafeInteger')).toBe('isSafeInteger')
    expect(name('ts', 'errors.TmuxTransportError.#stderr')).toBe('TmuxTransportError.#stderr')
  })

  it('leave out the file of a product that the id also prefixes', () => {
    expect(name('ts', 'mcp.server.createTmuxMcpServer')).toBe('createTmuxMcpServer')
    expect(name('ts', 'mcp.policy.Policy.tools')).toBe('Policy.tools')
  })

  it('are the end of the public id for every symbol of the port, and end with its own name', { timeout: 30_000 }, () => {
    for (const symbol of API_MODELS.ts.symbols) {
      const shown = nativeQualifiedName(API_MODELS.ts, symbol)
      expect(qualifiedNameOf(symbol).endsWith(shown), qualifiedNameOf(symbol)).toBe(true)
      expect(shown.endsWith(symbol.name), qualifiedNameOf(symbol)).toBe(true)
      // A member keeps its owner, and a declaration with none is a bare name.
      expect(shown.includes('.'), qualifiedNameOf(symbol)).toBe(!!symbol.parent)
    }
  })
})

describe('the other ports', () => {
  it('keep the public id exactly, for every symbol', { timeout: 30_000 }, () => {
    for (const [port, model] of Object.entries(API_MODELS)) {
      if (port === 'rs' || port === 'ts') continue
      for (const symbol of model.symbols) expect(nativeQualifiedName(model, symbol), `${port} ${symbol.id}`).toBe(qualifiedNameOf(symbol))
    }
  })

  // Each family keeps the separator its language writes, which the id carries.
  it.each([
    ['cxx', /::/, undefined], ['ruby', /::/, undefined], ['lua', /:/, undefined], ['elixir', /\//, undefined], ['powershell', /\\/, undefined],
    ['py', /\./, /::/], ['go', /\./, /::/], ['swift', /\./, /::/], ['java', /\./, /::/], ['csharp', /\./, /::/], ['julia', /\./, /::/],
  ] as const)('%s keeps the separator its language writes', (port, wanted, unwanted) => {
    const shown = API_MODELS[port].symbols.map((symbol) => nativeQualifiedName(API_MODELS[port], symbol))
    expect(shown.some((entry) => wanted.test(entry)), port).toBe(true)
    // A port that writes dots never gets `::` from this change.
    if (unwanted) expect(shown.some((entry) => unwanted.test(entry)), port).toBe(false)
  })

  it('keep Ruby\'s `#` for instance members and Elixir\'s arity', () => {
    expect(API_MODELS.ruby.symbols.some((symbol) => nativeQualifiedName(API_MODELS.ruby, symbol).includes('#'))).toBe(true)
    expect(API_MODELS.elixir.symbols.some((symbol) => /\/\d+$/.test(nativeQualifiedName(API_MODELS.elixir, symbol)))).toBe(true)
  })
})

const shortName = (port: string, id: string) => nativeShortName(API_MODELS[port], symbolNamed(port, id))

describe('short names', () => {
  it('name a Rust member by its owner with `::`, and a declaration with no owner by itself', () => {
    expect(shortName('rs', 'server.Server.new_session')).toBe('Server::new_session')
    expect(shortName('rs', 'control.ControlSender.unmute_pane')).toBe('ControlSender::unmute_pane')
    expect(shortName('rs', 'config.ConfigError')).toBe('ConfigError')
    expect(shortName('rs', 'mcp.src.TmuxTools.new')).toBe('TmuxTools::new')
    expect(shortName('rs', 'error.scoped.ScopeError.Creation')).toBe('ScopeError::Creation')
  })

  it('name a TypeScript member by its owner', () => {
    expect(shortName('ts', 'server.Server.newSession')).toBe('Server.newSession')
    expect(shortName('ts', 'client.Client.session')).toBe('Client.session')
    expect(shortName('ts', 'errors.TmuxTransportError.#stderr')).toBe('TmuxTransportError.#stderr')
    expect(shortName('ts', 'common.isSafeInteger')).toBe('isSafeInteger')
  })

  it.each([
    ['cxx', 'libtmux::Server::new_session', 'Server::new_session'],
    ['cxx', 'libtmux::AttachCommand', 'AttachCommand'],
    ['ruby', 'LibTmux::Server#new_session', 'Server#new_session'],
    ['ruby', 'LibTmux::Async.open', 'Async.open'],
    ['ruby', 'LibTmux::Async::ControlConnection', 'Async::ControlConnection'],
    ['lua', 'libtmux.Server:new_session', 'Server:new_session'],
    ['lua', 'libtmux.BreakPaneOptions.name', 'BreakPaneOptions.name'],
    ['go', 'tmux.Server.NewSession', 'Server.NewSession'],
    ['elixir', 'LibTmux.Capture.fetch/2', 'Capture.fetch/2'],
    ['powershell', 'LibTmux\\Connect-TmuxControl', 'LibTmux\\Connect-TmuxControl'],
    ['py', 'libtmux.Server.new_session', 'Server.new_session'],
    ['py', 'libtmux._internal.env.resolve_env', 'resolve_env'],
    ['java', 'io.github.libtmux.Server.Server.newSession', 'Server.newSession'],
    ['kotlin', 'io.github.libtmux.kotlin.Server.newSession', 'Server.newSession'],
    ['csharp', 'LibTmux.TmuxBuffers.SetAsync', 'TmuxBuffers.SetAsync'],
    ['julia', 'LibTmux.BatchResult.operations', 'BatchResult.operations'],
    ['julia', 'LibTmux.cancel!', 'cancel!'],
  ] as const)('keeps the separator %s writes: %s -> %s', (port, id, expected) => {
    expect(shortName(port, id)).toBe(expected)
  })

  it('keeps Swift\'s labels, as the page heading does', () => {
    const symbol = API_MODELS.swift.symbols.find((entry) => entry.name.startsWith('newSession(named:'))!
    expect(nativeShortName(API_MODELS.swift, symbol)).toBe(`Server.${symbol.name}`)
  })

  it('are the owner, a separator that the language writes, and the member, for every symbol of every port', { timeout: 30_000 }, () => {
    const separators: Record<string, string[]> = { rs: ['::'], cxx: ['::'], ruby: ['::', '.', '#'], lua: ['.', ':'], powershell: ['\\'] }
    for (const [port, model] of Object.entries(API_MODELS)) {
      const owners = new Map(model.symbols.map((symbol) => [symbol.id, symbol]))
      for (const symbol of model.symbols) {
        const shown = nativeShortName(model, symbol)
        const owner = symbol.parent ? owners.get(symbol.parent) : undefined
        if (!owner) { expect(shown, `${port} ${symbol.id}`).toBe(symbol.name); continue }
        expect(shown.startsWith(owner.name) && shown.endsWith(symbol.name), `${port} ${symbol.id}`).toBe(true)
        const separator = shown.slice(owner.name.length, shown.length - symbol.name.length)
        expect(separators[port] ?? ['.'], `${port} ${symbol.id}`).toContain(separator)
      }
    }
  })

  it('are the end of the full name wherever the id ends with the name, so the card is the page\'s name without its path', { timeout: 30_000 }, () => {
    for (const [port, model] of Object.entries(API_MODELS)) {
      for (const symbol of model.symbols) {
        if (!qualifiedNameOf(symbol).endsWith(symbol.name)) continue
        expect(nativeQualifiedName(model, symbol).endsWith(nativeShortName(model, symbol)), `${port} ${symbol.id}`).toBe(true)
      }
    }
  })

  it('has a control: a full name is longer than its short form wherever the declaration has a path', () => {
    const symbol = symbolNamed('rs', 'control.ControlSender.unmute_pane')
    expect(nativeQualifiedName(API_MODELS.rs, symbol)).toBe('libtmux::control::ControlSender::unmute_pane')
    expect(nativeShortName(API_MODELS.rs, symbol)).toBe('ControlSender::unmute_pane')
    expect(nativeShortName(API_MODELS.rs, symbol).length).toBeLessThan(nativeQualifiedName(API_MODELS.rs, symbol).length)
  })
})

describe('where the name is used', () => {
  it('heads the card in short and leaves the full name to the page row', () => {
    expect(symbolPreview(API_MODELS.rs, symbolNamed('rs', 'server.Server.new_session'), 'latest').title).toBe('Server::new_session')
    expect(symbolPreview(API_MODELS.rs, symbolNamed('rs', 'control.ControlSender.unmute_pane'), 'latest').title).toBe('ControlSender::unmute_pane')
    expect(symbolPreview(API_MODELS.ts, symbolNamed('ts', 'client.Client.session'), 'latest').title).toBe('Client.session')
    for (const [port, model] of Object.entries(API_MODELS)) {
      const symbol = model.symbols.find((entry) => entry.parent) ?? model.symbols[0]
      expect(symbolPreview(model, symbol, 'latest').title, port).toBe(nativeShortName(model, symbol))
    }
  })

  it('leaves the public id, the page address and the anchor as they were', () => {
    for (const [port, id, href] of [
      ['rs', 'control.ControlSender.unmute_pane', '/rs/latest/reference/control-controlsender-unmute_pane/'],
      ['ts', 'client.Client.session', '/ts/latest/reference/client-client-session/'],
    ] as const) {
      const symbol = symbolNamed(port, id)
      expect(productApiHref(API_MODELS[port], symbol, 'latest')).toBe(href)
      expect(symbolPreview(API_MODELS[port], symbol, 'latest').href).toBe(href)
      expect(qualifiedNameOf(symbol)).toBe(id)
    }
  })
})
