import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { PORTS, type Port } from '../src/lib/ports'
import { loadAstroTemplate, renderAstroTemplate, withoutScope } from './astro-templates'

// The registry marks are drawn by RegistryIcon. This stub records which mark and
// whether it was decorative, so the fixture holds PortLinks' decisions and not SVG paths.
const iconStub = `---
const { icon, decorative } = Astro.props
---
<i data-icon={icon} data-decorative={decorative ? 'true' : undefined}></i>`

const REVISION = 'a1b2c3d4e5f6'
const TMUX = { name: 'tmux', repo: 'tmux/tmux', homepage: 'https://github.com/tmux/tmux/wiki' }

interface Case { id: string; props: Record<string, unknown> }

function cases(): Case[] {
  const all: Case[] = []
  const add = (id: string, props: Record<string, unknown>) => all.push({ id, props: { class: 'mt-3', ...props } })
  const bySlug = (slug: string) => PORTS.find((port) => port.slug === slug) as Port

  for (const port of PORTS) {
    add(port.slug, { port, version: 'latest' })
    add(`${port.slug} v1.2.3 @revision`, { port, version: 'v1.2.3', revision: REVISION })
  }
  // Ports with a library directory or tag prefix change their source link with the ref.
  for (const slug of ['powershell', 'julia', 'elixir', 'kotlin', 'scala', 'rs']) {
    const port = bySlug(slug)
    add(`${slug} v1.2.3`, { port, version: 'v1.2.3' })
    add(`${slug} stable`, { port, version: 'stable' })
    add(`${slug} latest @revision`, { port, version: 'latest', revision: REVISION })
  }
  for (const port of PORTS.filter((entry) => entry.packages?.some(({ id }) => id === 'mcp' || id === 'workspace'))) {
    for (const product of ['mcp', 'workspace']) {
      add(`${port.slug} ${product}`, { port, product, version: 'latest' })
      add(`${port.slug} ${product} v1.2.3 @revision`, { port, product, version: 'v1.2.3', revision: REVISION })
    }
  }
  add('ts mcp v1.2.3', { port: bySlug('ts'), product: 'mcp', version: 'v1.2.3' })
  add('py workspace v1.2.3', { port: bySlug('py'), product: 'workspace', version: 'v1.2.3' })
  add('lua mcp (no package)', { port: bySlug('lua'), product: 'mcp', version: 'latest' })
  add('kotlin workspace v1.2.3 (no package)', { port: bySlug('kotlin'), product: 'workspace', version: 'v1.2.3' })
  add('tmux project', { project: TMUX })
  return all
}

let render: (props: Record<string, unknown>) => Promise<string>

beforeAll(async () => {
  const template = await loadAstroTemplate('components/PortLinks.astro', {
    stubs: { 'components/icons/RegistryIcon.astro': iconStub },
  })
  render = async (props) => withoutScope(await renderAstroTemplate(template, { props })).trim()
})

describe('PortLinks destinations', () => {
  // Captured from the component before its URL rules moved into `portDestinations`.
  const fixture: Record<string, string> = JSON.parse(readFileSync(new URL('./fixtures/port-links.json', import.meta.url), 'utf8'))

  it('covers every case in the fixture and nothing else', () => {
    expect(cases().map(({ id }) => id)).toEqual(Object.keys(fixture))
  })

  it.each(cases().map(({ id, props }) => [id, props] as const))('renders %s exactly as before', async (id, props) => {
    expect(await render(props)).toBe(fixture[id])
  })
})
