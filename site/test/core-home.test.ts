import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseFrontmatter } from '@astrojs/markdown-remark'
import { CAPABILITIES, CORE_HOME, CORE_ROLES, coreDescription, coreHomeHeadings, coreTitle, coreHomeMarkdown, resolveCoreHome } from '../src/lib/core-home'
import { API_MODELS } from '../src/lib/api-models'
import { PORTS } from '../src/lib/ports'

const page = (port: string) => new URL(`../src/content/docs/ports/${port}/core/index.md`, import.meta.url)

describe('Core Library home data', () => {
  it('has an entry and a page for every port', () => {
    expect(Object.keys(CORE_HOME).sort()).toEqual(PORTS.map((port) => port.slug).sort())
    for (const port of PORTS) expect(existsSync(page(port.slug)), port.slug).toBe(true)
  })

  it.each(PORTS.map((port) => port.slug))('resolves every %s symbol to a reference page', (slug) => {
    const home = resolveCoreHome(slug, 'latest')
    expect(home.objects.map((object) => object.role)).toEqual([...CORE_ROLES])
    const slugs = new Set(API_MODELS[slug].symbols.map((symbol) => symbol.slug))
    const prefix = `/${slug}/latest/reference/`
    for (const row of [...home.objects, ...Object.values(home.capabilities).flat()]) {
      expect(row.href, row.id).toContain(prefix)
      expect(slugs.has(row.href.slice(row.href.indexOf(prefix) + prefix.length).replace(/\/$/, '')), row.id).toBe(true)
    }
    expect(coreHomeMarkdown(slug, 'latest', 'https://libtmux.org')).toContain('## At a glance')
    expect(coreHomeHeadings(slug, 'latest').map((heading) => heading.slug)).toContain('at-a-glance')
  })

  it('lists a capability only for the ports that have one', () => {
    expect(CORE_HOME.py!.capabilities).not.toHaveProperty('async')
    expect(CORE_HOME.go!.capabilities).not.toHaveProperty('async')
    expect(resolveCoreHome('py', 'latest').capabilities.cli.map((row) => row.key)).not.toContain('async')
    for (const entry of Object.values(CORE_HOME)) for (const key of Object.keys(entry.capabilities)) expect(CAPABILITIES).toHaveProperty(key)
  })

  it('fails on a missing symbol, a missing type and an unknown capability', () => {
    const rs = CORE_HOME.rs!
    expect(() => resolveCoreHome('rs', 'latest', { ...rs, objects: { ...rs.objects, pane: 'pane.NoSuchPane' } }))
      .toThrow(/pane.NoSuchPane, which is not in its API model/)
    expect(() => resolveCoreHome('rs', 'latest', { ...rs, objects: { ...rs.objects, window: '' } })).toThrow(/names no window type/)
    expect(() => resolveCoreHome('rs', 'latest', { ...rs, capabilities: { ...rs.capabilities, queries: 'query.Gone' } }))
      .toThrow(/query.Gone/)
    expect(() => resolveCoreHome('rs', 'latest', { ...rs, capabilities: { telepathy: 'pane.Pane' } as never }))
      .toThrow(/unknown capability telepathy/)
    expect(() => resolveCoreHome('rs', 'latest', { ...rs, objects: { ...rs.objects, server: 'libtmux.server.Server' } }))
      .toThrow(/not in its API model/)
  })

  it('links the guides the page cards name, and only the ones that exist', () => {
    for (const port of PORTS) {
      const { frontmatter } = parseFrontmatter(readFileSync(page(port.slug), 'utf8'), { frontmatter: 'remove' })
      const hrefs = (frontmatter.cards as { href: string }[]).map((card) => card.href)
      expect(frontmatter).toMatchObject({ port: port.slug, route: 'core', title: coreTitle(port.slug), description: coreDescription(port.slug) })
      expect(hrefs, port.slug).toContain('../reference/')
      expect(hrefs.includes('../topics/'), port.slug).toBe(!port.parentLibrary)
      for (const name of ['getting-started', 'testing-with-libtmux']) {
        const file = new URL(`../src/content/docs/ports/${port.slug}/guides/${name}.md`, import.meta.url)
        expect(hrefs.includes(`../guides/${name}/`), `${port.slug} ${name}`).toBe(existsSync(file))
      }
    }
  })
})

describe('Core Library home page', () => {
  it.each(['rs', 'py', 'kotlin'])('renders the %s page in the Python front page order', async (slug) => {
    const { Window } = await import('happy-dom')
    const { createComponent, renderTemplate } = await import('astro/runtime/server/index.js')
    const { loadAstroTemplate, renderAstroTemplate } = await import('./astro-templates')
    const Code = createComponent((_result: unknown, props: { code: string }) => renderTemplate`<pre data-code>${props.code}</pre>`)
    const template = await loadAstroTemplate('components/CoreHome.astro', {
      stubs: {
        'components/HomeExample.astro': '---\n---\n<div data-example />',
        'components/CoreShowcase.astro': '---\n---\n<div data-showcase />',
        'components/DocCard.astro': '---\nconst { label } = Astro.props\n---\n<a data-card>{label}</a>',
      },
      modules: { 'astro-expressive-code/components': { Code } },
    })
    const window = new Window()
    window.document.body.innerHTML = await renderAstroTemplate(template, {
      url: `https://libtmux.org/${slug}/latest/core/`,
      props: { port: slug, version: 'latest', cards: [{ label: 'Guides', href: '../guides/', body: 'Guides.' }] },
    })
    const doc = window.document as unknown as Document
    const home = resolveCoreHome(slug, 'latest')
    expect(doc.querySelector('p')!.textContent).toBe(coreDescription(slug))
    expect(doc.querySelector('[data-card]')).not.toBeNull()
    expect(doc.body.textContent).not.toMatch(/Documentation version/)
    const order = [...doc.querySelectorAll('h2')].map((heading) => heading.id)
    expect(order.slice(0, 3)).toEqual(['install', 'at-a-glance', 'what-it-does'])
    expect(doc.querySelectorAll('[data-code]').length, 'one install block, not a card in a card').toBeGreaterThanOrEqual(1)
    expect([...doc.querySelectorAll('[data-core-home-objects] tr[data-role]')].map((row) => row.getAttribute('data-role'))).toEqual([...CORE_ROLES])
    const hrefs = [...doc.querySelectorAll('[data-core-home-objects] a, [data-core-home-capabilities] a')].map((a) => a.getAttribute('href'))
    const listed = [...home.capabilities.typed, ...home.capabilities.cli].filter((row) => row.key !== 'current-pane' && row.key !== 'test-fixtures')
    expect(hrefs).toEqual([...home.objects, ...listed].map((row) => row.href))
  })
})

describe('the one-sentence definition', () => {
  it('opens like the maintainer wrote it and lists only what the port backs', () => {
    expect(coreDescription('cxx')).toMatch(/^tmux client library for C\+\+\. Control tmux, connect to and create servers, navigate sessions, windows, and panes, send keys, watch for changes via control mode, capture pane contents$/)
    for (const port of PORTS) {
      const entry = CORE_HOME[port.slug]!
      const sentence = coreDescription(port.slug)
      expect(sentence.startsWith(`${coreTitle(port.slug)}. Control tmux, `), port.slug).toBe(true)
      expect(sentence.includes('connect to and create servers'), `${port.slug} servers`).toBe('servers' in entry.capabilities)
      expect(sentence.includes('send keys'), `${port.slug} send keys`).toBe('send-keys' in entry.capabilities)
      expect(sentence.includes('via control mode'), `${port.slug} control mode`).toBe('control-mode' in entry.capabilities)
      expect(sentence.includes('capture pane contents'), `${port.slug} capture`).toBe('capture' in entry.capabilities)
    }
    const rs = CORE_HOME.rs!
    const { servers: _a, 'control-mode': _b, ...rest } = rs.capabilities
    const trimmed = coreDescription('rs', { ...rs, capabilities: rest })
    expect(trimmed).not.toMatch(/servers\b.*navigate|control mode/)
    expect(trimmed).toBe('tmux client library for Rust. Control tmux, navigate sessions, windows, and panes, send keys, capture pane contents')
  })
})

describe('capability evidence', () => {
  it('rejects a real symbol that does not back the capability', () => {
    const rs = CORE_HOME.rs!
    const wrong = (key: string, id: string) => resolveCoreHome('rs', 'latest', { ...rs, capabilities: { ...rs.capabilities, [key]: id } as never })
    expect(() => wrong('ids', 'server.Server.panes')).toThrow(/not an ID type or accessor/)
    expect(() => wrong('version-gate', 'server.Server.panes')).toThrow(/not a version or unsupported-feature error/)
    expect(() => wrong('current-pane', 'server.Server.panes')).toThrow(/not an environment constructor/)
    expect(() => wrong('async', 'target.PaneId')).toThrow(/not an async, suspend, Promise or Task signature/)
    expect(() => wrong('errors', 'pane.Pane')).toThrow(/not an error, exception or failure type/)
    expect(() => wrong('objects', 'server.Server.panes')).toThrow(/not a type or cmdlet/)
    expect(() => wrong('queries', 'pane.Pane')).toThrow(/not a filter, query or selection/)
    expect(() => wrong('traversal', 'pane.Pane')).toThrow(/not a panes, windows, sessions or snapshot accessor/)
    expect(() => wrong('argv', 'pane.Pane')).toThrow(/not a command or run symbol/)
    expect(() => wrong('test-fixtures', 'pane.Pane')).toThrow(/not a test or fixture symbol/)
  })
})
