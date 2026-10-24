import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { experimental_AstroContainer } from 'astro/container'
import { Window } from 'happy-dom'
import * as cellsModule from '../src/lib/capability-cells'
import type { Column, Row } from '../src/lib/capability-cells'

/** Compile the component the way the site's other component tests do, with its one helper bound. */
async function loadMatrix() {
  vi.stubGlobal('__capabilityCells', cellsModule)
  const astroRequire = createRequire(realpathSync(new URL('../node_modules/astro/package.json', import.meta.url)))
  const { transform } = await import(astroRequire.resolve('@astrojs/compiler-rs'))
  const runtime = pathToFileURL(astroRequire.resolve('astro/compiler-runtime')).href
  const file = new URL('../src/components/capabilities/CapabilityMatrix.astro', import.meta.url)
  const result = await transform(readFileSync(file, 'utf8'), { filename: file.pathname, internalURL: 'astro/compiler-runtime',
    resultScopedSlot: true, scopedStyleStrategy: 'attribute', resolvePath: (specifier: string) => specifier })
  expect(result.diagnostics.filter((d: { severity: string }) => d.severity === 'error')).toEqual([])
  const bridge = `export const { CELL_LABEL } = globalThis.__capabilityCells;`
  const code = result.code.replaceAll('"astro/compiler-runtime"', JSON.stringify(runtime))
    .replaceAll('"../../lib/capability-cells"', JSON.stringify(`data:text/javascript;base64,${Buffer.from(bridge).toString('base64')}`))
  return (await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default
}

const columns: Column[] = ['3.3a', '3.4', '3.7', 'next-3.9'].map((v) => ({ key: v, label: v, title: `tmux ${v}` }))
const rows: Row[] = [
  {
    id: 'control-mode', label: 'Control mode', summary: 'Attach a control client.', requirement: '3.7 and later',
    apis: [], commands: [],
    cells: [{ state: 'fallback' }, { state: 'fallback' }, { state: 'supported' }, { state: 'supported' }],
  },
  {
    id: 'buffer-delete-named', label: 'Named buffer delete with a much longer label', summary: 'Delete by name.', requirement: '3.4 and later',
    apis: [], commands: [],
    cells: [{ state: 'refused' }, { state: 'supported' }, { state: 'supported' }, { state: 'supported' }],
  },
]

async function render(shown: Row[] = rows) {
  const container = await experimental_AstroContainer.create()
  const html = await container.renderToString(await loadMatrix(), { props: { caption: 'test', columns, rows: shown } })
  const window = new Window()
  window.document.body.innerHTML = html
  return window.document
}

describe('CapabilityMatrix', () => {
  it('shares the width left by the name column equally among the data columns', async () => {
    const doc = await render()
    const table = doc.querySelector('table')!
    expect(table.className).toContain('table-fixed')
    expect(table.className).toContain('w-full')
    const cols = [...doc.querySelectorAll('col')]
    expect(cols[0].getAttribute('class')).toMatch(/w-\[/)
    const data = cols.slice(1).map((c) => c.getAttribute('style'))
    expect(data).toHaveLength(columns.length)
    // A fixed layout splits the remaining width evenly among columns without a width.
    expect(data.every((style) => style === null)).toBe(true)
  })

  it('fills every row with one cell per column, each labelled for screen readers', async () => {
    const doc = await render()
    for (const tr of doc.querySelectorAll('tbody tr')) {
      const cells = tr.querySelectorAll('td')
      expect(cells).toHaveLength(columns.length)
      for (const td of cells) expect(td.querySelector('.sr-only')?.textContent).toBeTruthy()
    }
    expect(doc.querySelectorAll('thead th')).toHaveLength(columns.length + 1)
  })

  it('lists only the states the table uses in its legend', async () => {
    const doc = await render()
    const legend = [...doc.querySelectorAll('[aria-label="Legend"] li')].map((li) => li.textContent?.trim())
    expect(legend).toEqual(['✓Works', '↺Uses another path', '✕Refused with an error'])
  })

  it('names a repaired cell as repaired and a workaround cell as a workaround', async () => {
    const only = (state: 'repaired' | 'workaround'): Row[] => [{
      id: 'x', label: 'X', summary: 'X.', requirement: '3.7', apis: [], commands: [],
      cells: [{ state }, { state: 'supported' }, { state: 'supported' }, { state: 'supported' }],
    }]
    const legend = async (state: 'repaired' | 'workaround') =>
      [...(await render(only(state))).querySelectorAll('[aria-label="Legend"] li')].map((li) => li.textContent?.trim())
    expect(await legend('workaround')).toEqual(['✓Works', '◐Works with a workaround'])
    expect(await legend('repaired')).toEqual(['✓Works', '◑Repaired after the command'])
    const both = only('repaired')
    both.push(...only('workaround'))
    const doc = await render(both)
    const marks = [...doc.querySelectorAll('[aria-label="Legend"] li')].map((li) => li.textContent?.trim())
    expect(marks).toEqual(['✓Works', '◐Works with a workaround', '◑Repaired after the command'])
    // The cell's own words match the legend entry that explains it.
    const cells = [...doc.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('td .sr-only')?.textContent)
    expect(cells).toEqual(['Repaired after the command', 'Works with a workaround'])
  })
})
