import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []) }))
import { Window, type HTMLAnchorElement } from 'happy-dom'
import { installExternalLinks } from '../public/_shell/external-links.js'
import { buildDocumentationSurfaces } from '../src/lib/documentation-navigation'
import type { SidebarItem } from '../src/lib/sidebar'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

const windows: Window[] = []
const disposals: (() => void)[] = []
afterEach(async () => {
  disposals.splice(0).forEach((dispose) => dispose())
  for (const win of windows.splice(0)) await win.happyDOM.abort()
  vi.unstubAllEnvs()
})

let template: unknown
beforeAll(async () => {
  template = await loadAstroTemplate('components/docs/SurfacePicker.astro', { real: ['components/docs/DocumentationIcon.astro'] })
})

const link = (label: string, href: string): SidebarItem => ({ type: 'link', label, href })

describe('the documentation picker marks an external reference once', () => {
  it('leaves the glyph to the shared link hint and keeps the link name', async () => {
    vi.stubEnv('LIBTMUX_DOCS_BASE', '/')
    vi.stubEnv('LIBTMUX_DOCS_PORT', '')
    const core = [link('API reference', '/py/latest/reference/'), link('Upstream reference', '/py/latest/api/'),
      { type: 'link', label: 'docs.rs', href: 'https://docs.rs/libtmux', external: true } as SidebarItem]
    const html = await renderAstroTemplate(template, {
      url: 'https://libtmux.org/py/latest/reference/',
      props: { surfaces: buildDocumentationSurfaces('py', 'latest', { core }), currentPath: '/py/latest/reference/', port: 'py', version: 'latest', locale: 'en' },
    })
    const win = new Window({ url: 'https://libtmux.org/py/latest/reference/', settings: { disableJavaScriptEvaluation: true } })
    windows.push(win)
    win.document.write(html)
    disposals.push(installExternalLinks(win as unknown as typeof window))
    await win.happyDOM.waitUntilComplete()

    const external = win.document.querySelector<HTMLAnchorElement>('.surface-alternatives a[href="https://docs.rs/libtmux"]')!
    expect(external).not.toBeNull()
    // One indicator: the hint's glyph, which the stylesheet draws on a link that has text.
    expect(external.hasAttribute('data-external-link')).toBe(true)
    expect(external.hasAttribute('data-external-link-icon')).toBe(false)
    expect(external.textContent).not.toMatch(/[↗⇗]/)
    expect(external.querySelector('[aria-hidden="true"]:not(svg)')).toBeNull()
    // The name and the new-tab behavior remain.
    expect(external.textContent.replace(/\s+/g, ' ').trim()).toBe('docs.rs (opens in a new tab)')
    expect(external.getAttribute('target')).toBe('_blank')
    expect(external.getAttribute('rel')).toBe('noopener noreferrer')
    // The control: an internal alternative gets neither the hint nor an arrow.
    const internal = win.document.querySelector<HTMLAnchorElement>('.surface-alternatives a[href="/py/latest/api/"]')!
    expect(internal.hasAttribute('data-external-link')).toBe(false)
    expect(internal.textContent).not.toMatch(/[↗⇗]|new tab/)
  })
})
