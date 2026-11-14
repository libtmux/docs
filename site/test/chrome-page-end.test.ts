import { describe, expect, it, vi } from 'vitest'
vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []) }))
import { buildDocumentationSurfaces, currentDocumentation, getDocumentationSurfaces, withLanguageHome } from '../src/lib/documentation-navigation'
import { GROUP_LIMIT, pageEnd, sectionPages, sequence } from '../src/lib/page-end'
import { PORT_BY_SLUG, portPageUrl, type DocProduct } from '../src/lib/ports'
import type { PagePortLink } from '../src/lib/page-port-links'
import { sidebarHead } from '../src/lib/sidebar-head'
import type { SidebarItem, SidebarLinkItem } from '../src/lib/sidebar'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'
import { parseHtml } from './header-page'

/**
 * How every page ends (design system record 0021): previous and next in the
 * sidebar's order, typed related groups that say why their entries belong, and
 * the way up, nearest level first.
 */
const page = (label: string, href: string): SidebarLinkItem => ({ type: 'link', label, href })
const GUIDES = ['Getting started', 'Sending keys', 'Capturing output']

function menus(slug: string) {
  const port = PORT_BY_SLUG[slug]!
  return Object.fromEntries(['core', 'mcp', 'workspace'].map((surface) => {
    const base = (path = '') => portPageUrl(port, 'latest', [surface === 'core' ? '' : surface, path].filter(Boolean).join('/'))
    return [surface, [page('Overview', base()), page('Guides', base('guides')),
      ...GUIDES.map((title) => page(title, base(`guides/${title.toLowerCase().replaceAll(' ', '-')}`))),
      page('API', base('reference'))] as SidebarItem[]]
  })) as Record<'core' | DocProduct, SidebarItem[]>
}
const fixture = (slug: string, path: string, pagePorts?: PagePortLink[], title = 'A page') => {
  const surfaces = withLanguageHome(slug, 'latest', buildDocumentationSurfaces(slug, 'latest', menus(slug)))
  const selected = currentDocumentation(surfaces, path)
  const head = sidebarHead(slug, 'latest', selected)
  return pageEnd({ port: slug, version: 'latest', pathname: path, surfaces, selected, head, pagePorts, title })
}
const others = (count: number): PagePortLink[] => ['py', 'ruby', 'ts', 'rs', 'java', 'lua', 'swift', 'cxx'].slice(0, count)
  .map((port) => ({ port, name: port, links: [{ href: `/${port}/latest/guides/x/` }] }))
const labels = (links: { label: string }[]) => links.map((link) => link.label)

describe('the sequence', () => {
  const pages = ['a', 'b', 'c'].map((name) => page(name.toUpperCase(), `/go/latest/guides/${name}/`))

  it('runs in the sidebar\'s order: a first page has no previous and a last page no next', () => {
    expect(sequence(pages, '/go/latest/guides/a/')).toEqual({ next: { label: 'B', href: '/go/latest/guides/b/' } })
    expect(sequence(pages, '/go/latest/guides/b/')).toEqual({ prev: { label: 'A', href: '/go/latest/guides/a/' }, next: { label: 'C', href: '/go/latest/guides/c/' } })
    expect(sequence(pages, '/go/latest/guides/c/')).toEqual({ prev: { label: 'B', href: '/go/latest/guides/b/' } })
    expect(sequence(pages, '/go/latest/guides/elsewhere/')).toEqual({})
  })

  it('walks a section\'s pages without its overview, through groups, once each', () => {
    const { surfaces } = { surfaces: buildDocumentationSurfaces('go', 'latest', menus('go')) }
    const guides = surfaces[0]!.sections.find((section) => section.id === 'guides')!
    expect(labels(sectionPages(guides))).toEqual(GUIDES)
    const grouped = { ...guides, items: [{ type: 'group' as const, label: 'Server', items: [page('x', '/x/')] }, { type: 'group' as const, label: 'Pane', items: [page('y', '/y/'), page('x', '/x/')] }] }
    expect(labels(sectionPages(grouped))).toEqual(['x', 'y'])
  })

  it('puts the previous page before the next in the block, as two cards', async () => {
    const end = fixture('go', '/go/latest/guides/sending-keys/')
    expect(labels([end.prev!, end.next!])).toEqual(['Getting started', 'Capturing output'])
    const template = await loadAstroTemplate('components/docs/PageEnd.astro', { real: ['components/StatusBadge.astro', 'components/api/ApiBadge.astro'], modules: { '../../lib/api-labels': await import('../src/lib/api-labels'), '../../lib/api-glossary': { apiGlossaryHref: () => undefined } } })
    const doc = parseHtml(await renderAstroTemplate(template, { props: { ...end } })).document
    expect(doc.querySelector('nav')!.getAttribute('aria-label')).toBe('Continue')
    const steps = [...doc.querySelectorAll('.page-end__step')]
    expect(steps.map((step) => step.getAttribute('rel'))).toEqual(['prev', 'next'])
    expect(steps.map((step) => step.querySelector('strong')!.textContent)).toEqual(['Getting started', 'Capturing output'])
  })
})

describe('the way up', () => {
  it('names every level above a page, nearest first, with the sidebar head\'s targets', () => {
    const end = fixture('go', '/go/latest/guides/sending-keys/')
    expect(end.up).toEqual([
      { label: 'Guides', href: '/go/latest/guides/' },
      { label: 'Core Library', href: '/go/latest/core/' },
      { label: 'Go', href: '/go/latest/' },
    ])
  })

  it('climbs from a section index, a product home and the port home to every language', () => {
    expect(labels(fixture('go', '/go/latest/guides/').up)).toEqual(['Core Library', 'Go'])
    expect(labels(fixture('go', '/go/latest/core/').up)).toEqual(['Go', 'All languages'])
    expect(fixture('go', '/go/latest/').up).toEqual([{ label: 'All languages', href: '/' }])
  })

  it('is a list named "Up" in the rendered block', async () => {
    const template = await loadAstroTemplate('components/docs/PageEnd.astro', { real: ['components/StatusBadge.astro'] })
    const doc = parseHtml(await renderAstroTemplate(template, { props: { ...fixture('go', '/go/latest/core/') } })).document
    expect(doc.querySelector('ul[aria-label="Up"]')!.querySelectorAll('li a').length).toBe(2)
  })
})

describe('the other levels', () => {
  it('sends a product home on to its first page and lists the other products with their maturity', () => {
    const end = fixture('go', '/go/latest/core/')
    expect(end.prev).toBeUndefined()
    expect(end.next).toEqual({ label: 'Getting started', href: '/go/latest/guides/getting-started/' })
    const group = end.groups.find((entry) => entry.id === 'products')!
    expect(group.title).toBe('Also in Go')
    expect(group.items).toMatchObject([{ label: 'MCP', status: 'concept' }, { label: 'Workspace Manager', status: 'concept' }])
  })

  it('lists the other sections on a section index, and other languages on the port home', () => {
    const sections = fixture('go', '/go/latest/guides/').groups.find((entry) => entry.id === 'sections')!
    expect(sections.items.map((item) => item.label)).not.toContain('Guides')
    expect(sections.count).toBe(sections.items.length)
    const home = fixture('go', '/go/latest/').groups.find((entry) => entry.id === 'languages')!
    expect(home.items[0]!.href).toBe('/')
    expect(home.count).toBeGreaterThanOrEqual(21)
  })
})

describe('typed groups', () => {
  const guide = '/go/latest/guides/capturing-output/'

  it('lists the APIs the page names, the tmux commands they send and the tool that is the same operation', () => {
    const end = fixture('go', guide, others(7), 'Capturing output')
    const by = (id: string) => end.groups.find((group) => group.id === id)!
    expect(labels(by('apis').items)).toContain('tmux.Pane.Capture')
    expect(by('apis').count).toBe(4)
    expect(by('apis').items.every((item) => item.href.startsWith('/go/latest/reference/'))).toBe(true)
    expect(labels(by('commands').items)).toContain('capture-pane')
    expect(by('commands').items[0]).toMatchObject({ kind: 'command', href: '/tmux/latest/manual/capture-pane/' })
    expect(by('mcp').items).toContainEqual({ label: 'capture_pane', href: '/go/latest/mcp/tools/capture_pane/', kind: 'tool', code: true })
    // Each group says why its entries belong.
    for (const group of end.groups) expect(group.why, group.id).not.toBe('')
  })

  it('keeps Other languages to one link with the count, to the parity view', () => {
    const group = fixture('go', guide, others(7), 'Capturing output').groups.find((entry) => entry.id === 'languages')!
    expect(group.count).toBe(7)
    expect(group.items).toEqual([{ label: 'Capturing output in 7 other languages', href: '/meta/parity/' }])
  })

  it('shows four entries at most, and leaves a group out when it has none', () => {
    expect(GROUP_LIMIT).toBe(4)
    for (const group of fixture('go', guide, others(7)).groups) expect(group.items.length).toBeLessThanOrEqual(GROUP_LIMIT)
    // A page that names no API and has no equivalent elsewhere ends on the sequence and the ladder.
    const bare = fixture('go', '/go/latest/guides/getting-started/', [])
    expect(bare.groups.map((group) => group.id)).not.toContain('languages')
    expect(fixture('go', '/go/latest/guides/sending-keys/', []).groups.filter((group) => !group.items.length)).toEqual([])
  })

  it('renders at most four entries however many a group holds', async () => {
    const template = await loadAstroTemplate('components/docs/PageEnd.astro', { real: ['components/StatusBadge.astro'] })
    const items = Array.from({ length: 7 }, (_, index) => ({ label: `item ${index}`, href: `/x/${index}/` }))
    const doc = parseHtml(await renderAstroTemplate(template, { props: { groups: [{ id: 'x', title: 'Group', why: 'Because.', items }], up: [] } })).document
    expect(doc.querySelectorAll('.page-end__group li').length).toBe(4)
  })

  it('ends an MCP tool on the other servers that advertise it, and orders its sequence by the tool groups', async () => {
    const surfaces = await getDocumentationSurfaces('go', 'latest')
    const path = '/go/latest/mcp/tools/capture_pane/'
    const selected = currentDocumentation(surfaces, path)
    const end = pageEnd({ port: 'go', version: 'latest', pathname: path, surfaces, selected, head: sidebarHead('go', 'latest', selected), title: 'capture_pane' })
    expect(labels(end.up)).toEqual(['Tools', 'MCP', 'Go'])
    expect(end.prev && end.next).toBeTruthy()
    const languages = end.groups.find((group) => group.id === 'languages')!
    expect(languages.title).toBe('Other languages')
    expect(languages.count).toBeGreaterThan(0)
    expect(languages.items[0]!.label).toMatch(/^capture_pane in \d+ other servers?$/)
  })
})
