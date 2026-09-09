import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { expect, it } from 'vitest'
import { SITE_BUILT, sitePath } from './site-root'

it.skipIf(!SITE_BUILT)('indexes scoped product declarations while retaining core, internal, and index pages', () => {
  const cases = [
    ['reference/go/workspace-build', false],
    ['go/latest/workspace/api/workspace-build', false],
    ['go/latest/workspace/internals/api/workspace-build', true],
    ['go/latest/workspace/guides', false],
    ['go/latest/workspace/internals/guides', true],
    ['py/latest/workspace/guides', true],
    ['py/latest/workspace/internals', true],
    ['reference/ts/mcp-startup-serverstartup', false],
    ['ts/latest/mcp/api/mcp-startup-serverstartup', true],
    ['reference/ts/builder-applywindowcontext', true],
    ['reference/go/tmux-server', true],
    ['reference/go', true],
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
