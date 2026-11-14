import { Window } from 'happy-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { loadAstroTemplate, renderAstroTemplate, withoutScope } from './astro-templates'

const windows: Window[] = []
afterEach(async () => { for (const win of windows.splice(0)) await win.happyDOM.abort() })

async function render(props: Record<string, unknown>) {
  const template = await loadAstroTemplate('components/api/columns/ApiColumnsBar.astro', { inlineScripts: true })
  const html = withoutScope(await renderAstroTemplate(template, { url: 'https://libtmux.org/en/go/latest/reference/', props }))
  const win = new Window()
  windows.push(win)
  win.document.body.innerHTML = html
  return { document: win.document, html }
}

const go = { port: 'go', portName: 'Go', base: '/go/latest/reference/' }

describe('the reference view switch', () => {
  it('offers View: Tree | Columns as a segmented control with the tree pressed', async () => {
    const { document } = await render(go)
    const group = document.querySelector('[data-api-columns-bar] [role="group"]')!
    expect(group.getAttribute('aria-labelledby')).toBe('api-columns-view')
    expect(document.getElementById('api-columns-view')!.textContent).toBe('View')
    const buttons = [...group.querySelectorAll('button')]
    expect(buttons.map((b) => [b.textContent, b.dataset.view, b.getAttribute('aria-pressed')])).toEqual([
      ['Tree', 'tree', 'true'], ['Columns', 'columns', 'false'],
    ])
  })

  it('holds the configuration row hidden until the columns view shows, with every prop', async () => {
    const { document } = await render(go)
    const row = document.querySelector<HTMLElement>('[data-cfg-row]')!
    expect(row.hidden).toBe(true)
    expect([...row.querySelectorAll('[data-cfg]')].map((el) => el.getAttribute('data-cfg'))).toEqual(['search', 'paginate', 'pageSize', 'virtual', 'filterAt'])
    expect([...row.querySelectorAll('[data-cfg-layout]')].map((el) => el.getAttribute('data-cfg-layout'))).toEqual(['columns', 'single'])
    expect([...row.querySelectorAll('[data-cfg="pageSize"] option')].map((o) => o.textContent)).toEqual(['10', '25', '50', '100'])
    expect(row.querySelector('[data-cfg-code]')).not.toBeNull()
  })

  it('chooses the view before first paint from the address, then the visit, and defaults to the tree', async () => {
    const { html } = await render(go)
    expect(html).toContain("new URLSearchParams(location.search).get('view')")
    expect(html).toContain("sessionStorage.getItem('libtmux:api-view')")
    expect(html).toContain("root.dataset.apiView = 'tree'")
    // Never localStorage: the choice is not remembered across visits.
    expect(html).not.toContain('localStorage')
  })

  it('links the trial pages from the row and gives the columns view its own container', async () => {
    const { document } = await render(go)
    expect([...document.querySelectorAll('.api-columns__trials a')].map((a) => a.getAttribute('href'))).toEqual(['/go/latest/reference/trial/columns/'])
    expect(document.querySelector('[data-api-columns-view]')).not.toBeNull()
  })

  it('renders nothing on another port or on the glossary, where the tree stays the only view', async () => {
    expect((await render({ ...go, port: 'py' })).document.querySelector('[data-api-columns]')).toBeNull()
    expect((await render({ ...go, glossary: true })).document.querySelector('[data-api-columns]')).toBeNull()
  })
})
