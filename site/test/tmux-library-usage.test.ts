import { readFileSync } from 'node:fs'
import { experimental_AstroContainer } from 'astro/container'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { documentProblems, isPrivateSymbol, publicSymbols, viaRevisionFor } from '../../scripts/gen-tmux-usage.mjs'
import { API_MODELS } from '../src/lib/api-models'
import { PORTS } from '../src/lib/ports'
import { symbolMarkdown } from '../src/lib/symbol-markdown'
import { TMUX_MANUALS, tmuxApiLinks, tmuxCommandsFor, tmuxLibrarySection, tmuxManualHeadings, tmuxManualUrl } from '../src/lib/tmux-manual-data'
import { TMUX_USAGE, isListed, namesCommand, tmuxScopes, tmuxUsage, tmuxUsageOf, type UsageUse } from '../src/lib/tmux-library-usage'
import {
  tmuxCommandRows, tmuxCommandSources, tmuxReferenceContext, tmuxReferenceIndex, tmuxReferenceUrl, tmuxResolvedUsage, tmuxSourceModel, tmuxSymbolSends,
} from '../src/lib/tmux-reference'
import { loadAstroTemplate, renderAstroTemplate, withoutScope } from './astro-templates'

vi.mock('astro:content', () => ({ getCollection: async () => [] }))

const windows: Window[] = []
afterEach(async () => { for (const win of windows.splice(0)) await win.happyDOM.abort() })
const dom = (html: string) => {
  const win = new Window()
  windows.push(win)
  win.document.body.innerHTML = html
  return win.document
}

const scopeTable = JSON.parse(readFileSync(new URL('../src/data/tmux-usage/scopes.json', import.meta.url), 'utf8'))
const usage = tmuxUsage('list-panes')!
/** What a port lists at one scope of list-panes. */
const cell = (scope: string, port: string) => usage.groups.find((group) => group.scope?.id === scope)!.ports.find((entry) => entry.port === port)?.links.map((link) => link.label)

describe('the recorded usage', () => {
  /** Every command either pinned manual documents. */
  const manualCommands = [...new Set(Object.values(TMUX_MANUALS).flatMap((manual) => manual.commands.map((command) => command.name)))].sort()

  const forwarders = JSON.parse(readFileSync(new URL('../../scripts/tmux-usage/forwarders.json', import.meta.url), 'utf8')).forwarders
  const viaRevision = (slug: string) => viaRevisionFor(API_MODELS[slug], forwarders[slug] && API_MODELS[forwarders[slug].parent])

  it.each(PORTS.map((port) => port.slug))('is bound to the pinned API model of %s', (slug) => {
    expect(documentProblems(TMUX_USAGE[slug], API_MODELS[slug], scopeTable, manualCommands, viaRevision(slug))).toEqual([])
  })

  it('reads the core lines of a wrapper where the wrapper is pinned when both live in one repository', () => {
    // F# is pinned at a revision older than the C# model, and cites the C# lines as they read there.
    expect(API_MODELS.fsharp.revision).not.toBe(API_MODELS.csharp.revision)
    expect(viaRevision('fsharp')).toBe(API_MODELS.fsharp.revision)
    // PowerShell lives in its own repository and depends on the C# release, so it cites that release's lines.
    expect(viaRevision('powershell')).toBe(API_MODELS.csharp.revision)
    expect(viaRevision('kotlin')).toBe(API_MODELS.kotlin.revision)
    expect(viaRevision('py')).toBeUndefined()
    for (const [symbol, uses] of Object.entries(TMUX_USAGE.fsharp.symbols)) {
      for (const use of uses) if (use.via) expect(use.via.revision, `${symbol} ${use.command}`).toBe(API_MODELS.fsharp.revision)
    }
  })

  it('refuses a via that cites core lines at a revision other than the one they must be read at', () => {
    const document = TMUX_USAGE.fsharp
    const [symbol, uses] = Object.entries(document.symbols).find(([, list]) => list.some((use) => use.via))!
    const moved = (revision: string | undefined) => ({
      ...document, symbols: { ...document.symbols, [symbol]: uses.map((use) => (use.via ? { ...use, via: { ...use.via, revision } } : use)) },
    })
    expect(documentProblems(moved(API_MODELS.csharp.revision), API_MODELS.fsharp, scopeTable, manualCommands, viaRevision('fsharp')).join('\n'))
      .toMatch(new RegExp(`cites csharp lines at ${API_MODELS.csharp.revision}, which must be ${API_MODELS.fsharp.revision}`))
    expect(documentProblems(moved(undefined), API_MODELS.fsharp, scopeTable, manualCommands, viaRevision('fsharp')).join('\n')).toMatch(/at no revision/)
    // The control: the document as committed.
    expect(documentProblems(document, API_MODELS.fsharp, scopeTable, manualCommands, viaRevision('fsharp'))).toEqual([])
  })

  it('records public API only: a private helper is neither read from the model nor accepted in a document', () => {
    const model = {
      ...API_MODELS.py,
      symbols: [
        ...API_MODELS.py.symbols,
        { id: 'libtmux.Server._show_option', name: '_show_option', kind: 'method', modifiers: [], parent: 'libtmux.Server', source: { file: 'src/libtmux/server.py', line: 1 } },
        { id: 'libtmux.Server.__repr__', name: '__repr__', kind: 'method', modifiers: [], parent: 'libtmux.Server', source: { file: 'src/libtmux/server.py', line: 2 } },
        { id: 'libtmux.Server.hidden', name: 'hidden', kind: 'method', modifiers: ['private'], parent: 'libtmux.Server', source: { file: 'src/libtmux/server.py', line: 3 } },
        { id: 'libtmux._internal.control_mode.ControlMode.__enter__', name: '__enter__', kind: 'method', modifiers: [], parent: 'libtmux._internal.control_mode.ControlMode', source: { file: 'src/libtmux/_internal/control_mode.py', line: 4 } },
      ],
    }
    const names = publicSymbols(model).map((symbol: { id: string }) => symbol.id)
    expect(names).not.toContain('libtmux.Server._show_option')
    expect(names).not.toContain('libtmux.Server.hidden')
    // A method of a private module is private, whatever its own name.
    expect(names).not.toContain('libtmux._internal.control_mode.ControlMode.__enter__')
    // A dunder is the language's protocol, not a helper.
    expect(names).toContain('libtmux.Server.__repr__')
    expect(isPrivateSymbol({ name: '_x', id: 'libtmux.Server._x' })).toBe(true)
    expect(isPrivateSymbol({ name: '__init__', id: 'libtmux.Server.__init__' })).toBe(false)
    expect(isPrivateSymbol({ name: '__enter__', id: 'libtmux._internal.control_mode.ControlMode.__enter__' })).toBe(true)
    expect(isPrivateSymbol({ name: 'x', id: 'libtmux.Server.x', apiScope: 'internal' })).toBe(true)
    const document = { ...TMUX_USAGE.py, symbols: { ...TMUX_USAGE.py.symbols, 'libtmux.Server._show_option': [{ command: 'show-options', scope: null, evidence: ['a.py:1'] }] } }
    expect(documentProblems(document, model, scopeTable, manualCommands)).toEqual(['libtmux.Server._show_option: is private, and only public API is recorded'])
    // None of the committed documents records a private symbol.
    for (const slug of PORTS.map((port) => port.slug)) {
      const privates = API_MODELS[slug].symbols.filter(isPrivateSymbol).map((symbol: { publicId?: string; id: string }) => symbol.publicId ?? symbol.id)
      expect(Object.keys(TMUX_USAGE[slug].symbols).filter((id) => privates.includes(id)), slug).toEqual([])
    }
  })

  it('records every command of the manual, for every port', () => {
    expect(manualCommands).toContain('list-panes')
    expect(manualCommands).toContain('set-window-option')
    for (const slug of PORTS.map((port) => port.slug)) expect(TMUX_USAGE[slug].commands, slug).toEqual(manualCommands)
  })

  it('refuses a document that records fewer commands than the manual, or one the model does not have', () => {
    const document = TMUX_USAGE.py
    expect(documentProblems({ ...document, commands: ['list-panes'] }, API_MODELS.py, scopeTable, manualCommands, undefined)).toEqual([expect.stringMatching(/^covers \["list-panes"\]/)])
    expect(documentProblems({ ...document, revision: 'stale' }, API_MODELS.py, scopeTable, manualCommands)).toEqual([expect.stringMatching(/^records stale/)])
    const bogus = { ...document, symbols: { ...document.symbols, 'libtmux.Server.nope': [{ command: 'kill-pane', scope: null, evidence: ['a.py:1'] }] } }
    expect(documentProblems(bogus, API_MODELS.py, scopeTable, manualCommands)).toEqual(['libtmux.Server.nope: not a symbol of the API model'])
    const unscoped = { ...document, symbols: { ...document.symbols, 'libtmux.Server.panes': [{ command: 'list-panes', scope: null, evidence: ['a.py:1'] }] } }
    expect(documentProblems(unscoped, API_MODELS.py, scopeTable, manualCommands)).toEqual(['libtmux.Server.panes: null is not a scope of list-panes'])
  })

  it('names the methods that send list-panes at each scope, where the ports differ in design', () => {
    expect(cell('server', 'swift')).toEqual(['Server.panes()', 'Server.panes(where:)'])
    expect(cell('server', 'py')).toEqual(['Server.panes', 'Server.search_panes'])
    expect(cell('session', 'py')).toEqual(['Session.panes', 'Session.search_panes'])
    expect(cell('window', 'cxx')).toEqual(['Window::panes'])
    // Ruby's Async scope inherits the core server's methods, so both handles are listed, told apart by their namespace.
    expect(cell('server', 'ruby')).toEqual(expect.arrayContaining(['Async::Server#list_panes', 'LibTmux::Server#list_panes']))
    expect(cell('session', 'ruby')).toEqual(['Session#list_panes'])
    expect(cell('window', 'go')).toEqual(['Window.SearchPanes'])
    // A snapshot-based port sends the command in its snapshot call.
    expect(cell('server', 'ts')).toEqual(['Server.snapshot'])
    expect(cell('server', 'lua')).toEqual(['Server:snapshot'])
    // A wrapper stands on the library it calls.
    expect(cell('server', 'powershell')).toEqual(['Get-TmuxPane'])
    expect(cell('window', 'powershell')).toEqual(['Get-TmuxPane'])
  })

  it('leaves out a method that reads a capture instead of sending the command', () => {
    // Go documents Session.Panes and Window.Panes as never querying tmux; the search methods send it.
    expect(cell('session', 'go')).toEqual(['Session.SearchPanes'])
    expect(cell('window', 'go')).not.toContain('Window.Panes')
    // TypeScript and Swift read sessions and windows from a captured snapshot.
    expect(cell('session', 'ts')).toBeUndefined()
    expect(cell('window', 'ts')).toBeUndefined()
    expect(cell('session', 'swift')).toBeUndefined()
    // Kotlin and Scala wrap Java, which sends at the server only: their session and window readers send nothing.
    for (const port of ['java', 'kotlin', 'scala']) {
      for (const scope of ['session', 'window']) expect(cell(scope, port), `${port} ${scope}`).toBeUndefined()
    }
  })

  it('credits a wrapper with the core method it calls, at the scope that method sends', () => {
    expect(cell('server', 'java')).toEqual(['Server.paneFields', 'Server.panes', 'Server.snapshot'])
    expect(cell('server', 'kotlin')).toEqual(['Server.paneFields', 'Server.panes', 'Server.snapshot'])
    // Scala has two handles to one server, and the cell tells them apart.
    expect(cell('server', 'scala')).toEqual(expect.arrayContaining(['cats.Server.panes', 'scaladsl.Server.panes']))
    // F# builds a session and then lists the panes of the session it made, and not of the server.
    expect(cell('session', 'fsharp')).toEqual(['newSession'])
    // tryFindPane reads one pane by id through Server.FindPaneAsync, which lists below tmux 3.3 and asks display-message
    // from there, and the F# revision supports 3.2a: neither command holds on every release, so none is recorded.
    expect(cell('server', 'fsharp')).toBeUndefined()
    expect(tmuxUsageOf('fsharp', 'LibTmux.FSharp.Server.tryFindPane')).toEqual([])
    const kotlin = tmuxUsageOf('kotlin', 'io.github.libtmux.kotlin.Server.panes')
    expect(kotlin.find((entry) => entry.command === 'list-panes')!.scopes[0]).toMatchObject({
      via: { port: 'java', symbol: 'io.github.libtmux.Server.Server.panes', evidence: ['libtmux/src/main/java/io/github/libtmux/Server.java:998'] },
    })
  })

  it('lists a lookup by the command it sends, and not by the list name it passes to choose a format', () => {
    const labels = (port: string, command: string) => tmuxUsage(command)!.groups.flatMap((group) => group.ports.filter((entry) => entry.port === port).flatMap((entry) => entry.links.map((link) => link.label)))
    // The 3.3a floor of this revision drops the fallback that listed with -a, so every supported release asks display-message.
    expect(labels('csharp', 'display-message')).toEqual(expect.arrayContaining(['Server.FindPaneAsync', 'Server.GetPaneAsync', 'Server.FindWindowAsync', 'Server.FindSessionAsync']))
    for (const name of ['Server.FindPaneAsync', 'Server.GetWindowAsync', 'Server.FindSessionAsync', 'Session.RefreshAsync']) {
      for (const command of ['list-panes', 'list-windows', 'list-sessions']) expect(labels('csharp', command), `${name} ${command}`).not.toContain(name)
    }
  })

  it('lists the object that owns the scope before a method that sends the command for its own purpose', () => {
    expect(cell('window', 'py')).toEqual(['Window.panes', 'Window.search_panes', 'Pane.from_pane_id'])
    expect(cell('session', 'rs')).toEqual(['Session.panes', 'ControlSender.watch_only'])
  })

  it('lists the ports in the order the site lists them', () => {
    const order = PORTS.map((port) => port.slug)
    for (const group of usage.groups) {
      const slugs = group.ports.map((entry) => entry.port)
      expect(slugs).toEqual(order.filter((slug) => slugs.includes(slug)))
    }
  })

  it('keeps a call through a helper with the method and off the command pages', () => {
    const go = tmuxUsageOf('go', 'tmux.Pane.Select').filter((entry) => entry.command === 'list-panes')
    expect(go).toHaveLength(1)
    expect(go[0].scopes[0]).toMatchObject({ hops: 1, evidence: ['tmux/lookup.go:371', 'tmux/window_pane_topology.go:199'] })
    expect(usage.groups.flatMap((group) => group.ports).flatMap((entry) => entry.links).map((link) => link.symbolId)).not.toContain('tmux.Pane.Select')
  })

  it('links every method to its own page', () => {
    for (const link of usage.groups.flatMap((group) => group.ports).flatMap((entry) => entry.links)) {
      expect(link.href).toMatch(new RegExp(`/${link.port}/[^/]+/reference/[^/]+/$`))
      expect(link.evidence[0]).toMatch(/^[^:]+:\d+$/)
    }
  })

  it('has no usage for a command it has not recorded', () => {
    expect(tmuxUsage('no-such-command')).toBeUndefined()
    expect(tmuxScopes('no-such-command')).toEqual([])
    expect(tmuxUsageOf('py', 'libtmux.Pane.nope')).toEqual([])
    // A command with no scope helpers has one table with no scope heading.
    expect(tmuxUsage('kill-pane')!.groups.map((group) => group.scope)).toEqual([undefined])
  })
})

describe('which sends through a helper are listed', () => {
  const use = (over: Partial<UsageUse> = {}): UsageUse => ({ command: 'send-keys', scope: null, evidence: ['a.ts:1', 'b.ts:2'], ...over })

  it('lists a method whose own name carries the verb of the command, and not one that refreshes afterwards', () => {
    expect(namesCommand('send-keys', 'sendKeysAsync')).toBe(true)
    expect(namesCommand('send-keys', 'Send-TmuxText')).toBe(true)
    expect(namesCommand('list-panes', 'GetPanesAsync')).toBe(true)
    expect(namesCommand('new-window', 'createWindow')).toBe(true)
    expect(namesCommand('kill-server', 'close')).toBe(true)
    // The controls: a method that sends the command only to refresh what it changed, or to look something up.
    expect(namesCommand('list-panes', 'sendKeys')).toBe(false)
    expect(namesCommand('list-panes', 'splitPane')).toBe(false)
    expect(namesCommand('send-keys', 'select')).toBe(false)
  })

  it('applies to a call through a helper only: a direct send and a reviewed claim are listed, whatever the name', () => {
    expect(isListed(use({ evidence: ['a.ts:1'] }), 'unrelated')).toBe(true)
    expect(isListed(use({ reviewed: true }), 'unrelated')).toBe(true)
    expect(isListed(use(), 'unrelated')).toBe(false)
    expect(isListed(use(), 'Pane.sendKeys')).toBe(true)
    // Swift ids carry argument labels, which hold colons of their own.
    expect(isListed(use({ command: 'capture-pane' }), 'Server.capture(_:includingHistory:)')).toBe(true)
    expect(isListed(use({ command: 'list-panes' }), 'Server.sendKeys(_:to:literally:)')).toBe(false)
    // A wrapper is listed by its own name or the core method's, and by a reviewed core entry.
    const wrapped = (over: Partial<NonNullable<UsageUse['via']>> = {}) => use({ evidence: ['w.kt:5'], via: { port: 'java', symbol: 'core.Pane.sendKeys', evidence: ['A.java:1', 'A.java:2'], ...over } })
    expect(isListed(wrapped(), 'wrapper.Pane.run')).toBe(true)
    expect(isListed(wrapped({ symbol: 'core.Pane.run' }), 'wrapper.Pane.run')).toBe(false)
    expect(isListed(wrapped({ symbol: 'core.Pane.run', reviewed: true }), 'wrapper.Pane.run')).toBe(true)
    expect(isListed(wrapped({ symbol: 'core.Pane.run', evidence: ['A.java:1'] }), 'wrapper.Pane.run')).toBe(true)
  })

  it('puts the methods that send through a helper on the page of their own command, and not a lookup they make on the way', () => {
    const labels = (command: string, port: string) => tmuxUsage(command)!.groups.flatMap((group) => group.ports).filter((entry) => entry.port === port).flatMap((entry) => entry.links.map((link) => link.label))
    expect(labels('send-keys', 'go')).toEqual(expect.arrayContaining(['Pane.SendKeys']))
    expect(labels('send-keys', 'csharp')).toContain('Pane.SendKeysAsync')
    expect(labels('send-keys', 'ts')).toContain('Pane.sendKeys')
    // Go's Pane.Select looks panes up with list-panes first; that stays on its own page.
    expect(labels('list-panes', 'go')).not.toContain('Pane.Select')
    expect(labels('select-pane', 'go')).toContain('Pane.Select')
  })

  it('tells two methods of one language that share a name apart, and names a member by whole segments', () => {
    const labels = (command: string, port: string) => tmuxUsage(command)!.groups.flatMap((group) => group.ports).filter((entry) => entry.port === port).flatMap((entry) => entry.links.map((link) => link.label))
    expect(labels('new-session', 'ruby')).toEqual(['Async::Server#new_session', 'LibTmux::Server#new_session'])
    // `Pane` ends `NewPane`, but the owner is the whole segment before it.
    expect(labels('new-pane', 'go')).toContain('Pane.NewPane')
    expect(labels('new-pane', 'go')).not.toContain('Pane')
  })
})

describe('from a method to the command and its C function', () => {
  it('names the scope and links the manual page and the C function behind it', () => {
    const [send] = tmuxSymbolSends('swift', 'Server.panes()')
    expect(send.command).toBe('list-panes')
    expect(send.manualHref).toBe(tmuxManualUrl('latest', 'list-panes'))
    expect(send.scopes.map((use) => [use.scope?.id, use.function?.name, use.function?.href])).toEqual([
      ['server', 'cmd_list_panes_server', '/tmux/latest/reference/c-function-cmd-list-panes-c-cmd_list_panes_server/'],
    ])
  })

  it('gives a cmdlet that lists at three scopes one row with all three', () => {
    const [send] = tmuxSymbolSends('powershell', 'LibTmux\\Get-TmuxPane')
    expect(send.scopes.map((use) => use.scope?.id)).toEqual(['server', 'session', 'window'])
    expect(send.scopes.every((use) => use.via?.port === 'csharp')).toBe(true)
  })

  it('does not link a method that only reads a capture, whatever the concepts call it equivalent to', () => {
    // The concept map names Window.Panes the Go equivalent of list-panes.
    expect(tmuxSymbolSends('go', 'tmux.Window.Panes')).toEqual([])
    expect(tmuxCommandsFor('go', 'tmux.Window.Panes').map((command) => command.name)).not.toContain('list-panes')
    expect(tmuxCommandsFor('ts', 'window.Window.panes').map((command) => command.name)).not.toContain('list-panes')
    // A recorded command is linked by what the code sends, not by the concept map: TypeScript's capture reaches capture-pane through a helper.
    expect(tmuxCommandsFor('ts', 'pane.Pane.capture')).toEqual([])
    expect(tmuxSymbolSends('ts', 'pane.Pane.capture').map((send) => [send.command, send.scopes[0].listed])).toEqual([['capture-pane', true]])
    // Its send-keys is another command's helper: the method sends nothing of the kind, and nothing says so.
    expect(tmuxSymbolSends('ts', 'pane.Pane.enterCopyMode').map((send) => [send.command, send.scopes[0].listed])).toEqual([['copy-mode', true], ['send-keys', false]])
  })

  it('names what the method sends before its equivalents, and what it sends through a helper last', () => {
    const plain = [{ name: 'capture-pane', href: tmuxManualUrl('latest', 'capture-pane') }]
    // Java's sendKeys sends send-keys through a helper and is named for it, so it leads; the list-panes lookup it makes on the way is last.
    const rows = tmuxCommandRows(tmuxSymbolSends('java', 'io.github.libtmux.Pane.Pane.sendKeys'), plain)
    expect(rows.map((row) => row.command)).toEqual(['send-keys', 'capture-pane', 'list-panes'])
    expect(tmuxCommandRows(tmuxSymbolSends('py', 'libtmux.Server.panes'), [{ name: 'send-keys', href: '/x/' }]).map((row) => row.command)).toEqual(['list-panes', 'send-keys'])
    expect(tmuxCommandRows([], plain).map((row) => row.scopes)).toEqual([[]])
    // A command the symbol is recorded as sending is not named twice.
    expect(tmuxCommandRows(tmuxSymbolSends('py', 'libtmux.Server.panes'), [{ name: 'list-panes', href: '/x/' }]).map((row) => row.command)).toEqual(['list-panes'])
  })

  it('lists the call through a helper with the method it belongs to', () => {
    const [send] = tmuxSymbolSends('go', 'tmux.Pane.Select')
    expect(send.scopes[0]).toMatchObject({ hops: 1, function: { name: 'cmd_list_panes_window' } })
  })
})

describe.each(['3.7c', '3.2a'])('the C pages of tmux %s', (version) => {
  const model = tmuxSourceModel(version)
  const symbolNamed = (name: string) => model.symbols.find((symbol) => symbol.name === name)!
  const pagesOf = (name: string) => tmuxReferenceContext(version, symbolNamed(name))

  it.each(['cmd_list_panes_entry', 'cmd_list_panes_exec'])('lists every scope on %s', (name) => {
    const context = pagesOf(name)
    expect(context.manualLinks.map((link) => link.name)).toEqual(['list-panes'])
    expect(context.usage).toHaveLength(1)
    expect(context.usage[0].groups.map((group) => [group.scope?.id, group.function?.name])).toEqual([
      ['server', 'cmd_list_panes_server'], ['session', 'cmd_list_panes_session'], ['window', 'cmd_list_panes_window'],
    ])
    expect(context.usage[0].groups.map((group) => group.function?.href)).toEqual(
      ['server', 'session', 'window'].map((scope) => tmuxReferenceUrl(version, symbolNamed(`cmd_list_panes_${scope}`))),
    )
  })

  it.each(['server', 'session', 'window'])('lists only the %s scope on its function', (scope) => {
    const context = pagesOf(`cmd_list_panes_${scope}`)
    expect(context.manualLinks.map((link) => link.name)).toEqual(['list-panes'])
    expect(context.usage[0].groups.map((group) => group.scope?.id)).toEqual([scope])
    const symbolIds = context.usage[0].groups[0].ports.flatMap((entry) => entry.links.map((link) => link.symbolId))
    expect(symbolIds).toContain({ server: 'libtmux.Server.panes', session: 'libtmux.Session.panes', window: 'libtmux.Window.panes' }[scope])
    // The other scopes' methods are not on this page.
    const others = { server: 'libtmux.Window.panes', session: 'libtmux.Server.panes', window: 'libtmux.Session.panes' }[scope]
    expect(symbolIds).not.toContain(others)
  })

  it('offers a scope page only the languages that send the command at that scope', () => {
    const picker = (name: string) => pagesOf(name).pagePorts.filter((entry) => entry.links.length).map((entry) => entry.port)
    expect(picker('cmd_list_panes_session')).not.toContain('ts')
    expect(picker('cmd_list_panes_session')).toContain('py')
    // The command's own pages still land every language somewhere.
    expect(picker('cmd_list_panes_exec')).toEqual(PORTS.map((port) => port.slug))
  })

  it('links the command to every function that lists panes', () => {
    expect(tmuxCommandSources(version, 'list-panes').map((entry) => entry.name)).toEqual([
      'cmd_list_panes_entry', 'cmd_list_panes_exec', 'cmd_list_panes_server', 'cmd_list_panes_session', 'cmd_list_panes_window',
    ])
    expect(tmuxCommandSources(version, 'capture-pane').map((entry) => entry.name)).toHaveLength(2)
  })

  it('writes the same lists into the Markdown of the page', () => {
    const symbol = symbolNamed('cmd_list_panes_session')
    const context = pagesOf('cmd_list_panes_session')
    const text = symbolMarkdown({ model, symbol, version, index: tmuxReferenceIndex(version), hrefFor: (entry) => tmuxReferenceUrl(version, entry),
      manualLinks: context.manualLinks, usage: context.usage })
    expect(text).toContain(`tmux command: [\`list-panes\`](${tmuxManualUrl(version, 'list-panes')})`)
    expect(text).toMatch(/- Session `-s` \(\[`cmd_list_panes_session`\]\([^)]+\)\): .*Python: \[`Session\.panes`\]\(\/py\//)
    expect(text).not.toContain('Server.panes')
    // It is the last section, after the code around the declaration.
    const headings = [...text.matchAll(/^## (.+)$/gm)].map((match) => match[1])
    expect(headings.at(-1)).toBe('In libtmux')
    expect(headings.filter((heading) => heading === 'In libtmux')).toHaveLength(1)
    expect(text.slice(text.indexOf('## In libtmux'))).toContain(`These methods send [\`list-panes\`](${tmuxManualUrl(version, 'list-panes')})`)
    expect(text.slice(0, text.indexOf('## In libtmux'))).not.toContain('Python:')
  })
})

describe('the manual page of a command', () => {
  it('keeps one language picker entry per language and the section heading', () => {
    const links = tmuxApiLinks('list-panes')
    expect(links.map((entry) => entry.name)).toEqual(expect.arrayContaining(['Python', 'Swift', 'Kotlin', 'Scala', 'F#']))
    expect(new Set(links.map((entry) => entry.name)).size).toBe(links.length)
    // The widest scope a language has, so Python opens at the server's panes.
    expect(links.find((entry) => entry.name === 'Python')!.href).toBe(cellHref('server', 'py', 'libtmux.Server.panes'))
    expect(tmuxManualHeadings('latest', 'list-panes').map((heading) => heading.slug)).toContain('list-panes-use-from-a-library')
  })

  function cellHref(scope: string, port: string, id: string) {
    return usage.groups.find((group) => group.scope?.id === scope)!.ports.find((entry) => entry.port === port)!.links.find((link) => link.symbolId === id)!.href
  }
})

describe('the rendered lists', () => {
  async function render(props: Record<string, unknown>) {
    const template = await loadAstroTemplate('components/tmux/TmuxUsage.astro', { real: ['components/api/ApiBadge.astro', 'components/api/SymbolName.astro'] })
    return dom(withoutScope(await renderAstroTemplate(template, { props })))
  }

  it('shows a column for each scope, headed by its flag and the C function', async () => {
    const document = await render({ usage: tmuxResolvedUsage('latest', 'list-panes') })
    const headers = [...document.querySelectorAll('thead th')].map((th) => th.textContent!.replace(/\s+/g, ' ').trim())
    expect(headers).toEqual(['Language', 'Server -a cmd_list_panes_server', 'Session -s cmd_list_panes_session', 'Window -t cmd_list_panes_window'])
    expect([...document.querySelectorAll('thead a')].map((a) => a.getAttribute('href'))).toEqual(
      ['server', 'session', 'window'].map((scope) => `/tmux/latest/reference/c-function-cmd-list-panes-c-cmd_list_panes_${scope}/`))
  })

  it('shows one row per language, in site order, with a kind mark and a link in each filled cell', async () => {
    const document = await render({ usage: tmuxResolvedUsage('latest', 'list-panes') })
    const rows = [...document.querySelectorAll('tbody tr')]
    const order = PORTS.map((port) => port.slug)
    const slugs = rows.map((row) => row.getAttribute('data-port')!)
    expect(slugs).toEqual(order)
    const swift = rows.find((row) => row.getAttribute('data-port') === 'swift')!
    const cells = [...swift.querySelectorAll('td')]
    expect(cells.map((td) => [...td.querySelectorAll('a')].map((a) => a.textContent!.replace(/\s+/g, ''))))
      .toEqual([['mServer.panes()', 'mServer.panes(where:)'], [], []])
    expect(cells[0].querySelector('a')!.getAttribute('href')).toMatch(/\/swift\/[^/]+\/reference\/server-panes\(\)\/$/)
    expect(cells[1].className).toContain('tmux-usage__empty')
  })

  it('names the languages that have no method of their own to list', async () => {
    // Every language has one somewhere for list-panes, so the table has no such line.
    expect((await render({ usage: tmuxResolvedUsage('latest', 'list-panes') })).querySelector('.tmux-usage__absent')).toBeNull()
    const windowPage = await render({ usage: tmuxResolvedUsage('latest', 'list-panes', 'window') })
    expect(windowPage.querySelector('.tmux-usage__absent')!.textContent).toMatch(/^No method in Lua, TypeScript, .*sends this command at this scope itself\.$/)
    // A command a few languages send names the rest, in the order the site lists them.
    const choose = await render({ usage: tmuxResolvedUsage('latest', 'choose-tree') })
    const named = choose.querySelector('.tmux-usage__absent')!.textContent!
    expect(named).toMatch(/^No method in .* sends this command itself\.$/)
    const sending = tmuxUsage('choose-tree')!.groups.flatMap((group) => group.ports).map((entry) => entry.name)
    expect(sending.length).toBeGreaterThan(0)
    for (const name of sending) expect(named).not.toContain(name)
    // The control: a table where every language has a method has no such line.
    const everyone = tmuxResolvedUsage('latest', 'list-panes')!
    const full = { ...everyone, groups: everyone.groups.map((group) => ({ ...group, ports: PORTS.map((port) => ({
      port: port.slug, name: port.name, links: group.ports[0].links })) })) }
    expect((await render({ usage: full })).querySelector('.tmux-usage__absent')).toBeNull()
  })

  it('names the wrappers that send nothing themselves, as the languages with no method', async () => {
    // Kotlin's CommandChain only builds a chain, and sends nothing until it is run.
    const document = await render({ usage: tmuxResolvedUsage('latest', 'choose-tree') })
    const absent = document.querySelector('.tmux-usage__absent')!.textContent!
    for (const [port, listed] of [['kotlin', 'Kotlin'], ['scala', 'Scala']] as const) {
      const sends = tmuxUsage('choose-tree')!.groups.flatMap((group) => group.ports).some((entry) => entry.port === port)
      expect(absent.includes(listed), port).toBe(!sends)
    }
  })

  it('renders only the scope asked for on a scope page', async () => {
    const document = await render({ usage: tmuxResolvedUsage('latest', 'list-panes', 'window') })
    expect([...document.querySelectorAll('thead th')].map((th) => th.textContent!.replace(/\s+/g, ' ').trim()))
      .toEqual(['Language', 'Window -t cmd_list_panes_window'])
    expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toContain('Server.panes')
  })

  it('adds the command, flag and C function to the declaration card, and no table', async () => {
    const source = readFileSync(new URL('../src/components/api/ApiEntry.astro', import.meta.url), 'utf8')
    const start = source.indexOf('{commandRows.length > 0 && <p')
    const end = source.indexOf('</p>}', start) + '</p>}'.length
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const stub = `---\nconst { commandRows } = Astro.props\n---\n${source.slice(start, end)}`
    const template = await loadAstroTemplate('components/api/ApiEntry.astro', { stubs: { 'components/api/ApiEntry.astro': stub } })
    const html = (commandRows: ReturnType<typeof tmuxCommandRows>) => renderAstroTemplate(template, { props: { commandRows } }).then((text) => dom(withoutScope(text)))

    const method = await html(tmuxCommandRows(tmuxSymbolSends('swift', 'Server.panes()'), []))
    expect(method.querySelector('.gp-sphinx-api-mentions')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('tmux command list-panes -a cmd_list_panes_server')
    expect([...method.querySelectorAll('.gp-sphinx-api-mentions a')].map((a) => a.getAttribute('href'))).toEqual([
      '/tmux/latest/manual/list-panes/', '/tmux/latest/reference/c-function-cmd-list-panes-c-cmd_list_panes_server/',
    ])
    expect(method.querySelector('.tmux-usage')).toBeNull()

    // A reader of a method that does not send the command sees no row for it.
    const reader = await html(tmuxCommandRows(tmuxSymbolSends('go', 'tmux.Window.Panes'), []))
    expect(reader.querySelector('.gp-sphinx-api-mentions')).toBeNull()
  })
})

describe('a C page', () => {
  async function page(name: string) {
    const template = await loadAstroTemplate('components/api/ApiReference.astro', {
      real: ['components/api/ApiPageContents.astro', 'components/tmux/TmuxUsage.astro', 'components/api/ApiBadge.astro', 'components/api/SymbolName.astro', 'components/api/ApiRelationships.astro'],
    })
    const model = tmuxSourceModel('latest')
    const symbol = model.symbols.find((entry) => entry.name === name)!
    const container = await experimental_AstroContainer.create({ astroConfig: { site: 'https://libtmux.org' } } as never)
    return dom(withoutScope(await container.renderToString(template as never, {
      request: new Request('https://libtmux.org/'), props: { source: tmuxReferenceContext('latest', symbol), owner: symbol, searchable: false },
    })))
  }

  it.each(['cmd_list_panes_exec', 'cmd_list_panes_window'])('ends with In libtmux, after the code around %s', async (name) => {
    const document = await page(name)
    const sections = [...document.querySelectorAll('h2[id^="api-"]')].map((heading) => heading.id)
    // The section is last, after the call neighborhood, its calls, the declarations it references and the related types.
    expect(sections.at(-1)).toBe('api-tmux-usage')
    expect(sections).toEqual(expect.arrayContaining(['api-call-network', 'api-calls', 'api-referenced-declarations', 'api-related-types']))
    expect(sections.filter((id) => id === 'api-tmux-usage')).toHaveLength(1)
    const heading = document.querySelector('h2#api-tmux-usage')!
    expect(heading.textContent).toContain('In libtmux')
    expect(heading.querySelector('a[href="#api-tmux-usage"]')).not.toBeNull()
    expect(heading.closest('section')!.querySelectorAll('.tmux-usage table')).toHaveLength(1)
    // It is in the section links and in "On this page", in the same last place.
    for (const links of [document.querySelector('nav.api-section-links')!, document.querySelector('.api-page-contents')!]) {
      const targets = [...links.querySelectorAll('a[href^="#api-"]')].map((link) => link.getAttribute('href'))
      expect(targets.at(-1)).toBe('#api-tmux-usage')
    }
    // Nothing of the table is inside the declaration card.
    expect(document.querySelector('.api-overview .tmux-usage')).toBeNull()
  })

  it('has no such section for a declaration that no command owns', async () => {
    const document = await page('options_table')
    expect(document.querySelector('#api-tmux-usage')).toBeNull()
    expect(document.querySelector('.tmux-usage')).toBeNull()
  })
})

describe('the manual page', () => {
  async function page(slug: string) {
    const template = await loadAstroTemplate('pages/tmux/[version]/manual/[...slug].astro', {
      real: ['components/tmux/TmuxUsage.astro', 'components/api/ApiBadge.astro', 'components/api/SymbolName.astro', 'components/SectionHeading.astro'],
      // Neither the code highlighter nor the content collection runs outside a build.
      modules: {
        'astro-expressive-code/components': { Code: Object.assign(() => '', { isAstroComponentFactory: true }) },
        '../../../../lib/page-ports-for': { pagePortsFor: async () => [] },
      },
    })
    const container = await experimental_AstroContainer.create({ astroConfig: { site: 'https://libtmux.org' } } as never)
    return dom(withoutScope(await container.renderToString(template as never, { request: new Request('https://libtmux.org/'), params: { version: 'latest', slug } })))
  }

  it('lists the methods that send list-panes by scope, and every function that implements it', async () => {
    const document = await page('list-panes')
    expect(document.querySelector('h2#list-panes-use-from-a-library')).not.toBeNull()
    // The heading keeps its earlier anchor, so a link to it still lands.
    expect(document.querySelector('#libraries')).not.toBeNull()
    expect(document.querySelectorAll('.tmux-usage table').length).toBe(1)
    expect(document.querySelector('.tmux-usage tr[data-port="swift"] a')!.getAttribute('href')).toMatch(/\/swift\/[^/]+\/reference\/server-panes\(\)\/$/)
    expect([...document.querySelectorAll('h2#list-panes-implementation + p + ul a')].map((a) => a.textContent)).toEqual([
      'cmd_list_panes_entry', 'cmd_list_panes_exec', 'cmd_list_panes_server', 'cmd_list_panes_session', 'cmd_list_panes_window',
    ])
  })

  it('ends with Use from a library, after the C implementation and everything else', async () => {
    for (const slug of ['list-panes', 'capture-pane']) {
      const document = await page(slug)
      const sections = [...document.querySelectorAll('h2[id^="' + slug + '-"]')].map((heading) => heading.id)
      expect(sections.at(-1), slug).toBe(`${slug}-use-from-a-library`)
      expect(sections.indexOf(`${slug}-implementation`), slug).toBeLessThan(sections.indexOf(`${slug}-use-from-a-library`))
    }
  })

  it('lists a command with no scope helpers in one table headed Methods', async () => {
    const document = await page('capture-pane')
    expect(document.querySelectorAll('.tmux-usage table')).toHaveLength(1)
    expect([...document.querySelectorAll('.tmux-usage thead th')].map((th) => th.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['Language', 'Methods'])
    expect(document.querySelector('.tmux-usage tr[data-port="py"] a')!.getAttribute('href')).toMatch(/\/py\/[^/]+\/reference\//)
    // The language picker no longer needs the plain list: the table is the section.
    expect(document.querySelector('h2#capture-pane-use-from-a-library ~ ul')).toBeNull()
  })

  it('has no section for a command that no language sends, rather than a link that is not a sender', async () => {
    const document = await page('set-window-option')
    expect(document.querySelector('.tmux-usage')).toBeNull()
    expect(document.querySelector('h2#set-window-option-use-from-a-library')).toBeNull()
    expect(tmuxLibrarySection('set-window-option')).toBeUndefined()
    expect(tmuxLibrarySection('capture-pane')).toBe('usage')
    expect(tmuxLibrarySection('no-such-command')).toBeUndefined()
  })
})

/** The rules of a stylesheet as `{ at, selector, body }`, with the at-rule they sit in. */
function parseRules(css: string, at = ''): { at: string; selector: string; body: Record<string, string> }[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: { at: string; selector: string; body: Record<string, string> }[] = []
  for (let index = 0; index < text.length;) {
    const open = text.indexOf('{', index)
    if (open < 0) break
    let depth = 1
    let end = open + 1
    while (depth && end < text.length) depth += text[end++] === '{' ? 1 : text[end - 1] === '}' ? -1 : 0
    const head = text.slice(index, open).trim()
    const body = text.slice(open + 1, end - 1)
    if (head.startsWith('@')) out.push(...parseRules(body, head))
    else out.push({ at, selector: head, body: Object.fromEntries(body.split(';').flatMap((declaration) => {
      const colon = declaration.indexOf(':')
      return colon > 0 ? [[declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()]] : []
    })) })
    index = end
  }
  return out
}

/**
 * What a reader sees go wrong in a cell of stacked chips: a chip indented against the first, a
 * name wrapped inside a chip of fixed height so it spills onto the next line, and a table wider
 * than its column with nowhere to scroll. Empty means the stylesheet rules out all three.
 */
function layoutProblems(css: string): string[] {
  const rules = parseRules(css).filter((rule) => !rule.at)
  const problems: string[] = []
  const chips = (rule: { selector: string }) => /\.tmux-usage__links/.test(rule.selector)
  const stack = rules.find((rule) => rule.selector.trim() === '.tmux-usage__links')?.body
  if (stack?.display !== 'flex' || stack['flex-direction'] !== 'column' || stack['align-items'] !== 'flex-start' || !stack.gap) {
    problems.push('chips do not stack flush at the start of the cell with a gap')
  }
  for (const rule of rules.filter(chips)) {
    for (const property of ['margin-inline-start', 'margin-left', 'padding-inline-start', 'padding-left', 'text-indent']) {
      if (property in rule.body) problems.push(`${rule.selector} indents a chip with ${property}`)
    }
  }
  for (const target of ['a', 'code']) {
    const held = rules.some((rule) => chips(rule) && rule.selector.split(',').some((part) => part.trim().endsWith(` ${target}`)) && rule.body['white-space'] === 'nowrap')
    if (!held) problems.push(`a chip's ${target} can wrap`)
  }
  for (const rule of rules.filter((candidate) => /(?:^|[\s,])td\b|__links/.test(candidate.selector) && !/__function/.test(candidate.selector))) {
    if (/anywhere|break-word/.test(rule.body['overflow-wrap'] ?? '') || rule.body['word-break'] === 'break-all') problems.push(`${rule.selector} breaks a name anywhere`)
  }
  const frame = rules.find((rule) => rule.selector.trim() === '.tmux-usage')?.body
  if (!/^(auto|scroll)$/.test(frame?.['overflow-x'] ?? frame?.overflow ?? '')) problems.push('a table wider than its column cannot scroll')
  if (!/inline-size/.test(frame?.container ?? frame?.['container-type'] ?? '')) problems.push('the stacked layout has no container to measure')
  const stacked = parseRules(css).filter((rule) => /^@container .*max-width: *(\d+(?:\.\d+)?)rem/.test(rule.at))
  for (const rule of stacked) if (/\btd\b/.test(rule.selector) && rule.body.display === 'block') problems.push('td is both block and grid when stacked')
  if (!stacked.some((rule) => rule.selector.includes('td') && rule.body.display === 'grid') || Math.min(...stacked.map((rule) => Number(/max-width: *(\d+(?:\.\d+)?)rem/.exec(rule.at)![1]))) < 40) {
    problems.push('the table does not stack when the container is narrow')
  }
  return problems
}

describe('the chip layout of the usage table', () => {
  const component = readFileSync(new URL('../src/components/tmux/TmuxUsage.astro', import.meta.url), 'utf8')
  const css = /<style>([\s\S]*)<\/style>/.exec(component)![1]

  it('stacks the chips of a cell flush, keeps each on one line, and scrolls or stacks instead of overlapping', () => {
    expect(layoutProblems(css)).toEqual([])
  })

  it('catches the layout that indented the second chip and wrapped a name inside its chip', () => {
    const before = css
      .replace(/\.tmux-usage__links \{[^}]*\}/, '')
      .replace(/\.tmux-usage__links a, \.tmux-usage__links code \{[^}]*\}/, '.tmux-usage__links > a + a { margin-inline-start: 0.4rem; }\n  .tmux-usage__links > a { white-space: nowrap; }\n  .tmux-usage td { overflow-wrap: anywhere; }')
      .replace(' overflow-x: auto; container: tmux-usage / inline-size;', '')
      .replace(/@container tmux-usage \(max-width: 50rem\)/, '@media (max-width: 40rem)')
    const collision = css.replace(':is(table, tbody, th) {', ':is(table, tbody, th, td) {')
    expect(layoutProblems(collision)).toEqual(['td is both block and grid when stacked'])
    const problems = layoutProblems(before)
    expect(problems).toEqual(expect.arrayContaining([
      'chips do not stack flush at the start of the cell with a gap',
      '.tmux-usage__links > a + a indents a chip with margin-inline-start',
      "a chip's code can wrap",
      '.tmux-usage td breaks a name anywhere',
      'a table wider than its column cannot scroll',
      'the stacked layout has no container to measure',
      'the table does not stack when the container is narrow',
    ]))
  })
})

const MARKS_CSS = readFileSync(new URL('../src/styles/kind-marks.css', import.meta.url), 'utf8')
const CHIP_CONTAINERS = ['.api-elsewhere-value', '.api-command-related', '.tmux-usage', 'nav.api-related']
const squash = (selector: string) => selector.replace(/\s+/g, ' ').trim()

/**
 * What a reader sees go wrong when the pointer or the keyboard reaches a split chip: the tree's
 * selected-node ring around the mark alone, a chip whose surface changes while its border does not,
 * and a focus outline that is not one ring around the whole chip. Empty means the stylesheet rules
 * out all three, and keeps the ring where the tree selects a node.
 */
function chipStateProblems(css: string): string[] {
  const all = parseRules(css)
  const problems: string[] = []
  const inChip = (rule: { selector: string }) => CHIP_CONTAINERS.every((container) => rule.selector.includes(container)) && rule.selector.includes('a:has(> .api-nav__kind)')
  const chipRules = all.filter((rule) => !rule.at && inChip(rule))
  const reachesChip = (rule: { selector: string }, state: string) => squash(rule.selector).includes(state)
  /** The selector without the `:has(> .api-nav__kind)` that picks out the chip, so `> .api-nav__kind` means its mark. */
  const targetsMark = (rule: { selector: string }) => squash(rule.selector).replace(/:has\([^)]*\)/g, '').includes('> .api-nav__kind')

  const hovered = chipRules.find((rule) => reachesChip(rule, ':is(:hover, :focus-visible)') && !targetsMark(rule))
  if (!hovered?.body.background || !hovered.body['border-color']) problems.push('a hovered chip changes its surface but not its border')

  // The active rule lights any hovered link's mark; the chip must put its own mark back.
  const ring = all.filter((rule) => !rule.at && (rule.body['box-shadow'] ?? '').includes('--mk-act-ring'))
  const lightsAnyLink = ring.some((rule) => squash(rule.selector).includes(':is(a, summary):is(:hover, :focus-visible) > .api-nav__kind'))
  const reset = chipRules.find((rule) => reachesChip(rule, ':is(:hover, :focus-visible) > .api-nav__kind'))
  if (lightsAnyLink && (!reset || (reset.body['box-shadow'] ?? '').includes('--mk-act') || /--mk-act/.test(reset.body.background ?? '') || /--mk-act/.test(reset.body.color ?? ''))) {
    problems.push("a hovered chip's mark takes the active ring")
  }
  if (ring.some((rule) => inChip(rule))) problems.push('a chip rule sets the active ring')

  const focus = chipRules.find((rule) => reachesChip(rule, ':focus-visible') && !reachesChip(rule, ':hover') && !targetsMark(rule))
  if (!focus || !(focus.body.outline ?? '').startsWith('2px solid ') || !focus.body['outline-offset'] || parseInt(focus.body['outline-offset']) < 1) problems.push('focus is not one outline clear of the whole chip')
  if (focus && 'box-shadow' in focus.body) problems.push('focus rings the chip with a shadow')

  const forced = all.filter((rule) => /forced-colors/.test(rule.at))
  const forcedReset = forced.find((rule) => inChip(rule) && reachesChip(rule, ':is(:hover, :focus-visible) > .api-nav__kind'))
  if (!forcedReset || forcedReset.body.background !== 'Canvas') problems.push("forced colours light a hovered chip's mark alone")

  // The control: the tree still selects a node with the ring.
  const selected = ring.find((rule) => squash(rule.selector).includes(".api-nav__leaf[aria-current='page'] > .api-nav__kind"))
  if (!selected) problems.push("the tree's selected node lost its ring")
  return problems
}

describe('the hover and focus of a split chip', () => {
  it('acts on the whole chip, leaves the mark as it rests, and focuses with one outline', () => {
    expect(chipStateProblems(MARKS_CSS)).toEqual([])
  })

  it('catches the mark-only ring, the surface-only hover and a focus that rings the mark', () => {
    const chipReset = /:is\(\.api-elsewhere-value[^{]*a:has\(> \.api-nav__kind\):is\(:hover, :focus-visible\) > \.api-nav__kind \{[^}]*\}\n/
    expect(MARKS_CSS).toMatch(chipReset)
    expect(chipStateProblems(MARKS_CSS.replace(chipReset, ''))).toEqual(["a hovered chip's mark takes the active ring"])
    expect(chipStateProblems(MARKS_CSS.replace(/(a:has\(> \.api-nav__kind\):is\(:hover, :focus-visible\) \{\n[^}]*?)\n  border-color:[^\n]*/, '$1')))
      .toEqual(['a hovered chip changes its surface but not its border'])
    expect(chipStateProblems(MARKS_CSS.replace(/(a:has\(> \.api-nav__kind\):focus-visible \{\n)  outline: [^\n]*\n  outline-offset: [^\n]*\n/, '$1  box-shadow: var(--mk-act-ring, none);\n')))
      .toEqual(expect.arrayContaining(['focus is not one outline clear of the whole chip', 'focus rings the chip with a shadow', 'a chip rule sets the active ring']))
  })

  it('keeps the ring on the tree, so the fix is not to drop it everywhere', () => {
    // A fix that deletes the active ring would pass the chip checks and lose the tree's selected node.
    const noRing = MARKS_CSS.replace('box-shadow: var(--mk-act-ring, none);', '')
    expect(chipStateProblems(noRing)).toEqual(["the tree's selected node lost its ring"])
  })
})
