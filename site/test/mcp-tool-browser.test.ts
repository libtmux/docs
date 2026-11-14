import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'
import { createComponent, render } from 'astro/compiler-runtime'
vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []) }))
import { loadAstroTemplate, renderAstroTemplate, withoutScope } from './astro-templates'
import { API_MODELS } from '../src/lib/api-models'
import { MCP_REFERENCE, mcpObjects, mcpWraps, type McpSection } from '../src/lib/mcp-reference'
import { TIERS, mcpToolFacts, toolCapability } from '../src/lib/mcp-showcase'

/**
 * The MCP tool browser (tools index and tool pages, `components/mcp/ProtocolReference.astro`): a tier on every
 * tool and a filter by tier, the capability row beside the annotations, and a link to the library call a tool
 * wraps. A server that names no toolset gets none of these, and no port's annotations are changed.
 */
const options = {
  real: [
    'layouts/DocsLayout.astro', 'components/docs/Sidebar.astro', 'components/docs/SidebarSection.astro', 'components/docs/SidebarLink.astro',
    'components/docs/DocumentationNavigationButtons.astro', 'components/PageToolbar.astro', 'components/api/ApiBadge.astro', 'components/api/SymbolName.astro',
  ],
  stubs: {
    'layouts/BaseLayout.astro': '<slot name="context" /><slot />',
    'components/docs/DocumentationContext.astro': '<slot name="navigation" />',
  },
  modules: { 'astro-expressive-code/components': { Code: createComponent(() => render`<pre></pre>`) } },
}

let template: Awaited<ReturnType<typeof loadAstroTemplate>>
beforeAll(async () => { template = await loadAstroTemplate('components/mcp/ProtocolReference.astro', options) })

async function page(port: string, section: McpSection, toolName?: string) {
  const object = toolName ? mcpObjects(port).find((entry) => entry.name === toolName)! : undefined
  const window = new Window()
  window.document.body.innerHTML = withoutScope(await renderAstroTemplate(template, { url: `https://libtmux.org/${port}/next/${object?.path ?? `mcp/${section}`}/`, props: { port, version: 'next', section, itemSlug: object?.slug } }))
  return window.document as unknown as Document
}

describe('the tools index', () => {
  it('shows each tool\'s tier as a square badge on its card and filters by tier with radio buttons that work without script', async () => {
    const document = await page('go', 'tools')
    const cards = [...document.querySelectorAll<HTMLElement>('.mcp-tool-card')]
    const { capabilities } = await mcpToolFacts('go')
    expect(cards).toHaveLength(mcpObjects('go').filter((entry) => entry.kind === 'tool').length)
    for (const card of cards) {
      const name = card.id.replace(/^mcp\.tool\./, '')
      const tier = capabilities.get(name)!.toolset!
      expect(card.dataset.tier, name).toBe(tier)
      expect(card.querySelector(`.mcp-tool-card__tier.mcp-tier--${tier}`)?.textContent, name).toBe(TIERS.find((entry) => entry.id === tier)!.label)
    }
    const filter = document.querySelector('[data-mcp-tier-filter]')!
    const radios = [...filter.querySelectorAll<HTMLInputElement>('input[type="radio"][name="tier"]')]
    expect(radios.map((radio) => radio.value)).toEqual(['all', ...TIERS.map((tier) => tier.id)])
    expect(radios.filter((radio) => radio.checked).map((radio) => radio.value), 'all tools until a tier is chosen').toEqual(['all'])
    const counts = radios.map((radio) => Number(radio.parentElement!.querySelector('small')!.textContent))
    expect(counts[0]).toBe(cards.length)
    expect(counts.slice(1).reduce((sum, n) => sum + n, 0), 'each tool is in one tier').toBe(cards.length)
    expect(filter.getAttribute('role')).toBe('group')
    expect(filter.closest('[data-pagefind-ignore]'), 'out of search').not.toBeNull()
  })

  it('gives each group a count for each tier it holds, so a filtered group counts its own', async () => {
    const document = await page('go', 'tools')
    for (const group of document.querySelectorAll('.mcp-group')) {
      const total = Number(group.querySelector('[data-count="all"]')!.textContent!.split(' ')[0])
      const tiers = [...group.querySelectorAll('.mcp-count:not([data-count="all"])')]
      expect(tiers.reduce((sum, count) => sum + Number(count.textContent!.split(' ')[0]), 0)).toBe(total)
      expect(group.querySelectorAll('.mcp-tool-card')).toHaveLength(total)
    }
  })

  it('opens each card on what the tool does, which the safety class its description opens with is not', async () => {
    const document = await page('go', 'tools')
    const card = [...document.querySelectorAll('.mcp-tool-card')].find((entry) => entry.querySelector('.api-index-card__link')!.textContent!.includes('capture_pane'))!
    expect(card.textContent).toContain('Returns bounded pane content and a cursor.')
    expect(card.textContent, 'the capability opener stays on the tool\'s page').not.toContain('accepts no client-supplied executable input')
  })

  it.each(['ruby', 'julia'])('shows %s, whose server names no toolset, with no tier, no filter and no guessed tier', async (port) => {
    expect((await mcpToolFacts(port)).capabilities.size).toBeGreaterThan(0)
    const document = await page(port, 'tools')
    expect(document.querySelector('[data-mcp-tier-filter], .mcp-tool-card__tier, [data-tier]')).toBeNull()
  })

  it('has a stylesheet that filters on each tier, hides the groups left empty, and shows the chosen tier\'s counts', () => {
    const source = readFileSync(new URL('../src/components/mcp/ProtocolReference.astro', import.meta.url), 'utf8')
    const lacking = (css: string) => TIERS.filter(({ id }) => ![
      `:has(input[name='tier'][value='${id}']:checked) .mcp-tool-card:not([data-tier='${id}'])`,
      `.mcp-group:not(:has(.mcp-tool-card[data-tier='${id}']))`,
      `:has(input[name='tier'][value='${id}']:checked) .mcp-count[data-count='${id}']`,
      `:has(input[name='tier'][value='${id}']:checked) .mcp-count[data-count='all']`,
    ].every((rule) => css.includes(rule))).map(({ id }) => id)
    expect(lacking(source)).toEqual([])
    // Control: a stylesheet without one tier's rules is the one this check reports.
    expect(lacking(source.replaceAll("[value='manage']", "[value='other']"))).toEqual(['manage'])
  })
})

describe('a tool page', () => {
  it('shows the tier beside the kind and links it to the index on that tier', async () => {
    const document = await page('go', 'tools', 'capture_pane')
    const badge = document.querySelector<HTMLAnchorElement>('.gp-sphinx-api-layout-right .mcp-tier')!
    expect(badge.textContent).toBe('Inspect')
    expect(badge.getAttribute('href')).toBe('/go/next/mcp/tools/?tier=inspect')
    expect(badge.classList.contains('mcp-tier--inspect')).toBe(true)
  })

  it('puts the capability row beside the annotations, with the toolset, process reach and tmux effects the server states', async () => {
    const document = await page('go', 'tools', 'send_keys')
    const capability = document.querySelector('[data-mcp-capability]')!
    expect(capability.closest('section')!.querySelector('.mcp-safety')!.children).toHaveLength(2)
    const rows = Object.fromEntries([...capability.querySelectorAll('dt')].map((term) => [term.textContent, term.nextElementSibling!.textContent!.replace(/\s+/g, ' ').trim()]))
    expect(rows['Toolset']).toMatch(/^Execute/)
    expect(rows['Process reach']).toBe('pane-input')
    expect(rows['tmux effects']).toBe('observe change')
    expect(document.querySelector('.mcp-safety__column:not([data-mcp-capability]) h3')!.textContent).toBe('Advertised by the server')
  })

  it('says the annotations cannot tell tools apart where every tool of the port advertises the same ones, and does not elsewhere', async () => {
    const same = (port: string) => new Set(mcpObjects(port).filter((entry) => entry.kind === 'tool').map((entry) => JSON.stringify(Object.entries(entry.tool!.annotations ?? {}).filter(([name]) => name !== 'title').sort(([a], [b]) => a.localeCompare(b))))).size === 1
    for (const port of ['go', 'rs']) {
      const note = (await page(port, 'tools', 'capture_pane')).querySelector('.mcp-safety__note')!.textContent!
      expect(/cannot tell tools apart/.test(note), `${port} advertises ${same(port) ? 'the same' : 'different'} annotations`).toBe(same(port))
    }
  })

  it('shows each port\'s annotations as the port advertises them', async () => {
    for (const port of ['go', 'rs', 'ts']) {
      const tool = mcpObjects(port).find((entry) => entry.name === 'capture_pane')!.tool!
      const document = await page(port, 'tools', 'capture_pane')
      const shown = Object.fromEntries([...document.querySelectorAll('.mcp-safety__column:not([data-mcp-capability]) dt')].map((term) => [term.textContent, JSON.parse(term.nextElementSibling!.textContent!)]))
      expect(shown, port).toEqual(tool.annotations)
    }
  })

  it('has no capability row for a server that states none, and no Wraps row for a tool with no recorded call', async () => {
    const ruby = await page('ruby', 'tools', mcpObjects('ruby').find((entry) => entry.kind === 'tool')!.name)
    expect(ruby.querySelector('[data-mcp-capability], .mcp-tier')).toBeNull()
    const list = await page('go', 'tools', 'list_sessions')
    expect([...list.querySelectorAll('dt')].map((term) => term.textContent)).not.toContain('Wraps')
  })
})

describe('the library call a tool wraps', () => {
  it('links the call and cites the line of the server that makes it', async () => {
    const document = await page('go', 'tools', 'capture_pane')
    const term = [...document.querySelectorAll('dt')].find((entry) => entry.textContent === 'Wraps')!
    const [call, source] = [...term.nextElementSibling!.querySelectorAll('a')]
    expect([call!.textContent, call!.getAttribute('href')]).toEqual(['tmux.Pane.Capture', '/go/next/reference/tmux-pane-capture/'])
    expect(source!.getAttribute('href')).toBe('https://github.com/libtmux/libtmux-go/blob/2de249b600d65218ee8b8fdc07c6b2b919242151/mcp/capture_tools.go#L67')
  })

  it('records only calls that are in the port\'s API model, for tools the port registers', () => {
    const data = JSON.parse(readFileSync(new URL('../src/data/mcp-wraps.json', import.meta.url), 'utf8')) as Record<string, { revision: string; tools: Record<string, { call: string; source: string }> }>
    for (const [port, entry] of Object.entries(data)) {
      expect(MCP_REFERENCE[port]!.revision, `${port}: recorded at the documented revision`).toBe(entry.revision)
      for (const [tool, wrapped] of Object.entries(entry.tools)) {
        expect(mcpObjects(port).some((object) => object.name === tool), `${port} ${tool} is registered`).toBe(true)
        expect(API_MODELS[port]!.symbols.some((symbol) => (symbol.publicId ?? symbol.id) === wrapped.call), `${port} ${tool} wraps ${wrapped.call}`).toBe(true)
        expect(wrapped.source).toMatch(/^mcp\/[\w.]+:\d+$/)
        expect(mcpWraps(port, tool)).toMatchObject({ call: wrapped.call })
      }
    }
  })

  it('has a control: a call the model lacks is reported', () => {
    expect(API_MODELS['go']!.symbols.some((symbol) => (symbol.publicId ?? symbol.id) === 'tmux.Pane.NoSuchCall')).toBe(false)
  })
})

describe('the capability a tool\'s metadata states', () => {
  it('reads the toolset from either server\'s metadata, and nothing for one that states none', () => {
    const meta = { 'com.git-pull.libtmux-mcp/capability': { toolset: 'manage', processReach: 'none', tmuxEffects: ['change'] } }
    expect(toolCapability({ _meta: meta })).toEqual({ toolset: 'manage', processReach: 'none', tmuxEffects: ['change'] })
    expect(toolCapability({ _meta: { fastmcp: { tags: ['teardown'] } } })).toEqual({ toolset: 'teardown' })
    expect(toolCapability({})).toEqual({})
  })
})

describe('one concept banner', () => {
  const css = readFileSync(new URL('../src/components/ProductNotice.astro', import.meta.url), 'utf8')
  const rule = /html:not\(\[data-product-notice-dismissed~='mcp-concept'\]\) \.prerelease-notice\[data-prerelease-notice\]:has\(~ \.product-notice\[data-product-notice='mcp-concept'\]\) \{ display: none; \}/

  it('hides the site\'s release bar above an MCP concept note until the note is dismissed', () => {
    expect(css).toMatch(rule)
    // Control: the rule does not reach the Workspace Manager's note, which this change leaves alone.
    expect(css.replace(/mcp-concept/g, 'workspace-concept')).not.toMatch(rule)
  })
})
