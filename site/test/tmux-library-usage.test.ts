import { readFileSync } from 'node:fs'
import { experimental_AstroContainer } from 'astro/container'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { documentProblems } from '../../scripts/gen-tmux-usage.mjs'
import { API_MODELS } from '../src/lib/api-models'
import { PORTS } from '../src/lib/ports'
import { symbolMarkdown } from '../src/lib/symbol-markdown'
import { tmuxApiLinks, tmuxCommandsFor, tmuxManualHeadings, tmuxManualUrl } from '../src/lib/tmux-manual-data'
import { TMUX_USAGE, tmuxScopes, tmuxUsage, tmuxUsageOf } from '../src/lib/tmux-library-usage'
import {
  tmuxCommandRows, tmuxCommandSources, tmuxReferenceContext, tmuxReferenceIndex, tmuxReferenceUrl, tmuxResolvedUsage, tmuxSourceModel, tmuxSymbolSends,
} from '../src/lib/tmux-reference'
import { loadAstroTemplate, renderAstroTemplate, withoutScope } from './astro-templates'

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
  it.each(PORTS.map((port) => port.slug))('is bound to the pinned API model of %s', (slug) => {
    expect(documentProblems(TMUX_USAGE[slug], API_MODELS[slug], scopeTable, ['list-panes'])).toEqual([])
  })

  it('names the methods that send list-panes at each scope, where the ports differ in design', () => {
    expect(cell('server', 'swift')).toEqual(['Server.panes()', 'Server.panes(where:)'])
    expect(cell('server', 'py')).toEqual(['Server.panes', 'Server.search_panes'])
    expect(cell('session', 'py')).toEqual(['Session.panes', 'Session.search_panes'])
    expect(cell('window', 'cxx')).toEqual(['Window::panes'])
    expect(cell('server', 'ruby')).toEqual(['Server#list_panes'])
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
    // Kotlin, Scala and F# have no method of their own that sends it.
    for (const port of ['kotlin', 'scala', 'fsharp']) {
      for (const scope of ['server', 'session', 'window']) expect(cell(scope, port)).toBeUndefined()
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
    const go = tmuxUsageOf('go', 'tmux.Pane.Select')
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
    expect(tmuxUsage('kill-pane')).toBeUndefined()
    expect(tmuxScopes('kill-pane')).toEqual([])
    expect(tmuxUsageOf('py', 'libtmux.Pane.kill')).toEqual([])
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
    // A command whose usage is not recorded keeps its concept link.
    expect(tmuxCommandsFor('ts', 'pane.Pane.capture').map((command) => command.name)).toEqual(['capture-pane'])
  })

  it('names what the method sends before its equivalents, and what it sends through a helper last', () => {
    const plain = [{ name: 'send-keys', href: tmuxManualUrl('latest', 'send-keys') }]
    const rows = tmuxCommandRows(tmuxSymbolSends('java', 'io.github.libtmux.Pane.Pane.sendKeys'), plain)
    expect(rows.map((row) => row.command)).toEqual(['send-keys', 'list-panes'])
    expect(tmuxCommandRows(tmuxSymbolSends('py', 'libtmux.Server.panes'), plain).map((row) => row.command)).toEqual(['list-panes', 'send-keys'])
    expect(tmuxCommandRows([], plain).map((row) => row.scopes)).toEqual([[]])
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
    expect(slugs).toEqual(order.filter((slug) => slugs.includes(slug)))
    expect(slugs).not.toContain('kotlin')
    const swift = rows.find((row) => row.getAttribute('data-port') === 'swift')!
    const cells = [...swift.querySelectorAll('td')]
    expect(cells.map((td) => [...td.querySelectorAll('a')].map((a) => a.textContent!.replace(/\s+/g, ''))))
      .toEqual([['mServer.panes()', 'mServer.panes(where:)'], [], []])
    expect(cells[0].querySelector('a')!.getAttribute('href')).toMatch(/\/swift\/[^/]+\/reference\/server-panes\(\)\/$/)
    expect(cells[1].className).toContain('tmux-usage__empty')
  })

  it('names the languages that have no method of their own to list', async () => {
    const document = await render({ usage: tmuxResolvedUsage('latest', 'list-panes') })
    expect(document.querySelector('.tmux-usage__absent')!.textContent).toBe('No method in Kotlin, Scala, or F# sends this command itself.')
    const windowPage = await render({ usage: tmuxResolvedUsage('latest', 'list-panes', 'window') })
    expect(windowPage.querySelector('.tmux-usage__absent')!.textContent).toMatch(/^No method in Lua, Julia, TypeScript, .*sends this command at this scope itself\.$/)
    // The control: a command that every language sends has no such line.
    const everyone = tmuxResolvedUsage('latest', 'list-panes')!
    const full = { ...everyone, groups: everyone.groups.map((group) => ({ ...group, ports: PORTS.map((port) => ({
      port: port.slug, name: port.name, links: group.ports[0].links })) })) }
    expect((await render({ usage: full })).querySelector('.tmux-usage__absent')).toBeNull()
  })

  it('renders only the scope asked for on a scope page', async () => {
    const document = await render({ usage: tmuxResolvedUsage('latest', 'list-panes', 'window') })
    expect([...document.querySelectorAll('thead th')].map((th) => th.textContent!.replace(/\s+/g, ' ').trim()))
      .toEqual(['Language', 'Window -t cmd_list_panes_window'])
    expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toContain('Server.panes')
  })

  it('adds the command, flag and C function to the method page', async () => {
    const source = readFileSync(new URL('../src/components/api/ApiEntry.astro', import.meta.url), 'utf8')
    const start = source.indexOf('{commandRows.length > 0 && <p')
    const end = source.indexOf('</div>)}', source.indexOf('{usage.map(', start)) + '</div>)}'.length
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const stub = `---\nimport TmuxUsage from '../tmux/TmuxUsage.astro'\nconst { commandRows, usage } = Astro.props\n---\n${source.slice(start, end)}`
    const template = await loadAstroTemplate('components/api/ApiEntry.astro', {
      real: ['components/tmux/TmuxUsage.astro', 'components/api/ApiBadge.astro', 'components/api/SymbolName.astro'], stubs: { 'components/api/ApiEntry.astro': stub },
    })
    const html = (props: Record<string, unknown>) => renderAstroTemplate(template, { props: { commandRows: [], usage: [], ...props } }).then((text) => dom(withoutScope(text)))

    const method = await html({ commandRows: tmuxCommandRows(tmuxSymbolSends('swift', 'Server.panes()'), []) })
    expect(method.querySelector('.gp-sphinx-api-mentions')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('tmux command list-panes -a cmd_list_panes_server')
    expect([...method.querySelectorAll('.gp-sphinx-api-mentions a')].map((a) => a.getAttribute('href'))).toEqual([
      '/tmux/latest/manual/list-panes/', '/tmux/latest/reference/c-function-cmd-list-panes-c-cmd_list_panes_server/',
    ])

    // A reader of a method that does not send the command sees no row for it.
    const reader = await html({ commandRows: tmuxCommandRows(tmuxSymbolSends('go', 'tmux.Window.Panes'), []) })
    expect(reader.querySelector('.gp-sphinx-api-mentions')).toBeNull()

    const declaration = await html({ usage: [tmuxResolvedUsage('latest', 'list-panes', 'session')] })
    expect(declaration.querySelector('.tmux-usage-block .gp-sphinx-api-mentions-label')!.textContent).toBe('In libtmux')
    expect(declaration.querySelectorAll('.tmux-usage table').length).toBe(1)
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

  it('keeps the plain list for a command whose usage is not recorded', async () => {
    const document = await page('capture-pane')
    expect(document.querySelector('.tmux-usage')).toBeNull()
    expect([...document.querySelectorAll('h2#capture-pane-use-from-a-library ~ ul a')].map((a) => a.textContent)).toContain('Python')
  })
})
