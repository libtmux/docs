import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseFrontmatter } from '@astrojs/markdown-remark'
import { CAPABILITIES, CORE_HOME, CORE_ROLES, coreHomeHeadings, coreHomeMarkdown, resolveCoreHome } from '../src/lib/core-home'
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
    expect(coreHomeMarkdown(slug, 'latest', 'https://libtmux.org')).toContain('## Structure')
    expect(coreHomeHeadings(slug, 'latest').map((heading) => heading.slug)).toContain('structure')
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
      expect(frontmatter).toMatchObject({ port: port.slug, route: 'core', title: 'Core Library' })
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
  it.each(['rs', 'py', 'kotlin'])('renders the %s types and capabilities as links to the reference', async (slug) => {
    const { Window } = await import('happy-dom')
    const { loadAstroTemplate, renderAstroTemplate } = await import('./astro-templates')
    const template = await loadAstroTemplate('components/CoreHome.astro', {
      stubs: { 'components/HomeExample.astro': '---\n---\n<div data-example />', 'components/widgets/PackageInstall.astro': '---\n---\n<div data-install />' },
    })
    const window = new Window()
    window.document.body.innerHTML = await renderAstroTemplate(template, { url: `https://libtmux.org/${slug}/latest/core/`, props: { port: slug, version: 'latest' } })
    const doc = window.document as unknown as Document
    const home = resolveCoreHome(slug, 'latest')
    expect([...doc.querySelectorAll('[data-core-home-objects] tr[data-role]')].map((row) => row.getAttribute('data-role'))).toEqual([...CORE_ROLES])
    const hrefs = [...doc.querySelectorAll('[data-core-home-objects] a, [data-core-home-capabilities] a')].map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual([...home.objects, ...home.capabilities.typed, ...home.capabilities.cli].map((row) => row.href))
    expect(doc.querySelectorAll('[data-install]')).toHaveLength(1)
  })
})
