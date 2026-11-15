import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

const windows: Window[] = []
afterEach(async () => { for (const win of windows.splice(0)) await win.happyDOM.abort() })

/** Sidebar rows carry no icons, so every label starts at the same edge (record 0060). */
describe('a sidebar link row', () => {
  const template = loadAstroTemplate('components/docs/SidebarLink.astro', { real: ['components/api/ApiBadge.astro'] })
  const render = async (props: Record<string, unknown>) => {
    const win = new Window({ url: 'https://libtmux.org/go/latest/core/' })
    windows.push(win)
    win.document.body.innerHTML = await renderAstroTemplate(await template, { props: { href: '/go/latest/core/', label: 'Overview', level: 1, ...props } })
    return win.document as unknown as Document
  }

  it('draws the Install row as its label alone, with no download mark before it', async () => {
    const row = (await render({ href: '/go/latest/core/#install', label: 'Install', install: true })).querySelector('a')!
    expect(row.querySelector('svg, img')).toBeNull()
    expect(row.firstElementChild!.tagName, 'the label is the first thing in the row, as in Overview').toBe('SPAN')
    expect(row.textContent!.trim()).toBe('Install')
  })

  it('draws every other row without an icon as well', async () => {
    for (const props of [{}, { count: 6, label: 'Guides' }, { external: true, label: 'pkg.go.dev' }]) {
      expect((await render(props)).querySelector('a')!.querySelector('svg, img'), JSON.stringify(props)).toBeNull()
    }
  })

  it('keeps no rule for the mark it dropped', () => {
    const source = readFileSync(new URL('../src/components/docs/SidebarLink.astro', import.meta.url), 'utf8')
    expect(source).not.toContain('sidebar-link__install')
    expect(source).not.toMatch(/<svg/)
  })
})
