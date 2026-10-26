import { experimental_AstroContainer } from 'astro/container'
import { Window, type Document } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { conceptsFor, type ApiSymbol } from '@libtmux/api-model'
import mentions from '../src/data/mentions.json'
import { API_MODELS } from '../src/lib/api-models'
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
    for (const [i, concept] of conceptsFor('ts', 'pane.Pane.sendKeys').entries()) {
      const table = ports.groups[i].table
      const rows = table.groups[0].ports
      const absent = others.filter((port) => !concept.symbols[port] && !concept.absent?.[port])
      // A reason stays on its own row; only the languages without one are collapsed.
      expect(rows.filter((row) => !row.links.length).map((row) => row.port).sort()).toEqual(others.filter((port) => !concept.symbols[port] && concept.absent?.[port]).sort())
      for (const row of rows.filter((row) => !row.links.length && !concept.symbols[row.port])) expect(row.note).toBe(concept.absent![row.port])
      expect(table.absent).toBe(absent.length ? expect.stringContaining('No equivalent in') : null)
      linked += rows.filter((row) => row.links.length).length
    }
    expect(linked).toBeGreaterThan(0)
    expect(ports.count).toBe(linked)
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
    expect(path.from.name).toBe('cmd_new_session_exec')
    expect(path.items.map((item) => [item.name, item.degree, item.kind])).toEqual([
      ['spawn_window', 2, 'function'], ['spawn_pane', 3, 'function'], ['window_add_pane', 4, 'function'], ['window_pane_create', 5, 'function'],
    ])
    const model = tmuxSourceModel('latest')
    for (const item of path.items) expect(item.href).toBe(tmuxReferenceUrl('latest', model.symbols.find((entry) => entry.id === item.id)!))
    expect(cApi.count).toBe(cApi.direct.length + path.items.length)
  })

  it('shows only the degree-1 functions of a command with no curated path', () => {
    const cApi = sections('ts', sendKeys).find((section) => section.type === 'c-api')
    expect(cApi?.type === 'c-api' && cApi.paths).toEqual([])
  })

  it('writes the path in HTML and in Markdown alike', async () => {
    const symbol = symbolOf('ts', 'server.Server.newSession')
    const document = await html(sections('ts', symbol))
    const cApi = document.querySelector('#api-tmux-c-api')!.closest('section')!
    expect(cApi.querySelector('h3')!.textContent).toBe('Create a session and its first pane')
    expect([...cApi.querySelectorAll('.tmux-usage__when')].map((note) => note.textContent)).toContain('degree 5, from cmd_new_session_exec')
    const text = symbolMarkdown({ model: API_MODELS.ts, symbol })
    const body = text.split('## tmux C API\n')[1].split('\n## ')[0]
    expect(body).toContain('### Create a session and its first pane')
    expect(body).toMatch(/- \[`window_pane_create`\]\(\/tmux\/latest\/reference\/c-function-window-c-window_pane_create\/\) \(function\), degree 5, from `cmd_new_session_exec`/)
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
