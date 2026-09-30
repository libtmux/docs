import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { expect, it } from 'vitest'
import { SITE_BUILT, SITE_PREFIX, sitePath } from './site-root'
import { PORTS } from '../src/lib/ports'

it.skipIf(!SITE_BUILT)('starts port search in that language and leaves root search unfiltered', () => {
  for (const port of PORTS) {
    for (const route of ['search', 'reference']) {
      const html = readFileSync(sitePath(port.slug, 'latest', route, 'index.html'), 'utf8')
      expect(html, `${port.slug}/${route} search scope`).toContain(`data-initial-port="${port.name}"`)
      if (route === 'reference') {
        expect(/data-pagefind-filter="port:([^"]+)"/.exec(html)?.[1], `${port.slug} index scope`).toBe(port.name)
      }
    }
  }
  const root = readFileSync(sitePath('search/index.html'), 'utf8')
  expect(root).not.toContain('data-initial-port=')
  expect(root).toContain('data-pagefind-filter="port:All languages"')
  const symbols = readFileSync(sitePath('reference/symbols/a/index.html'), 'utf8')
  expect(symbols).toContain(`data-search-href="/${SITE_PREFIX}search/"`)
  expect(symbols).not.toContain('/symbols/latest/search/')
})

it.skipIf(!SITE_BUILT)('indexes scoped product declarations while retaining core, internal, and index pages', () => {
  const cases = [
    ['go/latest/workspace/reference/workspace-build', true],
    ['go/latest/workspace/guides', false],
    ['go/latest/workspace/internals/guides', true],
    ['py/latest/workspace/guides', true],
    ['py/latest/workspace/internals', true],
    ['ts/latest/mcp/reference/mcp-startup-serverstartup', true],
    ['ts/latest/reference/builder-applywindowcontext', true],
    ['go/latest/reference/tmux-server', true],
    ['go/latest/reference', true],
    ['reference', true],
  ] as const
  const window = new Window({
    url: 'https://libtmux.org',
    settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
  })
  try {
    for (const [path, searchable] of cases) {
      window.document.documentElement.innerHTML = readFileSync(sitePath(path, 'index.html'), 'utf8')
      expect(window.document.querySelector('[data-pagefind-body]') !== null, path).toBe(searchable)
    }
  } finally {
    window.close()
  }
})
