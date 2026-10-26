import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { readInventory } from '../src/inventory.ts'
import type { ApiModel, ApiSymbol } from '../src/model.ts'
import { Resolver, notASymbol, toPath } from '../src/resolver.ts'
import { proseMentions } from '../src/mentions.ts'
import { portFromSentence } from '../src/prose.ts'

/**
 * The resolver, against the corpus it exists for.
 *
 * The rate is a floor rather than an assertion of the current number: prose
 * changes, and a test that pins 87% fails on an unrelated edit. What must not
 * regress is the mechanism, so the specific behaviours below are asserted
 * individually — each one is a rule that cost a spike round to establish.
 */
const here = dirname(fileURLToPath(import.meta.url))
const DATA = join(here, '../../../site/src/data/api')
const PORTS = ['py', 'ruby', 'lua', 'ts', 'rs', 'go', 'java', 'csharp', 'cxx', 'swift'] as const
const available = existsSync(join(DATA, 'py.json'))
const d = available ? describe : describe.skip

d('resolver', () => {
  let r: Resolver

  beforeAll(() => {
    const models = PORTS.map((p) => JSON.parse(readFileSync(join(DATA, `${p}.json`), 'utf8')) as ApiModel)
    r = new Resolver(models)
    const inv = join(here, '../../../site/src/data/inventories/python.inv')
    if (existsSync(inv)) {
      r.addInventory('Python', 'https://docs.python.org/3/', readInventory(readFileSync(inv)).entries)
    }
  })

  it('recognises Ruby and Lua when prose selects a port', () => {
    expect(portFromSentence("Ruby's checked wait is `wait_for`")).toBe('ruby')
    expect(portFromSentence("Lua's checked wait is `await`")).toBe('lua')
  })

  it('rejects a version line such as a toolchain range, and keeps a member named x', () => {
    for (const text of ['1.20.x', '29.x', 'v1.x', '3.3.x']) expect(notASymbol(text), text).toBe('a version line')
    for (const text of ['server.x', 'Version.x', 'x']) expect(notASymbol(text), text).toBeUndefined()
  })

  it('rejects a release-numbering label, and keeps a real symbol', () => {
    for (const text of ['0.1.N', 'v0.1.N', '0.1.0', 'v0.1.0', '0.x', '1.2.X']) expect(notASymbol(text), text).toBeTruthy()
    for (const text of ['Server.new_session', 'LibTmux.Window', 'Version.N', 'N']) expect(notASymbol(text), text).toBeUndefined()
  })

  it('rejects things that are not references', () => {
    expect(notASymbol('sync_snippets.py --check')).toBeTruthy()
    expect(notASymbol('pane.pane_id == other.pane_id')).toBeTruthy()
    expect(notASymbol('new ServerConnectionOptions()')).toBeTruthy()
    expect(notASymbol('tmux.ServerOptions{SocketName: "work"}')).toBeTruthy()
    // And does not reject a real one.
    expect(notASymbol('server.sessions()')).toBeUndefined()
    expect(notASymbol('io.github.libtmux:libtmux-scala_3')).toBe('a dependency coordinate')
    expect(notASymbol('3.7c')).toBe('a version')
    expect(notASymbol('Server:new_session')).toBeUndefined()
  })

  it('normalises call syntax to a path', () => {
    expect(toPath('await server.sessions()')).toEqual(['server', 'sessions'])
    expect(toPath('server->sessions()')).toEqual(['server', 'sessions'])
    expect(toPath('libtmux::Server::wait_for(ch)')).toEqual(['libtmux', 'Server', 'wait_for'])
    expect(toPath('Session:new_window(options)')).toEqual(['Session', 'new_window'])
    // A selector's labels go with its argument list, not into the path.
    expect(toPath('Snapshot.sessions(of:)')).toEqual(['Snapshot', 'sessions'])
  })

  it('resolves a Lua method call written with a colon', () => {
    const res = r.resolve('lua', 'Server:new_session')
    expect('symbol' in res ? res.symbol.publicId : res.how).toBe('libtmux.Server:new_session')
  })

  it('treats C, Lua and Ruby source files as filenames', () => {
    for (const text of ['options-table.c', 'tmux.h', 'lua/libtmux/init.lua', 'lib/libtmux.rb']) {
      expect(notASymbol(text)).toBe('a filename')
    }
    expect(notASymbol('pane.height')).toBeUndefined()
  })

  it('preserves an exact Swift selector instead of resolving its same-named property', () => {
    for (const id of ['Snapshot.panes(of:)', 'Snapshot.panes']) {
      const result = r.resolve('swift', id)
      expect('symbol' in result ? result.symbol.publicId : undefined).toBe(id)
    }
  })

  it('scopes an ambiguous member by its receiver', () => {
    // `panes` exists on Server, Session and Window; only the receiver decides.
    const res = r.resolve('py', 'window.panes')
    expect(res.how).toBe('scoped')
    if (res.how === 'scoped') expect(res.symbol.publicId).toBe('libtmux.Window.panes')
  })

  it('resolves a Go method through its receiver type', () => {
    const res = r.resolve('go', 'window.Panes()')
    expect(['scoped', 'unique']).toContain(res.how)
    if (res.how === 'scoped' || res.how === 'unique') {
      expect(res.symbol.parent).toMatch(/Window$/)
    }
  })

  it('treats a module-qualified name as a whole, not as a receiver', () => {
    // `tmux.NewServer` is a package path a Go reader writes. Read as
    // receiver+member it looks for a type named `Tmux` and fails.
    const res = r.resolve('go', 'tmux.NewServer(tmux.ServerOptions{})')
    expect(res.how).not.toBe('no-symbol')
  })

  it('federates a name that is not ours', () => {
    const res = r.resolve('py', 'subprocess.Popen')
    expect(res.how).toBe('federated')
    if (res.how === 'federated') expect(res.href).toContain('docs.python.org')
  })

  it('uses a URL template for Go, where no inventory exists', () => {
    // pkg.go.dev publishes no objects.inv; its URLs are derivable.
    expect(r.resolve('go', 'errors.As').how).toBe('federated')
    // javadoc publishes an index, which the JDK inventory is built from. A name it does
    // not list has no page, and a search address stands in for none.
    expect(r.resolve('java', 'Stream.filter()').how).not.toBe('federated')
  })

  it('refuses rather than guessing when nothing disambiguates', () => {
    // Prose that elides the receiver entirely is underdetermined by its text.
    const res = r.resolve('py', '.get()')
    expect(['ambiguous', 'no-symbol']).toContain(res.how)
  })

  it('answers the cross-port question the estate is for', () => {
    expect(r.portsWith('sessions').length).toBeGreaterThan(3)
    // Rust's MCP handler shares the spelling; that does not make it a core
    // Pane API equivalent. Semantic equivalents remain in the concept map.
    expect(r.portsWith('capture_pane')).toEqual(['py', 'rs'])
    const rust = r.resolve('rs', 'mcp.src.TmuxTools.capture_pane')
    expect('symbol' in rust ? rust.symbol.product : undefined).toBe('mcp')
  })

  it('resolves most unlinked references in the real corpus', () => {
    const LABEL: Record<string, string> = {
      Python: 'py', Ruby: 'ruby', Lua: 'lua', TypeScript: 'ts', Rust: 'rs', Go: 'go',
      Java: 'java', '.NET': 'csharp', 'C++': 'cxx', Swift: 'swift',
    }
    const docs = join(here, '../../../site/src/content/docs')
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.md') ? [join(dir, e.name)] : [])
    let linkable = 0
    let resolved = 0
    for (const f of walk(docs)) {
      const [area, port] = relative(docs, f).split(/[\\/]/)
      const owner = ['ports', '_staged'].includes(area) && PORTS.some((entry) => entry === port) ? port : undefined
      for (const mention of proseMentions(readFileSync(f, 'utf8'), LABEL, () => owner)) {
        // Authored links already select a destination, which may be a protocol
        // object or external API. The name resolver does not own those labels.
        if (mention.linked) continue
        const { text, before } = mention
        const port = portFromSentence(before) ?? mention.port
        if (!port) continue
        if (!/^[A-Za-z_.][\w.]*(\s*\(|\.)/.test(text) && !/\(\)$/.test(text)) continue
        const res = r.resolve(port, text)
        if (res.how === 'not-a-symbol') continue
        linkable++
        if (!['ambiguous', 'no-symbol'].includes(res.how)) resolved++
      }
    }
    expect(linkable).toBeGreaterThan(200)
    // Floor, not a pin. 87% at the time of writing.
    expect(resolved / linkable).toBeGreaterThan(0.8)
  })
})

describe('mention paths by port', () => {
  const symbol = (id: string, name: string, kind: ApiSymbol['kind'], parent?: string): ApiSymbol => ({
    id, name, kind, parent, namespace: 'App', modifiers: [], signatures: [], source: { file: 'lib/app', line: 1 },
  })
  const resolver = new Resolver([
    { port: 'elixir', extractor: 'test', symbols: [symbol('App.Server', 'Server', 'struct'), symbol('App.Server.run/2', 'run/2', 'function', 'App.Server')] },
    { port: 'ts', extractor: 'test', symbols: [symbol('HTTP', 'HTTP', 'class')] },
  ] as ApiModel[], [], { elixir: 'App' })

  it('drops an Elixir type prefix and arity from a path', () => {
    expect(toPath('t:Server.t/0', 'elixir')).toEqual(['Server', 't'])
    expect(toPath('Server.run/2', 'elixir')).toEqual(['Server', 'run'])
    expect(resolver.resolve('elixir', 'Server.run/2')).toMatchObject({ symbol: { id: 'App.Server.run/2' } })
    expect(resolver.resolve('elixir', 'run/2')).toMatchObject({ symbol: { id: 'App.Server.run/2' } })
  })

  it('leaves a `/2` or `t:` in another port\'s mention alone', () => {
    expect(toPath('HTTP/2', 'ts')).toEqual(['HTTP/2'])
    expect(toPath('HTTP/2')).toEqual(['HTTP/2'])
    expect(toPath('t:Server', 'ts')).toEqual(['t', 'Server'])
    expect(resolver.resolve('ts', 'HTTP')).toMatchObject({ symbol: { id: 'HTTP' } })
    expect(resolver.resolve('ts', 'HTTP/2')).toEqual({ how: 'no-symbol' })
  })
})
