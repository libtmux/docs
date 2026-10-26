import { readFileSync } from 'node:fs'
import { experimental_AstroContainer } from 'astro/container'
import { Window, type Document } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONCEPTS, conceptsFor, type ApiSymbol } from '@libtmux/api-model'
import mentions from '../src/data/mentions.json'
import { API_MODELS, PORT_NAME } from '../src/lib/api-models'
import { PORTS } from '../src/lib/ports'
import { productApiAlternatives } from '../src/lib/product-api'
import { apiTmuxSections, type ApiTmuxSection } from '../src/lib/api-tmux-sections'
import { symbolMarkdown } from '../src/lib/symbol-markdown'
import { TMUX_USAGE } from '../src/lib/tmux-library-usage'
import { tmuxManualUrl } from '../src/lib/tmux-manual-data'
import { tmuxReferenceUrl, tmuxSourceModel } from '../src/lib/tmux-reference'
import { loadAstroTemplate, withoutScope } from './astro-templates'

vi.mock('astro:content', () => ({ getCollection: async () => [] }))

const windows: Window[] = []
afterEach(async () => { for (const win of windows.splice(0)) await win.happyDOM.abort() })

const symbolOf = (port: string, id: string) => API_MODELS[port].symbols.find((entry) => (entry.publicId ?? entry.id) === id)!
const sendKeys = symbolOf('ts', 'pane.Pane.sendKeys')
const sections = (port: string, symbol: ApiSymbol) => apiTmuxSections(port, symbol)

const COMPONENTS = ['components/api/ApiTmuxSections.astro', 'components/tmux/TmuxUsage.astro', 'components/api/ApiBadge.astro', 'components/api/SymbolName.astro', 'components/api/ApiDoc.astro']

/** The sections of one symbol as the reader's page draws them. */
async function html(list: ApiTmuxSection[]): Promise<Document> {
  const template = await loadAstroTemplate('components/api/ApiTmuxSections.astro', { real: COMPONENTS })
  const container = await experimental_AstroContainer.create({ astroConfig: { site: 'https://libtmux.org' } } as never)
  const win = new Window()
  windows.push(win)
  win.document.body.innerHTML = withoutScope(await container.renderToString(template as never, {
    request: new Request('https://libtmux.org/'), props: { sections: list },
  }))
  return win.document
}

describe('the sections of pane.Pane.sendKeys', () => {
  it('come in the order of the spec, each with the count its rows add up to', () => {
    const list = sections('ts', sendKeys)
    expect(list.map((section) => [section.id, section.label])).toEqual([
      ['api-tmux-command', 'tmux command'], ['api-tmux-c-api', 'tmux C API'], ['api-guides', 'Guides'], ['api-other-ports', 'In other ports'],
    ])
    const [commands, cApi, guides, ports] = list
    // The command comes from the recorded usage, not from the derivation under test.
    const recorded = TMUX_USAGE.ts.symbols['pane.Pane.sendKeys'].map((use) => use.command)
    expect(commands.type === 'commands' && commands.items.map((item) => item.command)).toEqual(recorded)
    expect(commands.count).toBe(recorded.length)
    expect(commands.type === 'commands' && commands.items[0].href).toBe(tmuxManualUrl('latest', 'send-keys'))
    // The C declarations behind send-keys, each with the kind the tmux C model gives it.
    const model = tmuxSourceModel('latest')
    const declared = ['cmd_send_keys_entry', 'cmd_send_keys_exec'].map((name) => model.symbols.find((entry) => entry.name === name)!)
    expect(cApi.type === 'c-api' && cApi.direct).toEqual(declared.map((entry) => ({ id: entry.id, name: entry.name, kind: entry.kind, href: tmuxReferenceUrl('latest', entry) })))
    expect(cApi.type === 'c-api' && cApi.paths).toEqual([])
    expect(cApi.count).toBe(2)
    // Guides keep the section of each mention, in sorted section order.
    const pages = mentions.mentions.filter((entry) => entry.port === 'ts' && entry.symbol === 'pane.Pane.sendKeys')
    const names = [...new Set(pages.map((entry) => entry.section ?? 'docs'))].sort()
    expect(guides.type === 'guides' && guides.groups.map((group) => group.id)).toEqual(names)
    expect(guides.type === 'guides' && guides.groups.flatMap((group) => group.items.map((item) => item.title)))
      .toEqual(names.flatMap((name) => pages.filter((entry) => (entry.section ?? 'docs') === name).map((entry) => entry.title ?? entry.page)))
    expect(guides.count).toBe(pages.length)
    // Every other port has a row or a place in the closing sentence, for every concept naming the method.
    expect(ports.type === 'ports' && ports.groups.map((group) => group.label)).toEqual(conceptsFor('ts', 'pane.Pane.sendKeys').map((concept) => concept.label))
    if (ports.type !== 'ports') throw new Error('not ports')
    const others = Object.keys(API_MODELS).filter((port) => port !== 'ts')
    let linked = 0
    let rendered = 0
    for (const [i, concept] of conceptsFor('ts', 'pane.Pane.sendKeys').entries()) {
      const table = ports.groups[i].table
      const rows = table.groups[0].ports
      // Only a reason that says something stays a row; the sentence the concept table writes for every unmapped language does not.
      const reasoned = (port: string) => !concept.symbols[port] && concept.absent?.[port] && !/^No source-verified .+ equivalent is recorded for this operation\.$/.test(concept.absent[port])
      const absent = others.filter((port) => !concept.symbols[port] && !reasoned(port))
      expect(rows.filter((row) => !row.links.length).map((row) => row.port).sort()).toEqual(others.filter((port) => reasoned(port)).sort())
      for (const row of rows.filter((row) => !row.links.length && !concept.symbols[row.port])) expect(row.note).toBe(concept.absent![row.port])
      expect(absent.every((port) => !rows.some((row) => row.port === port))).toBe(true)
      const names = absent.sort((a, b) => PORTS.findIndex((entry) => entry.slug === a) - PORTS.findIndex((entry) => entry.slug === b)).map((port) => PORT_NAME[port])
      expect(table.absent).toBe(names.length ? `No equivalent is recorded in ${new Intl.ListFormat('en-GB', { type: 'disjunction' }).format(names)}.` : null)
      rendered += rows.length
      linked += rows.filter((row) => row.links.length).length
    }
    expect(linked).toBeGreaterThan(0)
    // The count is the rows the tables draw, reasons included, and not the languages of the closing sentences.
    expect(ports.count).toBe(rendered)
    expect(rendered).toBeGreaterThan(linked)
  })

  it('draw each list with its heading link, kind badges and every row', async () => {
    const list = sections('ts', sendKeys)
    const document = await html(list)
    const headings = [...document.querySelectorAll('section.api-tmux-section > h2.api-section-heading')]
    expect(headings.map((heading) => heading.id)).toEqual(list.map((section) => section.id))
    for (const heading of headings) expect(heading.querySelector(`a.api-heading-link[href="#${heading.id}"]`)).not.toBeNull()
    const cApi = document.querySelector('#api-tmux-c-api')!.closest('section')!
    const chips = [...cApi.querySelectorAll('a:not(.api-heading-link)')]
    expect(chips.map((a) => a.querySelector('code')!.textContent)).toEqual(['cmd_send_keys_entry', 'cmd_send_keys_exec'])
    for (const chip of chips) expect(chip.querySelector('.api-nav__kind')?.textContent).toBeTruthy()
    // Other ports: the Language | Equivalent table, with the concept as its intro.
    const ports = document.querySelector('#api-other-ports')!.closest('section')!
    expect(ports.querySelector('table th')!.textContent).toBe('Language')
    expect(ports.querySelectorAll('tbody tr').length).toBeGreaterThan(0)
    expect(ports.querySelector('details')).toBeNull()
  })
})

describe('the tmux C API of a method that creates a session', () => {
  it.each([['ts', 'server.Server.newSession'], ['py', 'libtmux.Server.new_session']] as const)('lists the %s method\'s function at degree 1 and the curated path at degrees 2 to 5', (port, id) => {
    const cApi = sections(port, symbolOf(port, id)).find((section) => section.type === 'c-api')
    if (cApi?.type !== 'c-api') throw new Error('no C API section')
    expect(cApi.direct.map((item) => item.name)).toContain('cmd_new_session_exec')
    const path = cApi.paths.find((entry) => entry.title === 'Create a session and its first pane')!
    expect(path.items.map((item) => [item.name, item.degree, item.kind])).toEqual([
      ['cmd_new_session_exec', 1, 'function'], ['spawn_window', 2, 'function'], ['spawn_pane', 3, 'function'], ['window_add_pane', 4, 'function'], ['window_pane_create', 5, 'function'],
    ])
    const model = tmuxSourceModel('latest')
    for (const item of path.items) expect(item.href).toBe(tmuxReferenceUrl('latest', model.symbols.find((entry) => entry.id === item.id)!))
    expect(cApi.count).toBe(cApi.direct.length + path.items.length - 1)
  })

  it('shows only the degree-1 functions of a command with no curated path', () => {
    const cApi = sections('ts', sendKeys).find((section) => section.type === 'c-api')
    expect(cApi?.type === 'c-api' && cApi.paths).toEqual([])
  })

  it('writes the path in HTML and in Markdown alike', async () => {
    const symbol = symbolOf('ts', 'server.Server.newSession')
    const document = await html(sections('ts', symbol))
    const cApi = document.querySelector('#api-tmux-c-api')!.closest('section')!
    // One ordered sequence under the path name, as Paths through the source draws it, with the degree before each step.
    expect(cApi.querySelector('.api-source-path h3')!.textContent).toBe('Create a session and its first pane')
    const steps = [...cApi.querySelectorAll('.api-source-path li')]
    expect(steps.map((step) => step.querySelector('code')!.textContent)).toEqual(['cmd_new_session_exec', 'spawn_window', 'spawn_pane', 'window_add_pane', 'window_pane_create'])
    expect(steps.map((step) => step.querySelector('a > .api-source-path__edge')!.textContent)).toEqual(['1', '2', '3', '4', '5'])
    expect(steps.map((step) => step.querySelectorAll(':scope > .api-source-path__edge').length)).toEqual([0, 1, 1, 1, 1])
    expect(steps[1].querySelector(':scope > .api-source-path__edge')!.textContent).toBe('calls →')
    // The degree-1 declarations stay as chips above the paths, and the degrees are explained once.
    expect(cApi.querySelectorAll(':scope > .tmux-usage a').length).toBe(2)
    expect(cApi.textContent!.match(/degree counts calls/g)).toHaveLength(1)
    expect(cApi.textContent).not.toContain('from cmd_new_session_exec')
    const text = symbolMarkdown({ model: API_MODELS.ts, symbol })
    const body = text.split('## tmux C API\n')[1].split('\n## ')[0]
    expect(body).toContain('### Create a session and its first pane\n\n1. [`cmd_new_session_exec`]')
    expect(body).toMatch(/\n5\. calls → \[`window_pane_create`\]\(\/tmux\/latest\/reference\/c-function-window-c-window_pane_create\/\) \(function\)/)
    expect(body.match(/degree counts calls/g)).toHaveLength(1)
  })
})

describe('the wording of the sections', () => {
  it('names the symbol as inline code in HTML and keeps the backticks in Markdown', async () => {
    const symbol = symbolOf('ts', 'server.Server.newSession')
    const document = await html(sections('ts', symbol))
    for (const id of ['api-tmux-command', 'api-guides']) {
      const intro = document.getElementById(id)!.closest('section')!.querySelector('p')!
      expect(intro.textContent, id).not.toContain('`')
      expect(intro.querySelector('code')!.textContent, id).toBe('newSession')
    }
    expect(symbolMarkdown({ model: API_MODELS.ts, symbol })).toContain('The tmux commands behind `newSession`.')
  })

  it('separates the guides of one group with commas', async () => {
    const symbol = symbolOf('ts', 'server.Server.newSession')
    const list = sections('ts', symbol).find((section) => section.type === 'guides')
    if (list?.type !== 'guides') throw new Error('no guides')
    const group = list.groups.find((entry) => entry.items.length > 1)!
    expect(group, 'two mentions in one group').toBeDefined()
    const document = await html([list])
    const paragraph = [...document.querySelectorAll('section p')].find((p) => p.querySelectorAll('a').length === group.items.length && p.textContent!.includes(group.items[0].title))!
    expect(paragraph.textContent).toBe(group.items.map((item) => item.title).join(', '))
  })

  it('collapses the generic absences of send-keys into one sentence and keeps Java\'s reason as a row', () => {
    const concept = CONCEPTS['send-keys']
    expect(concept.absent!.java).toContain('no direct equivalent')
    const ports = sections('ts', sendKeys).find((section) => section.type === 'ports')
    if (ports?.type !== 'ports') throw new Error('no ports')
    const table = ports.groups.find((group) => group.label === concept.label)!.table
    const rows = table.groups[0].ports
    expect(rows.find((row) => row.port === 'java')!.note).toBe(concept.absent!.java)
    const generic = ['powershell', 'julia', 'elixir', 'fsharp']
    for (const port of generic) {
      expect(concept.absent![port]).toMatch(/^No source-verified/)
      expect(rows.some((row) => row.port === port), port).toBe(false)
    }
    expect(table.absent).toBe('No equivalent is recorded in PowerShell, Julia, Elixir or F#.')
  })
})

describe('the HTML and the Markdown of pane.Pane.sendKeys', () => {
  const markdown = () => {
    const text = symbolMarkdown({ model: API_MODELS.ts, symbol: sendKeys })
    return text.split(/^## /m).slice(1).map((chunk) => ({ heading: chunk.split('\n')[0], body: chunk }))
  }
  const hrefs = (text: string) => [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1])

  it('hold the same sections in the same order', async () => {
    const document = await html(sections('ts', sendKeys))
    const labels = sections('ts', sendKeys).map((section) => section.label)
    const written = markdown().map((chunk) => chunk.heading).filter((heading) => labels.includes(heading))
    expect(written).toEqual(labels)
    expect([...document.querySelectorAll('h2.api-section-heading')].map((heading) => heading.textContent!.replace(/#$/, ''))).toEqual(labels)
  })

  it('link the same destinations in each list', async () => {
    const document = await html(sections('ts', sendKeys))
    const chunks = markdown()
    for (const section of sections('ts', sendKeys).filter((entry) => entry.type !== 'ports')) {
      const element = document.getElementById(section.id)!.closest('section')!
      const shown = [...element.querySelectorAll('a:not(.api-heading-link)')].map((a) => a.getAttribute('href'))
      expect(hrefs(chunks.find((chunk) => chunk.heading === section.label)!.body), section.label).toEqual(shown)
    }
  })

  it('give each language of In other ports the same row', async () => {
    const document = await html(sections('ts', sendKeys))
    const element = document.getElementById('api-other-ports')!.closest('section')!
    const body = markdown().find((chunk) => chunk.heading === 'In other ports')!.body
    const rows = [...element.querySelectorAll('tbody tr')]
    const lines = body.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| Language') && !line.startsWith('| ---'))
    expect(lines.map((line) => line.split(' | ')[0].slice(2))).toEqual(rows.map((row) => row.querySelector('th')!.textContent))
    for (const [i, row] of rows.entries()) {
      const link = row.querySelector('td a')
      if (link) expect(lines[i]).toContain(`](${link.getAttribute('href')})`)
    }
  })
})

describe('a symbol with no tmux data', () => {
  const control = symbolOf('ts', 'client.Client.constructor')

  it('has none of the sections', async () => {
    expect(sections('ts', control)).toEqual([])
    expect((await html([])).querySelector('h2')).toBeNull()
    const text = symbolMarkdown({ model: API_MODELS.ts, symbol: control })
    for (const label of ['tmux command', 'tmux C API', 'tmux hooks', 'tmux options', 'tmux formats', 'Guides', 'In other ports']) expect(text).not.toContain(`## ${label}`)
  })

  it('has a section for each catalog kind a type wraps, and a plain-link one for options', async () => {
    const options = sections('py', symbolOf('py', 'libtmux._internal.constants.ServerOptions'))
    expect(options.map((section) => section.id)).toEqual(expect.arrayContaining(['api-tmux-options']))
    expect(options.map((section) => section.id)).not.toContain('api-tmux-hooks')
    const document = await html(options.filter((section) => section.id === 'api-tmux-options'))
    expect(document.querySelector('#api-tmux-options')!.closest('section')!.querySelector('a .api-nav__kind')).not.toBeNull()
  })
})

describe('the reference page of pane.Pane.sendKeys', () => {
  const PAGE = ['components/api/ApiPageContents.astro', 'components/api/ApiBadge.astro', 'components/api/SymbolName.astro', 'components/api/ApiRelationships.astro', ...COMPONENTS]
  async function page(port: string, owner: ApiSymbol) {
    const template = await loadAstroTemplate('components/api/ApiReference.astro', { real: PAGE })
    const container = await experimental_AstroContainer.create({ astroConfig: { site: 'https://libtmux.org' } } as never)
    const win = new Window()
    windows.push(win)
    win.document.body.innerHTML = withoutScope(await container.renderToString(template as never, {
      request: new Request(`https://libtmux.org/en/${port}/latest/reference/${owner.slug}/`), params: { slug: owner.slug }, props: { model: API_MODELS[port], owner },
    }))
    return win.document
  }

  it('lists the new sections before Related types, in the section links and in On this page, with their counts', async () => {
    const document = await page('ts', sendKeys)
    const wanted = sections('ts', sendKeys)
    const ids = [...document.querySelectorAll('h2[id^="api-"]')].map((heading) => heading.id)
    const first = ids.indexOf(wanted[0].id)
    expect(ids.slice(first, first + wanted.length)).toEqual(wanted.map((section) => section.id))
    expect(ids.indexOf('api-related-types')).toBeGreaterThan(first + wanted.length - 1)
    for (const links of [document.querySelector('nav.api-section-links')!, document.querySelector('.api-page-contents')!]) {
      const targets = [...links.querySelectorAll('a[data-api-section-link]')].map((link) => link.getAttribute('href')!.slice(1))
      expect(targets.filter((id) => wanted.some((section) => section.id === id))).toEqual(wanted.map((section) => section.id))
      expect(targets.indexOf('api-related-types')).toBeGreaterThan(targets.indexOf(wanted.at(-1)!.id))
    }
    const counts = [...document.querySelectorAll('nav.api-section-links a')].filter((link) => wanted.some((section) => `#${section.id}` === link.getAttribute('href')))
      .map((link) => link.querySelector('span')?.textContent)
    expect(counts).toEqual(wanted.map((section) => String(section.count)))
    // Each count is what its section draws, counted from the page and not from the derivation.
    const section = (id: string) => document.getElementById(id)!.closest('section')!
    expect(section('api-tmux-command').querySelectorAll('.tmux-usage__item').length).toBe(wanted[0].count)
    expect(section('api-tmux-c-api').querySelectorAll('.tmux-usage__item a').length).toBe(wanted[1].count)
    expect(section('api-guides').querySelectorAll('p a').length).toBe(wanted[2].count)
    expect(section('api-other-ports').querySelectorAll('tbody tr').length).toBe(wanted[3].count)
  })

  it('has none of them on the page of a symbol with no tmux data', async () => {
    const document = await page('ts', symbolOf('ts', 'client.Client.constructor'))
    expect(document.querySelector('.api-tmux-section')).toBeNull()
  })
})

describe('the rows under a declaration', () => {
  async function entry(props: Record<string, unknown>) {
    const template = await loadAstroTemplate('components/api/ApiEntry.astro', {
      real: ['components/api/ApiBadge.astro', 'components/api/ApiDoc.astro'],
      modules: { 'astro-expressive-code/components': { Code: Object.assign(() => '', { isAstroComponentFactory: true }) } },
    })
    const container = await experimental_AstroContainer.create({ astroConfig: { site: 'https://libtmux.org' } } as never)
    const win = new Window()
    windows.push(win)
    win.document.body.innerHTML = withoutScope(await container.renderToString(template as never, {
      request: new Request('https://libtmux.org/en/ts/latest/reference/pane-pane-sendkeys/'),
      props: { symbol: sendKeys, index: (await import('../src/lib/api-models')).indexFor(API_MODELS.ts, () => '/'), port: 'ts', ...props },
    }))
    return win.document
  }

  it('moves to the sections for the page\'s own symbol, and stays with a member listed on an aggregate page', async () => {
    const own = await entry({ linkRows: false })
    expect(own.querySelector('.gp-sphinx-api-mentions')).toBeNull()
    expect(own.querySelector('.api-elsewhere')).toBeNull()
    const member = await entry({ member: true })
    expect([...member.querySelectorAll('.gp-sphinx-api-mentions-label')].map((label) => label.textContent)).toEqual(['tmux command', 'Discussed in'])
    expect(member.querySelector('.api-elsewhere')).not.toBeNull()
  })
})

describe('the styles the lists borrow', () => {
  // Astro scopes a component's style to the component's own markup, so a list drawn by another component or page
  // gets none of it unless the rule is global. The manual page's chips ran together for want of this.
  const read = (file: string) => readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8')

  it('reach the chip lists of the manual page and the API sections: global, with the gap between chips', () => {
    const usage = read('tmux/TmuxUsage.astro')
    expect(usage).toContain('<style is:global>')
    expect(usage).toMatch(/\.tmux-usage__links \{[^}]*gap: 0\.35rem/)
    // Global is safe because every selector in the block is under the component's own class.
    const selectors = [...usage.split('<style is:global>')[1].matchAll(/^\s*([^\s@/*][^{\n]*)\{/gm)].map((match) => match[1])
    expect(selectors.length).toBeGreaterThan(5)
    for (const selector of selectors) expect(selector.trim(), selector).toMatch(/^\.tmux-usage/)
  })

  it('reach the path sequence of the tmux C API section', () => {
    const relationships = read('api/ApiRelationships.astro')
    for (const selector of ['.api-source-path ol', '.api-source-path li', '.api-source-path li a', '.api-source-path__edge']) expect(relationships, selector).toContain(`:global(${selector})`)
  })
})

describe('a command item of a method that sends at a scope', () => {
  it('names the flag, the scope and the C function behind it, with the line that sends as its tooltip', async () => {
    const document = await html(sections('swift', symbolOf('swift', 'Server.panes()')))
    const item = document.querySelector('#api-tmux-command')!.closest('section')!.querySelector('.tmux-usage__item')!
    expect(item.textContent!.replace(/\s+/g, ' ').trim()).toBe('list-panes -a server scope, cmd_list_panes_server')
    expect([...item.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      tmuxManualUrl('latest', 'list-panes'), '/tmux/latest/reference/c-function-cmd-list-panes-c-cmd_list_panes_server/',
    ])
    expect(item.querySelector('.tmux-send')!.getAttribute('title')).toMatch(/^(?:Calls .+: )?[^ ]+:\d+$/)
  })
})

describe('the degree-1 functions', () => {
  it('are the entry and the function of the one scope a method sends, and nothing of the other scopes', () => {
    const cApi = sections('swift', symbolOf('swift', 'Server.panes()')).find((section) => section.type === 'c-api')
    if (cApi?.type !== 'c-api') throw new Error('no C API section')
    // Server.panes() sends list-panes -a: not the dispatcher, nor the session and window functions.
    expect(cApi.direct.map((item) => item.name)).toEqual(['cmd_list_panes_entry', 'cmd_list_panes_server'])
  })

  it('leave out a command the method only has an equivalent for', () => {
    // The concept map names Window.Panes the Go equivalent of list-panes, which it does not send.
    const list = sections('go', symbolOf('go', 'tmux.Window.Panes'))
    expect(list.find((section) => section.type === 'c-api')).toBeUndefined()
    expect(list.find((section) => section.type === 'commands')).toBeUndefined()
  })

  it('count a function once when a path passes through it', () => {
    const cApi = sections('ts', symbolOf('ts', 'server.Server.newSession')).find((section) => section.type === 'c-api')
    if (cApi?.type !== 'c-api') throw new Error('no C API section')
    const ids = [...cApi.direct, ...cApi.paths.flatMap((path) => path.items)].map((item) => item.id)
    expect(cApi.count).toBe(new Set(ids).size)
  })
})

describe('a note in a table of other ports', () => {
  it('is the concept\'s note, resolved against the index of the port it names', () => {
    // The first symbol whose table has a row with both a link and a note.
    const found = Object.entries(API_MODELS).flatMap(([port, model]) => model.symbols.map((symbol) => ({ port, symbol })))
      .map(({ port, symbol }) => ({ port, symbol, rows: sections(port, symbol).flatMap((section) => section.type === 'ports' ? section.groups : [])
        .flatMap((group) => group.table.groups[0].ports).filter((row) => row.links.length && row.note) }))
      .find((entry) => entry.rows.length)!
    expect(found, 'a symbol with a noted equivalent').toBeDefined()
    for (const row of found.rows) {
      expect(row.noteIndex, row.port).toBeDefined()
      expect(conceptsFor(found.port, found.symbol.publicId ?? found.symbol.id).map((concept) => concept.notes?.[row.port])).toContain(row.note)
    }
  })

  it('is plain text for a reason, with its backticks as code', async () => {
    const java = sections('ts', sendKeys).flatMap((section) => section.type === 'ports' ? section.groups : []).flatMap((group) => group.table.groups[0].ports).find((row) => row.port === 'java')!
    expect(java.noteIndex).toBeUndefined()
    const document = await html(sections('ts', sendKeys))
    expect(document.querySelector('tr[data-port="java"] .tmux-usage__note code')!.textContent).toBe('Pane.paste')
  })
})

describe('a product page', () => {
  // The equivalents a page links by the version each port's docs default to, as ProductApiPage does.
  const symbol = symbolOf('py', 'libtmux.Pane.send_keys')
  const defaults = { ts: '9.9.9' }
  const alternatives = productApiAlternatives(API_MODELS.py, symbol, 'latest', defaults)
  const linked = (list: ApiTmuxSection[]) => list.flatMap((section) => section.type === 'ports'
    ? section.groups.flatMap((group) => group.table.groups[0].ports.flatMap((row) => row.links.map((link) => link.href))) : [])

  it('writes the equivalents its HTML links, by the same version rule', () => {
    const page = linked(apiTmuxSections('py', symbol, alternatives))
    const reference = linked(apiTmuxSections('py', symbol))
    const versioned = page.filter((href) => href.includes('9.9.9'))
    expect(versioned.length, 'a ts equivalent linked by its default version').toBeGreaterThan(0)
    expect(reference.some((href) => href.includes('9.9.9'))).toBe(false)
    const text = symbolMarkdown({ model: API_MODELS.py, symbol, version: 'latest', alternatives })
    for (const href of versioned) expect(text).toContain(`](${href})`)
    // Without the alternatives the export links the reference's addresses, which is what it did before.
    expect(symbolMarkdown({ model: API_MODELS.py, symbol })).not.toContain('9.9.9')
  })

  it('is exported by the route with the alternatives the page uses', () => {
    for (const file of ['../src/components/api/ProductApiPage.astro', '../src/pages/[...slug].md.ts']) {
      expect(readFileSync(new URL(file, import.meta.url), 'utf8'), file).toContain('productApiAlternatives(')
    }
  })
})
