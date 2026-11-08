import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { loadHeaderTemplates, renderPage } from './header-page'

// Compiles and renders the real shell; source-only assertions remain in the unit suite.
afterEach(() => vi.unstubAllEnvs())

it('renders the router meta tags in the head of the base layout', async () => {
  const { baseLayout } = await loadHeaderTemplates()
  const html = await renderPage(baseLayout, 'https://libtmux.org/en/ts/latest/guides/panes/', { pagePath: 'guides/panes', portSlug: 'ts' })
  const head = /<head>([\s\S]*?)<\/head>/.exec(html)![1]!
  expect(head).toContain('<meta name="astro-view-transitions-enabled" content="true"')
  expect(head).toContain('<meta name="astro-view-transitions-fallback" content="swap"')
})

it('holds the first frame until the header bar is parsed', async () => {
  const header = readFileSync(new URL('../src/components/SiteHeader.astro', import.meta.url), 'utf8')
  const panel = header.indexOf('id="site-header-panel"')
  expect(panel).toBeGreaterThan(header.indexOf('site-header__menu-button'))
  expect(panel).toBeGreaterThan(header.indexOf('site-header__always'))
  const { baseLayout } = await loadHeaderTemplates()
  const html = await renderPage(baseLayout, 'https://libtmux.org/en/ts/latest/guides/panes/', { pagePath: 'guides/panes', portSlug: 'ts' })
  expect(/<head>([\s\S]*?)<\/head>/.exec(html)![1]).toContain('<link rel="expect" href="#site-header-panel" blocking="render">')
  expect(html).toContain('id="site-header-panel"')
})
