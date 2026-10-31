import { describe, expect, it } from 'vitest'
import { API_MODEL_PORTS } from '../src/lib/ports'
import { formKind, isEnvironmentVariable, FORMS, isWithin, writtenForm, type FormSymbol } from '../src/lib/symbol-form'

/**
 * Each language writes a linked symbol the way its own documentation does. One example of each kind per language pins
 * the table: a type, a method, a standalone function, a property, an enum member, an environment variable and a
 * command. A language that fell back to the old rule, a call suffix on every method and function, fails at its row.
 */
type Declared = [label: string, shown: string, id: string, name?: string]
interface Row {
  type: [label: string, shown: string]
  method: Declared
  function: Declared
  property: Declared
  /** The owner, the member's name and id, and what a page writes away from the owner's page and on it. */
  member: [owner: string, name: string, id: string, away: string, home: string]
}

const ROWS: Record<string, Row> = {
  py: { type: ['libtmux::Server', 'libtmux.Server'], method: ['Server.list_sessions', 'Server.list_sessions()', 'libtmux.Server.list_sessions'], function: ['get_version', 'get_version()', 'libtmux.get_version'], property: ['Server.socket_name', 'Server.socket_name', 'libtmux.Server.socket_name'], member: ['Direction', 'UP', 'libtmux.Direction.UP', 'Direction.UP', 'Direction.UP'] },
  ts: { type: ['server.Server', 'server.Server'], method: ['Server.listSessions', 'Server.listSessions()', 'server.Server.listSessions'], function: ['parseWorkspace', 'parseWorkspace()', 'config.parseWorkspace'], property: ['Pane.id', 'Pane.id', 'pane.Pane.id'], member: ['Direction', 'Up', 'constants.Direction.Up', 'Direction.Up', 'Direction.Up'] },
  rs: { type: ['crate.Server', 'crate::Server'], method: ['Server.list_sessions', 'Server::list_sessions()', 'server.Server.list_sessions'], function: ['retry_until', 'retry_until()', 'test.retry_until'], property: ['Pane::id', 'Pane::id', 'pane.Pane.id'], member: ['Direction', 'Up', 'pane.Direction.Up', 'Direction::Up', 'Direction::Up'] },
  go: { type: ['tmux::Server', 'tmux.Server'], method: ['Server.ListSessions()', 'Server.ListSessions', 'tmux.Server.ListSessions'], function: ['NewServer', 'NewServer', 'tmux.NewServer'], property: ['ServerOptions.Socket', 'ServerOptions.Socket', 'tmux.ServerOptions.Socket'], member: ['Direction', 'DirectionUp', 'tmux.DirectionUp', 'tmux.DirectionUp', 'tmux.DirectionUp'] },
  java: { type: ['Delivery.Gap', 'Delivery.Gap'], method: ['Server#listSessions', 'Server#listSessions()', 'io.Server.Server.listSessions'], function: ['Util#parse', 'Util#parse()', 'io.Util.Util.parse'], property: ['Report#ERROR_LIMIT', 'Report#ERROR_LIMIT', 'io.Report.Report.ERROR_LIMIT'], member: ['Direction', 'UP', 'io.Direction.Direction.UP', 'Direction.UP', 'Direction.UP'] },
  csharp: { type: ['LibTmux::Server', 'LibTmux.Server'], method: ['Server.RunShellAsync', 'Server.RunShellAsync()', 'LibTmux.Server.RunShellAsync'], function: ['Parse', 'Parse()', 'LibTmux.Parse'], property: ['Server.SocketName', 'Server.SocketName', 'LibTmux.Server.SocketName'], member: ['Direction', 'Up', 'LibTmux.Direction.Up', 'Direction.Up', 'Direction.Up'] },
  cxx: { type: ['libtmux.Server', 'libtmux::Server'], method: ['Window::zoomed', 'Window::zoomed()', 'libtmux::Window::zoomed'], function: ['capture_lines', 'capture_lines()', 'libtmux::capture_lines'], property: ['Pane::kFields', 'Pane::kFields', 'libtmux::Pane::kFields'], member: ['Direction', 'up', 'libtmux::Direction::up', 'Direction::up', 'Direction::up'] },
  swift: { type: ['Server', 'Server'], method: ['Server/newSession(name:)', 'Server.newSession(name:)', 'Server.newSession(name:)', 'newSession(name:)'], function: ['makeServer', 'makeServer()', 'makeServer()', 'makeServer()'], property: ['Client/width', 'Client.width', 'Client.width'], member: ['Direction', 'up', 'Direction.up', 'Direction.up', '.up'] },
  kotlin: { type: ['Server', 'Server'], method: ['Server.newSession()', 'Server.newSession', 'io.Server.newSession'], function: ['withServer', 'withServer', 'io.withServer'], property: ['Pane.active', 'Pane.active', 'io.Pane.active'], member: ['Direction', 'Up', 'io.Direction.Up', 'Direction.Up', 'Direction.Up'] },
  scala: { type: ['direct.Server', 'direct.Server'], method: ['#layout()', '#layout', 'io.Window.layout'], function: ['using', 'using', 'io.using'], property: ['Session.server', 'Session.server', 'io.Session.server'], member: ['Direction', 'Up', 'io.Direction.Up', 'Direction.Up', 'Direction.Up'] },
  fsharp: { type: ['LibTmux::FSharp.Query', 'LibTmux.FSharp.Query'], method: ['Server.sessions()', 'Server.sessions', 'LibTmux.FSharp.Server.sessions'], function: ['Query.list', 'Query.list', 'LibTmux.FSharp.Query.list'], property: ['SplitSpec.Direction', 'SplitSpec.Direction', 'LibTmux.FSharp.SplitSpec.Direction'], member: ['Direction', 'Up', 'LibTmux.FSharp.Direction.Up', 'Direction.Up', 'Direction.Up'] },
  julia: { type: ['LibTmux::Snapshot', 'LibTmux.Snapshot'], method: ['Server.snapshot()', 'Server.snapshot', 'LibTmux.Server.snapshot'], function: ['cancel!', 'cancel!', 'LibTmux.cancel!'], property: ['Snapshot.acquired', 'Snapshot.acquired', 'LibTmux.Snapshot.acquired'], member: ['Direction', 'Up', 'LibTmux.Direction.Up', 'Up', 'Up'] },
  ruby: { type: ['LibTmux.Server', 'LibTmux::Server'], method: ['Server.list_sessions', 'Server#list_sessions', 'LibTmux::Server#list_sessions'], function: ['LibTmux#version', 'LibTmux.version', 'LibTmux.version'], property: ['Server.socket_name', 'Server#socket_name', 'LibTmux::Server#socket_name'], member: ['Direction', 'up', 'LibTmux::Direction.up', ':up', ':up'] },
  lua: { type: ['libtmux::Server', 'libtmux.Server'], method: ['Server.list_sessions', 'Server:list_sessions()', 'libtmux.Server:list_sessions'], function: ['libtmux:new', 'libtmux.new()', 'libtmux.new'], property: ['Server:socket', 'Server.socket', 'libtmux.Server.socket'], member: ['Direction', 'up', 'libtmux.Direction.up', '"up"', '"up"'] },
  elixir: { type: ['LibTmux.Format', 'LibTmux.Format'], method: ['LibTmux.Capture.fetch/2', 'LibTmux.Capture.fetch/2', 'LibTmux.Capture.fetch/2'], function: ['submit/3', 'submit/3', 'LibTmux.Control.submit/3'], property: ['LibTmux.Error.retryable', 'LibTmux.Error.retryable', 'LibTmux.Error.retryable'], member: ['Direction', 'up', 'LibTmux.Direction.up', ':up', ':up'] },
  powershell: { type: ['LibTmux.Server', 'LibTmux.Server'], method: ['Get-TmuxSession', 'Get-TmuxSession', 'LibTmux\\Get-TmuxSession'], function: ['Invoke-TmuxQuery', 'Invoke-TmuxQuery', 'LibTmux\\Invoke-TmuxQuery'], property: ['Server.Name', 'Server.Name', 'LibTmux.Server.Name'], member: ['Direction', 'Up', 'LibTmux.Direction.Up', 'Up', 'Up'] },
}

/** A declaration as the model holds it: its name is its id's last part, or what a row gives. */
const declared = (kind: FormSymbol['kind'], id: string, name = id.split(/::|[.#:\\]/).at(-1)!): FormSymbol => ({ id, kind, name })

describe('how a language writes a linked symbol', () => {
  it('has a row for every port and an entry in the table for each', () => {
    expect(Object.keys(ROWS).sort()).toEqual(API_MODEL_PORTS.map((port) => port.slug).sort())
    expect(Object.keys(FORMS).sort()).toEqual(Object.keys(ROWS).sort())
  })

  describe.each(Object.entries(ROWS))('%s', (lang, row) => {
    it('writes a type as its name, with the language\'s qualifier', () => {
      expect(writtenForm({ lang, kind: 'type', label: row.type[0], symbol: declared('class', row.type[0]) })).toBe(row.type[1])
    })

    it('writes a method as the language does', () => {
      const [label, shown, id, name] = row.method
      expect(writtenForm({ lang, kind: 'method', label, symbol: declared('method', id, name) })).toBe(shown)
    })

    it('writes a standalone function by the same rule', () => {
      const [label, shown, id, name] = row.function
      expect(writtenForm({ lang, kind: 'function', label, symbol: declared('function', id, name) })).toBe(shown)
    })

    it('never writes a property or a field as a call', () => {
      const [label, shown, id, name] = row.property
      // Elixir and PowerShell are left as written, parentheses and all.
      for (const written of FORMS[lang] === 'as-written' ? [label] : [label, `${label}()`]) {
        expect(writtenForm({ lang, kind: 'property', label: written, symbol: declared('property', id, name) }), written).toBe(shown)
      }
    })

    it('writes an enum member as the language does, away from its owner\'s page and on it', () => {
      const [owner, name, id, away, home] = row.member
      const input = { lang, kind: 'enum-member' as const, label: name, owner: { name: owner }, symbol: declared('constant', id, name) }
      expect(writtenForm({ ...input, onOwnerPage: false })).toBe(away)
      expect(writtenForm({ ...input, onOwnerPage: true })).toBe(home)
    })

    it('writes a real environment variable as a bare literal: the shell\'s `$` before its name goes', () => {
      expect(writtenForm({ lang, kind: 'environment', label: '$LIBTMUX_SOCKET' })).toBe('LIBTMUX_SOCKET')
      expect(writtenForm({ lang, kind: 'environment', label: '$TMUX_PANE' })).toBe('TMUX_PANE')
      // A placeholder that explains expansion, and the other shells' sigils, are syntax.
      for (const label of ['LIBTMUX_SOCKET', '$NAME', '$VAR', '$VARS', '${NAME}', '${TMUX}', '$env:TMUX', '%TMUX%', '$Server', '$ tmux list-keys', '$HOME/x', '$tmux']) {
        expect(writtenForm({ lang, kind: 'environment', label }), label).toBe(label)
      }
    })

    it('never writes a command as a call', () => {
      for (const label of ['new-session', 'monitor-activity', 'tmuxp load']) expect(writtenForm({ lang, kind: 'command', label }), label).toBe(label)
      expect(writtenForm({ lang, kind: 'command', label: 'new-session()' })).toBe('new-session')
    })
  })

  it('reads a method as a call in exactly Python, Java, C#, C++, TypeScript, Rust and Lua', () => {
    const called = Object.keys(ROWS).filter((lang) => /\(\)$/.test(writtenForm({ lang, kind: 'method', label: 'Server.run', symbol: declared('method', 'a.Server:run') })))
    expect(called.sort()).toEqual(['csharp', 'cxx', 'java', 'lua', 'py', 'rs', 'ts'])
  })

  it('reads a method with no parentheses in Ruby, Go, Kotlin, Scala, F# and Julia, even when its author wrote them', () => {
    for (const lang of ['ruby', 'go', 'kotlin', 'scala', 'fsharp', 'julia']) {
      expect(writtenForm({ lang, kind: 'method', label: 'Server.run()', symbol: declared('method', 'a.Server#run') }), lang).toBe(lang === 'ruby' ? 'Server#run' : 'Server.run')
      expect(writtenForm({ lang, kind: 'function', label: 'run()', symbol: declared('function', 'a.run') }), lang).toBe('run')
    }
  })

  it('leaves a label that says how it is invoked as written: arguments, an operator or a value', () => {
    expect(writtenForm({ lang: 'py', kind: 'method', label: 'Server.run(value)' })).toBe('Server.run(value)')
    expect(writtenForm({ lang: 'ts', kind: 'method', label: 'where({ active: true })' })).toBe('where({ active: true })')
    expect(writtenForm({ lang: 'scala', kind: 'method', label: '&&' })).toBe('&&')
    expect(writtenForm({ lang: 'scala', kind: 'method', label: 'unary_!' })).toBe('unary_!')
    expect(writtenForm({ lang: 'swift', kind: 'function', label: '==' })).toBe('==')
  })

  it('leaves a language the table does not know as written', () => {
    expect(writtenForm({ lang: undefined, kind: 'method', label: 'Server.run' })).toBe('Server.run')
    expect(writtenForm({ lang: 'cobol', kind: 'method', label: 'Server.run' })).toBe('Server.run')
  })

  describe('Ruby', () => {
    const instance = declared('method', 'LibTmux::Server#list_sessions')
    const singleton = declared('method', 'LibTmux::Server.find')

    it('writes an instance method with a hash and a class method with a dot, whichever the author wrote', () => {
      for (const label of ['Server#list_sessions', 'Server.list_sessions', 'Server::list_sessions']) {
        expect(writtenForm({ lang: 'ruby', kind: 'method', label, symbol: instance }), label).toBe('Server#list_sessions')
      }
      for (const label of ['Server#find', 'Server.find', 'Server::find']) {
        expect(writtenForm({ lang: 'ruby', kind: 'method', label, symbol: singleton }), label).toBe('Server.find')
      }
    })

    it('keeps the form a page writes on its owner\'s page: `#list_sessions`', () => {
      expect(writtenForm({ lang: 'ruby', kind: 'method', label: '#list_sessions', symbol: instance })).toBe('#list_sessions')
      expect(writtenForm({ lang: 'ruby', kind: 'method', label: '.list_sessions', symbol: instance })).toBe('#list_sessions')
      expect(writtenForm({ lang: 'ruby', kind: 'method', label: '#find', symbol: singleton })).toBe('.find')
      expect(writtenForm({ lang: 'ruby', kind: 'method', label: 'list_sessions', symbol: instance })).toBe('list_sessions')
    })

    it('writes an attribute reader as a property with a hash', () => {
      expect(writtenForm({ lang: 'ruby', kind: 'property', label: '#socket_name', symbol: declared('property', 'LibTmux::Server#socket_name') })).toBe('#socket_name')
    })
  })

  describe('Swift', () => {
    const named = (id: string, name: string) => declared('method', id, name)

    it('writes the DocC full name, which carries its argument labels', () => {
      expect(writtenForm({ lang: 'swift', kind: 'method', label: 'listSessions', symbol: named('Server.listSessions()', 'listSessions()') })).toBe('listSessions()')
      expect(writtenForm({ lang: 'swift', kind: 'method', label: 'Server/clients()', symbol: named('Server.clients()', 'clients()') })).toBe('Server.clients()')
      expect(writtenForm({ lang: 'swift', kind: 'method', label: 'newSession', symbol: named('Server.newSession(name:)', 'newSession(name:)') })).toBe('newSession(name:)')
    })

    it('keeps the labels an author wrote, though the link resolves to the overload with more of them', () => {
      expect(writtenForm({ lang: 'swift', kind: 'method', label: 'split(_:direction:)', symbol: named('Server.split(_:direction:size:)', 'split(_:direction:size:)') })).toBe('split(_:direction:)')
    })

    it('keeps the owner of a case the model gives none: from the path the label spells, else from the id', () => {
      const below = declared('constant', 'PaneDirection.below', 'below')
      expect(writtenForm({ lang: 'swift', kind: 'enum-member', label: 'PaneDirection/below', symbol: below })).toBe('PaneDirection.below')
      expect(writtenForm({ lang: 'swift', kind: 'enum-member', label: 'below', symbol: below })).toBe('PaneDirection.below')
      expect(writtenForm({ lang: 'swift', kind: 'enum-member', label: 'below', symbol: declared('constant', 'OutputWait.Outcome.below', 'below') })).toBe('Outcome.below')
      expect(writtenForm({ lang: 'swift', kind: 'enum-member', label: 'PaneDirection/below', symbol: below, onOwnerPage: true })).toBe('.below')
      // A case with no owner anywhere has nothing to qualify it.
      expect(writtenForm({ lang: 'swift', kind: 'enum-member', label: 'below', symbol: declared('constant', 'below', 'below') })).toBe('.below')
    })

    it('qualifies a case away from its owner and drops the owner on its page', () => {
      const input = { lang: 'swift', kind: 'enum-member' as const, label: 'PaneDirection/below', owner: { name: 'PaneDirection' }, symbol: declared('constant', 'PaneDirection.below', 'below') }
      expect(writtenForm(input)).toBe('PaneDirection.below')
      expect(writtenForm({ ...input, onOwnerPage: true })).toBe('.below')
    })
  })

  describe('Java and Scala', () => {
    it('keep the join their documentation tools write before a member: `Pane#capture()` and `Window#layout`', () => {
      expect(writtenForm({ lang: 'java', kind: 'method', label: 'ilt.Server#control', symbol: declared('method', 'ilt.Server.control') })).toBe('ilt.Server#control()')
      expect(writtenForm({ lang: 'scala', kind: 'method', label: 'Window#layout()', symbol: declared('method', 'a.Window.layout') })).toBe('Window#layout')
      expect(writtenForm({ lang: 'scala', kind: 'method', label: 'Window.layout', symbol: declared('method', 'a.Window.layout') })).toBe('Window.layout')
    })
  })

  describe('an environment variable', () => {
    it('is a real one by its name: tmux\'s, the shell\'s, the XDG and locale families and this library\'s', () => {
      for (const label of ['$TMUX', '$TMUX_PANE', '$TMUX_TMPDIR', '$TMPDIR', '$HOME', '$SHELL', '$TERM', '$PATH', '$PWD', '$USER', '$LANG', '$LC_ALL', '$XDG_RUNTIME_DIR', '$LIBTMUX_SOCKET', '$TMUX_ANYTHING']) {
        expect(isEnvironmentVariable(label), label).toBe(true)
      }
    })

    it('is not a placeholder, a name in another form or a name of something else', () => {
      for (const label of ['$NAME', '$VAR', '$VARS', '$A1', 'TMUX', '$tmux', '$Server', '$1', '$', '$ TMUX', '$TMUX x', '${TMUX}', '$env:TMUX', '$LCX', '$XDG', '$LIBTMUX']) {
        expect(isEnvironmentVariable(label), label).toBe(false)
      }
    })
  })

  describe('Go', () => {
    it('writes a constant with its package, and leaves one that already has it', () => {
      const symbol = declared('constant', 'tmux.DirectionUp')
      expect(writtenForm({ lang: 'go', kind: 'enum-member', label: 'DirectionUp', symbol })).toBe('tmux.DirectionUp')
      expect(writtenForm({ lang: 'go', kind: 'enum-member', label: 'tmux.DirectionUp', symbol })).toBe('tmux.DirectionUp')
    })
  })

  describe('a member among its owner\'s members', () => {
    it('takes no qualifier in a chip on the owner\'s page', () => {
      const input = { lang: 'ts', kind: 'enum-member' as const, label: 'Up', owner: { name: 'Direction' }, symbol: declared('constant', 'a.Direction.Up'), chip: true }
      expect(writtenForm({ ...input, onOwnerPage: true })).toBe('Up')
      expect(writtenForm({ ...input, onOwnerPage: false })).toBe('Direction.Up')
    })
  })

  describe('what a declaration is', () => {
    it('reads a constant as an enum member only in an enum, or in Go where a package constant is one', () => {
      expect(formKind('rs', { kind: 'constant' }, { kind: 'enum' })).toBe('enum-member')
      expect(formKind('rs', { kind: 'constant' }, { kind: 'class' })).toBe('property')
      expect(formKind('py', { kind: 'constant' })).toBe('property')
      expect(formKind('go', { kind: 'constant' })).toBe('enum-member')
      expect(formKind('swift', { kind: 'property' }, { kind: 'enum' })).toBe('property')
      expect((['class', 'module', 'typealias', 'exception'] as const).map((kind) => formKind('java', { kind }))).toEqual(Array(4).fill('type'))
      expect([formKind('java', { kind: 'method' }), formKind('java', { kind: 'function' })]).toEqual(['method', 'function'])
    })

    it('walks outward to tell the owner\'s page from another', () => {
      const scopes: Record<string, { id: string; parent?: string }> = { 'a.Server': { id: 'a.Server' }, 'a.Server.run': { id: 'a.Server.run', parent: 'a.Server' } }
      const parentOf = (scope: { parent?: string }) => scope.parent ? scopes[scope.parent] : undefined
      expect(isWithin(scopes['a.Server.run'], scopes['a.Server'], parentOf)).toBe(true)
      expect(isWithin(scopes['a.Server'], scopes['a.Server'], parentOf)).toBe(true)
      expect(isWithin(scopes['a.Server'], scopes['a.Server.run'], parentOf)).toBe(false)
      expect(isWithin(undefined, scopes['a.Server'], parentOf)).toBe(false)
    })
  })
})
