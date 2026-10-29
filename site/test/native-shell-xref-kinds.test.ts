import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { NativePageContext, NativeShellContext } from '../src/lib/native-shell'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

/**
 * The shell carries, beside the page's equivalents in other ports, the kind of each declaration the page's
 * cross-references point at, so the script that marks them does not guess a kind from the role.
 */
// The first render loads the shell's reference data, which takes a while on a busy machine.
vi.setConfig({ testTimeout: 60_000 })
const window = new Window()
afterAll(async () => { await window.happyDOM.abort() })

const page = (xrefKinds?: Record<string, string>): NativePageContext => ({
  file: 'api/libtmux.server/index.html', path: 'api/libtmux.server/', url: '/en/py/latest/api/api/libtmux.server/', sourcePath: 'py/latest/api/api/libtmux.server/',
  htmlSha256: '', articleSha256: '', hasTableOfContents: false, signatures: ['libtmux.Server'], title: 'libtmux.server', xrefKinds,
})
const context = { schema: 1, port: 'py', version: 'latest', locale: 'en', root: '/en/', base: '/en/py/latest/api/', source: { repository: 'tmux-python/libtmux', sha: 'a'.repeat(40) },
  artifactSha256: '', pages: [page()], toctree: [], redirects: [] } as NativeShellContext

const source = readFileSync(new URL('../src/layouts/NativeShell.astro', import.meta.url), 'utf8')

async function render(xrefKinds?: Record<string, string>, withoutKinds = false) {
  const layout = await loadAstroTemplate('layouts/NativeShell.astro', withoutKinds
    ? { stubs: { 'layouts/NativeShell.astro': source.replace(/^.*data-native-xref-kinds.*\n/m, '') } } : {})
  window.document.body.innerHTML = await renderAstroTemplate(layout, { props: { context, page: page(xrefKinds) } })
  return window.document
}

describe('the native shell', () => {
  it('carries the kind of each declaration the page cross-references', async () => {
    const root = await render({ 'libtmux.Window.panes': 'property', 'libtmux.exc.LibTmuxException': 'exception' })
    expect(JSON.parse(root.querySelector('script[data-native-xref-kinds]')!.textContent!)).toEqual({
      'libtmux.Window.panes': 'property', 'libtmux.exc.LibTmuxException': 'exception',
    })
  })

  it('carries an empty record for a page that cross-references nothing', async () => {
    expect(JSON.parse((await render()).querySelector('script[data-native-xref-kinds]')!.textContent!)).toEqual({})
  })

  it('is caught when the layout leaves the kinds out, so the checks above can fail', async () => {
    expect(source).toMatch(/data-native-xref-kinds/)
    const root = await render({ 'libtmux.Window.panes': 'property' }, true)
    expect(root.querySelector('script[data-native-xref-kinds]')).toBeNull()
  })
})
