import { describe, expect, it, vi } from 'vitest'
import versions from '../public/versions.json'
import { PORTS } from '../src/lib/ports'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

/** Search results cut a description off near this length. */
const MAX_LENGTH = 160

/** Names `name` as a word of its own: `Go` is not `Google`, `C` is not `C++`. */
const names = (text: string, name: string) =>
  new RegExp(`(?<![\\w#+])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w#+])`).test(text)

/** How many of the site's ports a description names. */
const portsNamed = (text: string) => PORTS.filter((port) => names(text, port.name)).length

/** The `description` the English landing page hands to its layout. */
async function englishDescription(): Promise<string> {
  vi.stubEnv('LIBTMUX_DOCS_PORT', '')
  vi.stubEnv('LIBTMUX_DOCS_LOCALE', 'en')
  const page = await loadAstroTemplate('pages/index.astro', {
    stubs: { 'layouts/BaseLayout.astro': '---\nconst { description } = Astro.props\n---\n<meta name="description" content={description} />' },
    modules: {
      'astro:content': { getCollection: async () => [], render: async () => ({}) },
      '../i18n/resolve': { ALL_TRANSLATED: {}, buildLocale: () => 'en', localesFor: async () => ['en'] },
      '../lib/documentation-navigation': { getDocumentationSurfaces: async () => [] },
    },
  })
  const html = await renderAstroTemplate(page, { url: 'https://libtmux.org/en/' })
  return /<meta name="description" content="([^"]*)"/.exec(html)![1]!.replaceAll('&#39;', "'").replaceAll('&amp;', '&')
}

describe('landing page description', () => {
  it('holds the same ports in ports.ts and versions.json', () => {
    expect(Object.keys(versions.ports).sort()).toEqual(PORTS.map((port) => port.slug).sort())
  })

  it('names every port or none in English, so no list can fall behind', async () => {
    const description = await englishDescription()
    expect([0, PORTS.length], description).toContain(portsNamed(description))
  })

  it('fits a search result in English', async () => {
    expect((await englishDescription()).length).toBeLessThanOrEqual(MAX_LENGTH)
  })
})
