import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { readInventory } from '../src/inventory.ts'
import type { ApiModel, ApiSymbol } from '../src/model.ts'
import { Resolver, notASymbol, toPath } from '../src/resolver.ts'
import { decideMention, looksLikeApiMention, portFromSentence } from '../src/prose.ts'

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

  it('rejects a version placeholder, and keeps a real symbol', () => {
    for (const text of ['X.Y', 'X.Y.Z', 'vX.Y', 'X.Y-rcN', 'X.Y.Z-alphaN']) expect(notASymbol(text), text).toBe('a version placeholder')
    // Controls: a member of a type named X, a word in place of a number, and a candidate label without its number.
    for (const text of ['X.Name', 'Server.Y', 'X.Y-rc', 'X.Y-RcN', 'XY.Z']) expect(notASymbol(text), text).toBeUndefined()
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

  it('turns away Perl program names and CPAN modules, but not LibTmux modules', () => {
    for (const text of ['await.pl', 'async-lifecycle.pl']) expect(notASymbol(text, 'perl'), text).toBe('a filename')
    for (const text of ['Future::AsyncAwait', 'IO::Async']) expect(notASymbol(text, 'perl'), text).toBe('a module outside the LibTmux namespace')
    for (const text of ['LibTmux::Server', 'LibTmux::Async::Server']) expect(notASymbol(text, 'perl'), text).toBeUndefined()
    expect(notASymbol('Future::AsyncAwait', 'lisp')).toBeUndefined()
    expect(notASymbol('await.pl')).toBeUndefined()
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

  it('treats Sphinx inventory files as filenames, and leaves a similarly spelled member a symbol', () => {
    for (const text of ['objects.inv', 'objects-full.inv', 'reference/objects.inv']) expect(notASymbol(text), text).toBe('a filename')
    for (const text of ['pane.invoke', 'server.inventory', 'inv']) expect(notASymbol(text), text).toBeUndefined()
  })

  it('treats C, Lua and Ruby source files as filenames', () => {
    for (const text of ['options-table.c', 'tmux.h', 'lua/libtmux/init.lua', 'lib/libtmux.rb']) {
      expect(notASymbol(text)).toBe('a filename')
    }
    expect(notASymbol('pane.height')).toBeUndefined()
  })

  it('keeps OCaml filenames and numeric output labels out of API references', () => {
    for (const text of ['main.ml', 'json/libtmux_json.mli', 'libtmux.opam']) expect(notASymbol(text), text).toBe('a filename')
    for (const text of ['editor:2', 'logs:1']) expect(notASymbol(text), text).toBe('a numeric label')
    for (const text of ['Seq.filter', 'Enum.map/2', 'LibTmux.Session.new_window/1', 'Server:new_session']) {
      expect(notASymbol(text), text).toBeUndefined()
    }
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

describe('names the Perl, Clojure, Erlang and Lisp guides write in their own spellings', () => {
  const sym = (id: string, name: string, kind: ApiSymbol['kind'], parent?: string, extra: Partial<ApiSymbol> = {}): ApiSymbol => ({
    id, name, kind, parent, modifiers: [], signatures: [], source: { file: 'lib', line: 1 }, ...extra,
  })
  const model = (port: string, symbols: ApiSymbol[]) => ({ port, extractor: 'test', symbols }) as ApiModel
  const perl = model('perl', [
    sym('LibTmux::Selection', 'Selection', 'class'),
    sym('LibTmux::Selection::where', 'where', 'method', 'LibTmux::Selection'),
    sym('LibTmux::PaneSelection', 'PaneSelection', 'class'),
    sym('LibTmux::PaneSelection::where', 'where', 'method', 'LibTmux::PaneSelection', { inheritedFrom: 'LibTmux::Selection' }),
    sym('LibTmux::Server', 'Server', 'class'),
    sym('LibTmux::Server::capture_pane', 'capture_pane', 'method', 'LibTmux::Server'),
    sym('LibTmux::Server::execute', 'execute', 'method', 'LibTmux::Server'),
    sym('LibTmux::Server::count', 'count', 'method', 'LibTmux::Server'),
    sym('LibTmux::Snapshot', 'Snapshot', 'class'),
    sym('LibTmux::Snapshot::count', 'count', 'method', 'LibTmux::Snapshot'),
    sym('LibTmux::Async::Server', 'Server', 'class'),
    sym('LibTmux::Async::Server::capture_pane', 'capture_pane', 'method', 'LibTmux::Async::Server'),
    sym('LibTmux::Async::Server::execute', 'execute', 'method', 'LibTmux::Async::Server'),
    sym('LibTmux::Async::Server::close', 'close', 'method', 'LibTmux::Async::Server'),
    sym('LibTmux::Async::Transport', 'Transport', 'class'),
    sym('LibTmux::Async::Transport::execute', 'execute', 'method', 'LibTmux::Async::Transport'),
    sym('LibTmux::Async::Transport::close', 'close', 'method', 'LibTmux::Async::Transport'),
  ])
  // Python shapes its fields the same way, and keeps refusing the bare name.
  const py = model('py', [
    sym('libtmux.neo.Obj', 'Obj', 'class'),
    sym('libtmux.neo.Obj.pane_id', 'pane_id', 'attribute', 'libtmux.neo.Obj'),
    sym('libtmux.Pane', 'Pane', 'class'),
    sym('libtmux.Pane.pane_id', 'pane_id', 'attribute', 'libtmux.Pane', { inheritedFrom: 'libtmux.neo.Obj' }),
  ])
  const clojure = model('clojure', [
    sym('libtmux.data', 'libtmux.data', 'module', undefined, { namespace: 'libtmux.data' }),
    sym('libtmux.data/windows', 'windows', 'function', 'libtmux.data'),
    sym('libtmux.data/same-entity?', 'same-entity?', 'function', 'libtmux.data'),
    sym('libtmux.core', 'libtmux.core', 'module', undefined, { namespace: 'libtmux.core' }),
    sym('libtmux.core/snapshot!', 'snapshot!', 'function', 'libtmux.core'),
    sym('libtmux.extra.core', 'libtmux.extra.core', 'module', undefined, { namespace: 'libtmux.extra.core' }),
    sym('libtmux.extra.core/other', 'other', 'function', 'libtmux.extra.core'),
    sym('libtmux.other', 'libtmux.other', 'module', undefined, { namespace: 'libtmux.other' }),
    sym('libtmux.other/now', 'now', 'function', 'libtmux.other'),
  ])
  const erlang = model('erlang', [
    sym('tmux_query', 'tmux_query', 'module'),
    sym('tmux_query:pushdown/2', 'pushdown/2', 'function', 'tmux_query'),
    sym('tmux_select', 'tmux_select', 'module'),
    sym('tmux_select:to_list/1', 'to_list/1', 'function', 'tmux_select'),
    sym('tmux_hook:get/3', 'get/3', 'function', 'tmux_hook'),
    sym('tmux_option:get/3', 'get/3', 'function', 'tmux_option'),
  ])
  const lisp = model('lisp', [
    sym('libtmux:sessions', 'sessions', 'function'),
    sym('libtmux:window/function', 'window', 'function'),
    sym('libtmux:window/type', 'window', 'class'),
    sym('libtmux:pane', 'pane', 'class'),
  ])
  // The Eio and Unix clients define every operation twice, and the guides do not choose between them.
  const ocaml = model('ocaml', [
    sym('Libtmux_eio.Client.await', 'await', 'function', 'Libtmux_eio.Client'),
    sym('Libtmux_unix.Client.await', 'await', 'function', 'Libtmux_unix.Client'),
    sym('Libtmux_eio.Subscription.poll', 'poll', 'function', 'Libtmux_eio.Subscription'),
    sym('Libtmux_unix.Subscription.poll', 'poll', 'function', 'Libtmux_unix.Subscription'),
  ])
  const models = { perl, py, clojure, erlang, lisp, ocaml } as Record<string, ApiModel>
  const resolver = new Resolver(Object.values(models))
  const decide = (pagePort: string, text: string, before = '') => decideMention(text, { pagePort, before }, resolver, models)
  const linked = (pagePort: string, text: string, before = '') => {
    const decision = decide(pagePort, text, before)
    return decision.kind === 'link' ? decision.href : decision.kind
  }

  it('sends a Perl name to the declaration its subclasses inherit, and keeps two declarations apart', () => {
    expect(resolver.resolve('perl', 'where')).toMatchObject({ how: 'unique', symbol: { id: 'LibTmux::Selection::where' } })
    expect(linked('perl', 'where({...})')).toBe('/reference/perl/libtmux-selection-where/')
    // Controls: a receiver still reaches its own inherited copy, two declarations stay two, and Python's inherited field
    // keeps refusing because its bare name is also a tmux format token.
    expect(resolver.resolve('perl', 'PaneSelection->where')).toMatchObject({ how: 'scoped', symbol: { id: 'LibTmux::PaneSelection::where' } })
    expect(resolver.resolve('perl', 'count')).toEqual({ how: 'ambiguous', candidates: 2 })
    expect(resolver.resolve('py', 'pane_id')).toEqual({ how: 'ambiguous', candidates: 2 })
  })

  it('sends a Perl name to the original of an async mirror unless the sentence is about the mirror', () => {
    expect(linked('perl', 'capture_pane')).toBe('/reference/perl/libtmux-server-capture_pane/')
    expect(linked('perl', 'capture_pane', 'The async client returns a future from ')).toBe('skip')
    // Controls: a mirror with no original, and a name a mirror shares with a second, unrelated class.
    expect(resolver.resolve('perl', 'close').how).toBe('ambiguous')
    expect(resolver.resolve('perl', 'execute').how).toBe('ambiguous')
  })

  it('reads a Clojure predicate and an aliased var, and refuses an alias it cannot place', () => {
    expect(linked('clojure', 'same-entity?')).toBe('/reference/clojure/libtmux-data-same-entity/')
    expect(linked('clojure', 'data/same-entity?')).toBe('/reference/clojure/libtmux-data-same-entity/')
    expect(linked('clojure', 'data/windows')).toBe('/reference/clojure/libtmux-data-windows/')
    // Controls: two namespaces end in `core`, so the alias is not one; the namespace lacks the var; a Java static call.
    expect(decide('clojure', 'core/snapshot!').kind).not.toBe('link')
    expect(resolver.resolve('clojure', 'data/missing')).toEqual({ how: 'no-symbol' })
    expect(resolver.resolve('clojure', 'Instant/now')).not.toHaveProperty('symbol')
    expect(resolver.resolve('clojure', 'tm/windows')).not.toHaveProperty('symbol')
    // The spelling is a candidate for a Clojure page only.
    expect(looksLikeApiMention('data/windows', 'clojure')).toBe(true)
    expect(looksLikeApiMention('data/windows')).toBe(false)
    expect(looksLikeApiMention('same-entity?')).toBe(true)
  })

  it('reads an Erlang call by its arity, and a function written with its arity', () => {
    expect(linked('erlang', 'tmux_query:pushdown(true, Query)')).toBe('/reference/erlang/tmux_query-pushdown-2/')
    expect(linked('erlang', 'pushdown(false, Q)')).toBe('/reference/erlang/tmux_query-pushdown-2/')
    expect(linked('erlang', 'to_list/1')).toBe('/reference/erlang/tmux_select-to_list-1/')
    expect(linked('erlang', 'tmux_query:pushdown(#{a => [1, 2]}, Q)')).toBe('/reference/erlang/tmux_query-pushdown-2/')
    // Controls: the wrong arity, a call whose arguments cannot be counted, a name two modules share, another module's call,
    // and the arity spelling in a port that does not write it.
    expect(linked('erlang', 'tmux_query:pushdown(true)')).not.toContain('pushdown')
    expect(linked('erlang', 'tmux_query:pushdown(fun(X) -> X end, Q)')).not.toContain('pushdown')
    expect(linked('erlang', 'get/3')).not.toContain('get-3')
    expect(linked('erlang', 'maps:get(a, M, none)')).not.toContain('get-3')
    expect(looksLikeApiMention('to_list/1', 'ts')).toBe(false)
  })

  it('reads a Lisp call written as its accessor and object, and calls the function, not the type', () => {
    expect(linked('lisp', 'sessions snapshot')).toBe('/reference/lisp/libtmux-sessions/')
    expect(linked('lisp', 'window pane')).toBe('/reference/lisp/libtmux-window-function/')
    // Controls: a class is not called, a keyword argument is not an object, prose in code font names no function, and
    // two words are prose on a page of another port.
    expect(linked('lisp', 'pane window')).toBe('unresolved')
    expect(linked('lisp', 'new-window :index')).toBe('skip')
    expect(decide('lisp', 'go generate').kind).not.toBe('link')
    expect(linked('py', 'sessions snapshot')).toBe('skip')
  })

  it('leaves a name the Eio and Unix clients both define unlinked, because no sentence chooses a runtime', () => {
    for (const text of ['Client.await', 'poll']) expect(decide('ocaml', text).kind, text).toBe('skip')
    expect(resolver.resolve('ocaml', 'Libtmux_eio.Client.await')).toMatchObject({ how: 'module', symbol: { id: 'Libtmux_eio.Client.await' } })
  })
})
