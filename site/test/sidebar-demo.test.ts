import { afterEach, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'
import { demoConfig, demoUrl } from '../src/lib/sidebar-demo'
import { API_MODEL_PORTS } from '../src/lib/ports'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

afterEach(() => vi.unstubAllEnvs())

const languages = [...API_MODEL_PORTS.map((port) => port.slug), 'tmux']

it('offers every library port and the tmux CLI without changing their URL identities', () => {
  for (const language of languages) {
    expect(demoConfig(new URLSearchParams({ language }), languages).language).toBe(language)
  }
})

it('round trips a configuration without losing locale or preview context', () => {
  const base = new URL('https://libtmux.org/pr-42/ja/demo/sidebar/?version=latest')
  const config = demoConfig(new URLSearchParams('variant=grouped&language=kotlin&symbol=Session.Companion&viewport=phone&theme=light&width=330'), languages)
  const url = demoUrl(base, config)
  expect(url.pathname).toBe('/pr-42/ja/demo/sidebar/')
  expect(url.searchParams.get('version')).toBe('latest')
  expect(demoConfig(url.searchParams, languages)).toEqual(config)
})

it('defaults invalid controls and bounds the requested sidebar width', () => {
  expect(demoConfig(new URLSearchParams('variant=unknown&language=bad&viewport=bad&theme=bad&width=9999'), languages))
    .toMatchObject({ variant: 'outline', language: 'csharp', viewport: 'desktop', theme: 'dark', width: 380 })
  expect(demoConfig(new URLSearchParams('width=nan'), languages).width).toBe(296)
})

it('emits a preview for every language at the site root and none in a port build', async () => {
  const paths = async (port: string) => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', port)
    vi.resetModules()
    return (await import('../src/lib/sidebar-demo-data')).sidebarPreviewPaths().map((entry) => entry.params.port)
  }
  expect(await paths('')).toEqual(languages)
  expect(await paths('py')).toEqual([])
})

async function footer(props: Record<string, unknown>) {
  const template = await loadAstroTemplate('components/SiteFooter.astro')
  const win = new Window({ url: 'https://libtmux.org/en/demo/sidebar/preview/py/' })
  win.document.body.innerHTML = await renderAstroTemplate(template, {
    props: { locale: 'en', llmsRoot: '/en/', githubUrl: 'https://github.com/libtmux/docs/',
      markdownHref: '/en/demo/sidebar/preview/py.md', source: { repo: 'libtmux/docs', ref: 'main', path: 'site/src/pages/demo/sidebar/preview/[port].astro' },
      ...props },
  })
  return win
}

it('keeps the page-source line on an embedded preview and drops the site navigation', async () => {
  const embedded = await footer({ compact: true })
  const line = embedded.document.querySelector('.page-source')!
  expect([...line.querySelectorAll('a')].map((link) => link.getAttribute('href')!.replace(/\/$/, '').replace(/^.*\//, '')))
    // The inventory download and its help page sit on the same line, so a preview names them too.
    .toEqual(['py.md', '[port].astro', 'docs.json', 'llms.txt', 'llms-full.txt', 'objects-full.inv', 'intersphinx', 'intersphinx'])
  expect(line.querySelector('code')!.textContent).toBe('site/src/pages/demo/sidebar/preview/[port].astro')
  expect(embedded.document.querySelector('footer a[aria-label="GitHub"]')!.getAttribute('href')).toBe('https://github.com/libtmux/docs/')
  expect(embedded.document.querySelectorAll('footer li')).toHaveLength(0)
  // The same footer without `compact` carries the site navigation, so the check above can fail.
  const full = await footer({})
  expect(full.document.querySelectorAll('footer li').length).toBeGreaterThan(API_MODEL_PORTS.length)
  expect(full.document.querySelector('.page-source')!.innerHTML).toBe(line.innerHTML)
  await Promise.all([embedded.happyDOM.abort(), full.happyDOM.abort()])
})
