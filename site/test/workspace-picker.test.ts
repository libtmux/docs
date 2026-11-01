import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { createComponent, renderTemplate } from 'astro/runtime/server/index.js'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { paintScript, readStoredPreset, resolvePreset, rollPreset, scrollForThumb, selectionRules, stepIndex, storePreset, STORAGE_PREFIX, thumbMetrics, withPreset } from '../src/lib/workspace-picker'
import { HOME_PREVIEW_DELAY } from '../src/lib/home-hover-preview'
import { HOVER_OPEN } from '../src/lib/status-toggletip'
import { renderLayout } from '../src/lib/tmux-layout'
import { configKeys, offersPicker, presetOptions, previewSize, previewWindows, TOPICS, workspaceShowcase } from '../src/lib/workspace-showcase'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

const SOURCE = readFileSync(new URL('../src/lib/workspace-picker.ts', import.meta.url), 'utf8')
/** The module as the browser runs it: types erased and its exports made local. */
const HOVER = readFileSync(new URL('../src/lib/home-hover-preview.ts', import.meta.url), 'utf8')
const TOGGLETIP = readFileSync(new URL('../src/lib/status-toggletip.ts', import.meta.url), 'utf8')
const CLIENT = [HOVER, TOGGLETIP, SOURCE.replace(/^import .*$/gm, '')]
  .map((code) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText)
  .join('\n').replace(/^export /gm, '')

const stub = {
  Code: createComponent((_result: unknown, props: { code: string; lang: string }) => renderTemplate`<pre data-lang="${props.lang}">${props.code}</pre>`),
}
const REAL = ['components/RerollButton.astro', 'components/workspace/WorkspaceConfig.astro', 'components/workspace/WorkspaceWindows.astro', 'components/docs/PickerSearch.astro']
const picker = loadAstroTemplate('components/workspace/WorkspacePicker.astro', { real: REAL, modules: { 'astro-expressive-code/components': stub } })
const examples = loadAstroTemplate('components/workspace/WorkspaceShowcase.astro', { real: REAL, modules: { 'astro-expressive-code/components': stub } })

const windows: Window[] = []
afterEach(async () => {
  for (const win of windows.splice(0)) await win.happyDOM.abort()
})

/** The picker for a port, rendered by the real template and given its client code. */
async function page(port: string, { url = 'https://libtmux.org/en/rs/latest/workspace/', storage, random }: { url?: string; storage?: Storage | 'throws'; random?: () => number } = {}) {
  const win = new Window({ url })
  windows.push(win)
  const showcase = workspaceShowcase(port)
  win.document.body.innerHTML = await renderAstroTemplate(await picker, { props: { showcase } })
  if (storage === 'throws') {
    Object.defineProperty(win, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError') } })
  } else if (storage) {
    Object.defineProperty(win, 'localStorage', { value: storage })
  }
  if (random) (win as unknown as { __random: () => number }).__random = random
  win.eval(`(() => {\n${random ? 'Math.random = () => window.__random();\n' : ''}${CLIENT}\ndefineWorkspacePicker()\n})()`)
  const document = win.document as unknown as Document
  const root = () => document.querySelector('libtmux-workspace-picker')!
  /** The preset the picker shows, and the panels a reader could reach (the rest are inert). */
  const active = () => [root().getAttribute('data-selected')]
  const reachable = () => [...document.querySelectorAll<HTMLElement>('[data-preset]')].filter((panel) => !panel.inert).map((panel) => panel.dataset.preset)
  const checked = () => [...document.querySelectorAll<HTMLElement>('[data-preset-option]')].filter((option) => option.getAttribute('aria-current') === 'true').map((option) => option.dataset.presetOption)
  const chip = (id: string) => document.querySelector<HTMLAnchorElement>(`[data-preset-option="${id}"]`)!
  const click = (node: Element) => node.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }) as unknown as Event)
  const press = (node: Element, key: string) => node.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }) as unknown as Event)
  const choose = (id: string) => click(chip(id))
  return { win, document, active, reachable, checked, chip, click, press, choose }
}

const memory = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial))
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value), values } as unknown as Storage & { values: Map<string, string> }
}

describe('choosing a preset', () => {
  it('takes the first candidate that names a preset, else the first preset', () => {
    const ids = ['a', 'b', 'c']
    expect(resolvePreset(ids, 'c', 'b')).toBe('c')
    expect(resolvePreset(ids, null, 'b')).toBe('b')
    expect(resolvePreset(ids, 'gone', undefined, 'b')).toBe('b')
    expect(resolvePreset(ids, 'gone', null)).toBe('a')
    expect(resolvePreset(ids)).toBe('a')
    expect(resolvePreset([], 'a')).toBeUndefined()
  })

  it('reads and writes the port\'s slot, and loses only the memory when storage throws', () => {
    const store = memory()
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    try {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: store })
      storePreset('rs', 'tiled')
      expect(store.values.get(`${STORAGE_PREFIX}rs`)).toBe('tiled')
      expect(readStoredPreset('rs')).toBe('tiled')
      expect(readStoredPreset('go')).toBeNull()
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError') } })
      expect(readStoredPreset('rs')).toBeNull()
      expect(() => storePreset('rs', 'tiled')).not.toThrow()
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original)
      else Reflect.deleteProperty(globalThis, 'localStorage')
    }
  })

  it('keeps the other parts of the address when it records a choice', () => {
    expect(withPreset('https://libtmux.org/en/rs/latest/workspace/?a=1#try-a-preset', 'tiled')).toBe('/en/rs/latest/workspace/?a=1&preset=tiled#try-a-preset')
    expect(withPreset('https://libtmux.org/en/rs/latest/workspace/?preset=old', 'new')).toBe('/en/rs/latest/workspace/?preset=new')
  })
})

describe('rolling for a preset', () => {
  const ids = ['a', 'b', 'c', 'd']

  it('never returns the current preset, whatever the generator returns', () => {
    for (const current of ids) {
      for (const value of [0, 0.0001, 0.25, 0.5, 0.74, 0.75, 0.999, 0.9999999999999999, 1]) {
        const rolled = rollPreset(ids, current, () => value)
        expect(rolled, `${current} at ${value}`).not.toBe(current)
        expect(ids).toContain(rolled)
      }
    }
  })

  it('can reach every other preset, and only those', () => {
    let seed = 7
    const random = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
    const reached = new Set<string>()
    for (let roll = 0; roll < 200; roll++) reached.add(rollPreset(ids, 'b', random))
    expect([...reached].sort()).toEqual(['a', 'c', 'd'])
  })

  it('stays put when there is nothing else to choose', () => {
    expect(rollPreset(['only'], 'only', () => 0.5)).toBe('only')
    expect(rollPreset([], 'only')).toBe('only')
  })

  it('moves along a row of options with the arrow keys, wrapping at the ends', () => {
    expect(stepIndex(4, 3, 'ArrowRight')).toBe(0)
    expect(stepIndex(4, 0, 'ArrowLeft')).toBe(3)
    expect(stepIndex(4, 1, 'ArrowDown')).toBe(2)
    expect(stepIndex(4, 1, 'ArrowUp')).toBe(0)
    expect(stepIndex(4, 2, 'Home')).toBe(0)
    expect(stepIndex(4, 1, 'End')).toBe(3)
    expect(stepIndex(4, 1, 'Enter')).toBeUndefined()
    expect(stepIndex(4, 1, 'a')).toBeUndefined()
  })
})

describe('the picker as rendered', () => {
  it('offers every example as a menu row, in the order of the classics, and shows the first', async () => {
    const { document, active, checked, reachable } = await page('rs')
    const showcase = workspaceShowcase('rs')!
    const order = TOPICS.map((topic) => topic.id)
    const ids = [...showcase.examples].sort((a, b) => order.indexOf(a.topic) - order.indexOf(b.topic)).map((example) => example.topic)
    expect([...document.querySelectorAll<HTMLElement>('[data-preset-option]')].map((option) => option.dataset.presetOption)).toEqual(ids)
    expect([...document.querySelectorAll<HTMLElement>('[data-preset]')].map((panel) => panel.dataset.preset)).toEqual(ids)
    expect(active()).toEqual([ids[0]])
    expect(checked()).toEqual([ids[0]])
    expect(reachable()).toEqual([ids[0]])
    expect(document.querySelectorAll('[data-first]')).toHaveLength(1)
    expect(document.querySelector('[data-first]')?.getAttribute('data-preset')).toBe(ids[0])
  })

  it('is the site\'s task menu: a titled, searchable details picker with a check on the current row', async () => {
    const { document } = await page('rs')
    const menu = document.querySelector('details[data-preset-menu]')!
    expect(menu.classList.contains('doc-picker')).toBe(true)
    expect(menu.hasAttribute('data-doc-picker')).toBe(true)
    expect(menu.querySelector(':scope > summary')?.getAttribute('aria-label')).toBe('Preset: Short-hand panes')
    const options = [...menu.querySelectorAll<HTMLElement>('[data-preset-option]')]
    expect(menu.querySelector('.doc-picker-title')?.textContent).toContain('Choose a preset')
    expect(menu.querySelector('.doc-picker-count')?.textContent).toBe(String(options.length))
    expect(menu.querySelector('[data-picker-search-label]')?.hasAttribute('hidden')).toBe(true)
    expect(menu.querySelector('input[type="search"][data-picker-search]')?.getAttribute('placeholder')).toBe('Find a preset…')
    expect(menu.querySelector('[data-picker-empty]')?.hasAttribute('hidden')).toBe(true)
    expect(menu.querySelector('nav')?.getAttribute('aria-label')).toBe('Workspace presets')
    for (const [index, option] of options.entries()) {
      expect(option.classList.contains('doc-picker-option'), option.dataset.presetOption).toBe(true)
      expect(option.hasAttribute('data-picker-option')).toBe(true)
      expect(option.querySelector('.ws-picker__name')?.textContent).toBe(TOPICS.find((topic) => topic.id === option.dataset.presetOption)!.title)
      expect(option.querySelector('small')?.textContent).toBe(TOPICS.find((topic) => topic.id === option.dataset.presetOption)!.summary)
      expect(option.querySelector('.doc-picker-check')?.hasAttribute('hidden')).toBe(index !== 0)
      expect(option.getAttribute('aria-current')).toBe(index === 0 ? 'true' : null)
    }
  })

  it('leads each row with the first window as a small tile of pane outlines and no text', async () => {
    const { document } = await page('rs')
    for (const preset of presetOptions(workspaceShowcase('rs')!)) {
      const tile = document.querySelector(`[data-preset-option="${preset.id}"] .ws-picker__icon svg.ws-tile`)!
      expect(tile, preset.id).not.toBeNull()
      expect(tile.getAttribute('aria-hidden')).toBe('true')
      expect(tile.querySelector('text, tspan'), preset.id).toBeNull()
      expect(tile.querySelectorAll('.ws-tile__window'), preset.id).toHaveLength(1)
      expect(tile.querySelector('.ws-tile__back') !== null, `${preset.id} stack hint`).toBe(preset.windows.length > 1)
    }
  })

  it('puts the roll button, the site\'s own, beside the menu', async () => {
    const { document } = await page('rs')
    const bar = document.querySelector('.ws-picker__bar')!
    expect([...bar.children].map((child) => child.tagName.toLowerCase() + (child.classList.contains('lm-reroll') ? '.roll' : ''))).toEqual(['span', 'details', 'button.roll'])
    const roll = bar.querySelector('[data-action="roll"]')!
    expect(roll.classList.contains('lm-reroll--lg')).toBe(true)
    expect(roll.getAttribute('aria-label')).toBe('Pick another preset')
    expect(roll.querySelector('.lm-reroll__die')?.textContent).toBe('🎲')
    expect(document.querySelector('[role="status"][data-picker-announce]')).not.toBeNull()
  })

  it('searches by name, by summary and by the workspace keys a preset uses', async () => {
    const { document } = await page('rs')
    const found = (query: string) => [...document.querySelectorAll<HTMLElement>('[data-preset-option]')]
      .filter((option) => query.toLowerCase().split(/\s+/).every((token) => option.dataset.match!.toLowerCase().includes(token)))
      .map((option) => option.dataset.presetOption)
    expect(found('env')).toEqual(expect.arrayContaining(['environment', 'env-variables']))
    expect(found('synchronize')).toContain('2-pane-synchronized')
    expect(found('sleep_before')).toEqual(expect.arrayContaining(['sleep', 'sleep-pane-level']))
    expect(found('window_index')).toContain('window-index')
    expect(found('main-pane-height')).toContain('main-pane-height-percentage')
    // A key no title or summary spells out is found only through the keys the file uses.
    expect(found('session_name')).toEqual(presetOptions(workspaceShowcase('rs')!).filter((option) => option.keys.includes('session_name')).map((option) => option.id))
    expect(found('session_name').length).toBeGreaterThan(1)
    expect(found('no preset says this')).toEqual([])
  })

  it('offers no picker at all when a port has one preset, so its file appears once', async () => {
    const { document } = await page('go')
    expect(offersPicker(workspaceShowcase('go')!)).toBe(false)
    expect(document.querySelector('[data-workspace-picker]')).toBeNull()
    expect(document.querySelector('[data-preset]')).toBeNull()
    expect(document.querySelector('[data-action="roll"]')).toBeNull()
    expect(document.querySelector('details')).toBeNull()
  })

  it('puts each preset\'s configuration beside its drawing, with a tab for every window', async () => {
    const { document } = await page('rs')
    for (const option of presetOptions(workspaceShowcase('rs')!)) {
      const panel = document.querySelector(`[data-preset="${option.id}"]`)!
      expect(panel.querySelector('.ws-config__panel--yaml pre')?.textContent).toBe(option.yaml)
      expect(panel.querySelector('.ws-config__panel--yaml pre')?.getAttribute('data-lang')).toBe('yaml')
      expect(JSON.parse(panel.querySelector('.ws-config__panel--json pre')!.textContent!)).toEqual(JSON.parse(option.json))
      const tabs = [...panel.querySelectorAll('[role="tab"]')]
      const figures = [...panel.querySelectorAll('[data-window]')]
      expect(tabs.map((tab) => tab.textContent), option.id).toEqual(option.windows.map((win) => `${win.index}:${win.name ?? 'window'}`))
      expect(figures, option.id).toHaveLength(option.windows.length)
      expect(panel.querySelectorAll('svg.gp-tmux-layout'), option.id).toHaveLength(option.windows.length)
      tabs.forEach((tab, index) => {
        expect(tab.getAttribute('aria-selected')).toBe(index === 0 ? 'true' : 'false')
        expect((tab as HTMLElement).tabIndex).toBe(index === 0 ? 0 : -1)
        expect(tab.getAttribute('aria-controls')).toBe(figures[index]!.id)
        expect(figures[index]!.getAttribute('aria-labelledby')).toBe(tab.id)
        expect(figures[index]!.getAttribute('role')).toBe('tabpanel')
      })
      expect(figures.filter((figure) => figure.hasAttribute('data-active'))).toHaveLength(1)
    }
  })

  it('draws every window of a preset that has several, in tmux\'s order', async () => {
    const { document } = await page('rs')
    const labels = (preset: string) => [...document.querySelector(`[data-preset="${preset}"]`)!.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)
    expect(labels('start-directory')).toEqual([
      '0:should be /var/', '1:should be /var/log', '2:should be ~', '3:should be /bin', "4:should be workspace file's dir",
    ])
    expect(labels('window-index')).toEqual(['0:zero', '1:one', '5:five'])
  })

  it('draws a window that names no layout the way the port builds it', async () => {
    const options = presetOptions(workspaceShowcase('rs')!)
    const shorthand = options.find((option) => option.id === 'shorthand')!
    const commands = [["echo 'did you know'", "echo 'you can inline'"], ["echo 'single commands'"], ["echo 'for panes'"]]
    expect(shorthand.windows[0]!.svg).toBe(renderLayout(commands, 'tiled', previewSize('tiled', 3), { id: 'ws-pick-rs-shorthand-w0', label: 'Window 0, long form: 3 panes, tiled' }))
    expect(shorthand.windows[0]!.caption).toBe('no layout set, so the port tiles the panes')
    expect(presetOptions(workspaceShowcase('py')!).find((option) => option.id === 'environment')!.windows[0]!.caption).toBe('no layout set')
  })

  it('keeps its drawings apart from the examples below, so no id repeats on the page', async () => {
    const win = new Window({ url: 'https://libtmux.org/en/rs/latest/workspace/' })
    windows.push(win)
    const showcase = workspaceShowcase('rs')
    win.document.body.innerHTML = await renderAstroTemplate(await picker, { props: { showcase } }) + await renderAstroTemplate(await examples, { props: { showcase } })
    const ids = [...win.document.querySelectorAll('[id]')].map((node) => node.id)
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([])
  })

  it('draws every window of an example below the picker, with no script needed', async () => {
    const win = new Window({ url: 'https://libtmux.org/en/rs/latest/workspace/' })
    windows.push(win)
    win.document.body.innerHTML = await renderAstroTemplate(await examples, { props: { showcase: workspaceShowcase('rs') } })
    const article = [...win.document.querySelectorAll('.ws-example')].find((node) => node.querySelector('h3')?.id === 'example-start-directory')!
    expect([...article.querySelectorAll('.ws-win__name')].map((node) => node.textContent)).toEqual(
      presetOptions(workspaceShowcase('rs')!).find((option) => option.id === 'start-directory')!.windows.map((win) => `${win.index}:${win.name ?? 'window'}`),
    )
    expect(article.querySelectorAll('svg.gp-tmux-layout')).toHaveLength(5)
  })

  it('heads the section with the id the table of contents lists, and stays out of search', async () => {
    const { document } = await page('rs')
    expect(document.querySelector('h2')?.id).toBe('try-a-preset')
    expect(document.querySelector('[data-workspace-picker]')?.getAttribute('data-pagefind-ignore')).toBe('all')
  })

  it('shows the first preset alone, and no menu, until script marks the page', () => {
    const css = readFileSync(new URL('../src/styles/workspace-picker.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.ws-picker__panel:not\(\[data-first\]\)\s*\{\s*display: none;/)
    expect(css).toMatch(/\.ws-picker__bar\s*\{\s*display: none;/)
    // Only a page that script has marked stacks the panels, so the reserved height costs a page without script nothing.
    expect(css).toMatch(/html\[data-js\] \.ws-picker__stage\s*\{\s*display: grid;/)
    expect(css).toMatch(/html\[data-js\] \.ws-picker__panel\s*\{[^}]*grid-area: 1 \/ 1;[^}]*visibility: hidden;/)
  })

  it('never gives a shown window or tab its own visibility, which would paint it through a hidden preset', () => {
    for (const name of ['workspace-picker.css', 'workspace-showcase.css']) {
      const css = readFileSync(new URL(`../src/styles/${name}`, import.meta.url), 'utf8')
      for (const [, selector] of css.matchAll(/([^{}]+)\{[^{}]*visibility:\s*visible/g)) {
        expect(selector, `${name} sets visibility: visible on ${selector!.trim()}`).toBe('never')
      }
    }
    // The generated rules may: they name the selected preset and its label, which are outside the hidden ones.
    expect(selectionRules(['a'])).toContain('visibility:visible')
  })

  it('hides a window that is not shown, and lets the shown one inherit', () => {
    const css = readFileSync(new URL('../src/styles/workspace-picker.css', import.meta.url), 'utf8')
    expect(css).toMatch(/html\[data-js\] \.ws-layout__stack > \.ws-win:not\(\[data-active\]\)\s*\{\s*visibility: hidden;/)
  })

  it('keeps the window tabs on one line in a strip that scrolls', () => {
    const css = readFileSync(new URL('../src/styles/workspace-picker.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.ws-layout__tabs\s*\{[^}]*overflow-x: auto;/)
    expect(css).not.toMatch(/\.ws-layout__tabs\s*\{[^}]*flex-wrap: wrap/)
  })
})

describe('what shows before the script runs', () => {
  const ids = ['shorthand', 'environment', '2-pane-synchronized']

  it('writes one pair of rules for each preset, and a fallback to the first', () => {
    const rules = selectionRules(ids).split('\n')
    expect(rules).toHaveLength(ids.length + 1)
    for (const id of ids) {
      const rule = rules.find((line) => line.includes(`[data-selected="${id}"]`))!
      expect(rule).toContain(`.ws-picker__panel[data-preset="${id}"]`)
      expect(rule).toContain(`.ws-picker__current>[data-for="${id}"]`)
      expect(rule.startsWith('html[data-js] libtmux-workspace-picker[')).toBe(true)
    }
    expect(rules.at(-1)).toContain(':not([data-selected])')
    expect(selectionRules([])).toBe('')
    expect(selectionRules(['a"b'])).toContain('[data-selected="a\\"b"]')
  })

  /** Run the inline script against a fake page and report the attribute it set. */
  const painted = (search: string, stored: string | null | 'throws', port = 'rs', storedFor = port) => {
    let set: string | undefined
    const parent = { setAttribute: (name: string, value: string) => { if (name === 'data-selected') set = value } }
    const storage = { getItem: (key: string) => { if (stored === 'throws') throw new DOMException('denied', 'SecurityError'); return key === `${STORAGE_PREFIX}${storedFor}` ? stored : null } }
    new Function('location', 'localStorage', 'document', 'URLSearchParams', paintScript(port, ids))({ search }, storage, { currentScript: { parentElement: parent } }, URLSearchParams)
    return set
  }

  it('picks what resolvePreset picks, from the address, then storage, then the first', () => {
    for (const [search, stored] of [['', null], ['?preset=environment', null], ['', 'environment'], ['?preset=environment', '2-pane-synchronized'], ['?preset=gone', 'environment'], ['?preset=gone', 'gone'], ['?x=1', '2-pane-synchronized']] as const) {
      const query = new URLSearchParams(search).get('preset')
      expect(painted(search, stored), `${search} ${stored}`).toBe(resolvePreset(ids, query, stored))
    }
  })

  it('falls back to the first preset when storage throws, and reads only its own port\'s slot', () => {
    expect(painted('', 'throws')).toBe('shorthand')
    expect(painted('?preset=environment', 'throws')).toBe('environment')
    expect(painted('', 'environment', 'rs', 'go')).toBe('shorthand')
  })

  it('is an inline script in the picker that runs before the presets it marks are parsed', async () => {
    const source = readFileSync(new URL('../src/components/workspace/WorkspacePicker.astro', import.meta.url), 'utf8')
    expect(source).toMatch(/<libtmux-workspace-picker[^>]*>\s*<script is:inline set:html=\{paintScript/)
    expect(source).toContain('<style is:inline set:html={selectionRules(ids)}>')
  })
})

describe('the picker in a browser page', () => {
  it('shows the first preset when nothing is stored', async () => {
    const { active } = await page('rs', { storage: memory() })
    expect(active()).toEqual(['shorthand'])
  })

  it('shows the preset last chosen for the port', async () => {
    const { active, checked, reachable, document } = await page('rs', { storage: memory({ [`${STORAGE_PREFIX}rs`]: 'environment' }) })
    expect(active()).toEqual(['environment'])
    expect(checked()).toEqual(['environment'])
    expect(reachable()).toEqual(['environment'])
    expect(document.querySelector('summary')?.getAttribute('aria-label')).toBe('Preset: Environment')
    expect(document.querySelector('[data-preset-option="environment"] .doc-picker-check')?.hasAttribute('hidden')).toBe(false)
    expect(document.querySelector('[data-preset-option="shorthand"] .doc-picker-check')?.hasAttribute('hidden')).toBe(true)
  })

  it('ignores a stored preset the port does not offer, and one stored for another port', async () => {
    expect((await page('rs', { storage: memory({ [`${STORAGE_PREFIX}rs`]: 'not-a-preset' }) })).active()).toEqual(['shorthand'])
    expect((await page('rs', { storage: memory({ [`${STORAGE_PREFIX}go`]: 'environment' }) })).active()).toEqual(['shorthand'])
  })

  it('shows the first preset when storage throws', async () => {
    const { active, choose } = await page('rs', { storage: 'throws' })
    expect(active()).toEqual(['shorthand'])
    expect(() => choose('environment')).not.toThrow()
  })

  it('prefers the address\'s preset to the stored one', async () => {
    const { active, checked } = await page('rs', { url: 'https://libtmux.org/en/rs/latest/workspace/?preset=start-directory', storage: memory({ [`${STORAGE_PREFIX}rs`]: 'environment' }) })
    expect(active()).toEqual(['start-directory'])
    expect(checked()).toEqual(['start-directory'])
  })

  it('swaps the active panel on a click, remembers the choice and records it in the address', async () => {
    const store = memory()
    const { active, checked, reachable, choose, win, document } = await page('rs', { storage: store })
    choose('four-pane')
    expect(active()).toEqual(['four-pane'])
    expect(checked()).toEqual(['four-pane'])
    expect(reachable()).toEqual(['four-pane'])
    expect(store.values.get(`${STORAGE_PREFIX}rs`)).toBe('four-pane')
    expect(win.location.search).toBe('?preset=four-pane')
    expect(document.querySelector('[data-picker-announce]')?.textContent).toBe('Preset: Four panes')
    choose('environment')
    expect(active()).toEqual(['environment'])
    expect(win.location.search).toBe('?preset=environment')
  })

  it('still swaps when the address cannot be rewritten', async () => {
    const { active, choose, win } = await page('rs', { storage: memory() })
    win.history.replaceState = () => { throw new DOMException('denied', 'SecurityError') }
    choose('environment')
    expect(active()).toEqual(['environment'])
  })

  it('closes the menu on a choice, keeps the click from following the link and returns focus to the trigger', async () => {
    const { document, chip, win } = await page('rs', { storage: memory() })
    const menu = document.querySelector<HTMLDetailsElement>('details[data-preset-menu]')!
    menu.open = true
    const event = new win.MouseEvent('click', { bubbles: true, cancelable: true })
    chip('four-pane').dispatchEvent(event as unknown as Event)
    expect(event.defaultPrevented).toBe(true)
    expect(menu.open).toBe(false)
    expect(document.activeElement).toBe(menu.querySelector('summary'))
    // A modified click is left to the browser, so "open in a new tab" still works.
    const modified = new win.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })
    chip('environment').dispatchEvent(modified as unknown as Event)
    expect(modified.defaultPrevented).toBe(false)
    expect(document.querySelector('libtmux-workspace-picker')!.getAttribute('data-selected')).toBe('four-pane')
  })

  it('points every row at the page with its own preset, keeping the rest of the address', async () => {
    const { chip } = await page('rs', { url: 'https://libtmux.org/en/rs/latest/workspace/?a=1#x', storage: memory() })
    expect(chip('four-pane').getAttribute('href')).toBe('/en/rs/latest/workspace/?a=1&preset=four-pane#x')
  })

  it('rolls to another preset every time, whatever the roll returns', async () => {
    const store = memory()
    const values = [0, 0.999, 0.5, 1, 0, 0, 0.3]
    let index = 0
    const { active, click, document } = await page('rs', { storage: store, random: () => values[index++ % values.length]! })
    const seen = new Set<string>()
    for (let roll = 0; roll < 40; roll++) {
      const before = active()[0]
      click(document.querySelector('[data-action="roll"]')!)
      const after = active()[0]!
      expect(after, `roll ${roll}`).not.toBe(before)
      expect(store.values.get(`${STORAGE_PREFIX}rs`)).toBe(after)
      seen.add(after)
    }
    expect(seen.size).toBeGreaterThan(2)
  })

  it('chooses a window with a click or an arrow key, in its own preset only', async () => {
    const { document, click, press, choose } = await page('rs', { storage: memory() })
    choose('start-directory')
    const panel = document.querySelector('[data-preset="start-directory"]')!
    panel.inert = false
    const tabs = [...panel.querySelectorAll<HTMLElement>('[role="tab"]')]
    const figures = [...panel.querySelectorAll<HTMLElement>('[data-window]')]
    const shown = () => figures.map((figure) => figure.hasAttribute('data-active'))
    click(tabs[2]!)
    expect(shown()).toEqual([false, false, true, false, false])
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true', 'false', 'false'])
    press(panel.querySelector('[role="tablist"]')!, 'ArrowRight')
    press(panel.querySelector('[role="tablist"]')!, 'ArrowRight')
    expect(shown()).toEqual([false, false, false, false, true])
    press(panel.querySelector('[role="tablist"]')!, 'Home')
    expect(shown()).toEqual([true, false, false, false, false])
    expect(tabs[0]!.tabIndex).toBe(0)
    expect(tabs[3]!.tabIndex).toBe(-1)
    const other = document.querySelector('[data-preset="shorthand"] [data-window]')!
    expect(other.hasAttribute('data-active')).toBe(true)
  })

  it('registers once however many times it is loaded', async () => {
    const { win } = await page('rs', { storage: memory() })
    expect(() => win.eval(`(() => {\n${CLIENT}\ndefineWorkspacePicker()\n})()`)).not.toThrow()
  })
})

describe('the slider under the window tabs', () => {
  it('has no thumb when the strip does not overflow, or has no room', () => {
    expect(thumbMetrics(300, 300, 0, 200)).toBeUndefined()
    expect(thumbMetrics(300.5, 300, 0, 200)).toBeUndefined()
    expect(thumbMetrics(800, 300, 0, 0)).toBeUndefined()
    expect(thumbMetrics(800, 0, 0, 200)).toBeUndefined()
  })

  it('sizes the thumb to the part that shows and places it by the scroll position', () => {
    expect(thumbMetrics(800, 400, 0, 200)).toEqual({ width: 100, left: 0 })
    expect(thumbMetrics(800, 400, 200, 200)).toEqual({ width: 100, left: 50 })
    expect(thumbMetrics(800, 400, 400, 200)).toEqual({ width: 100, left: 100 })
    // A scroll position outside the range stays on the track.
    expect(thumbMetrics(800, 400, -30, 200)!.left).toBe(0)
    expect(thumbMetrics(800, 400, 900, 200)!.left).toBe(100)
  })

  it('never makes the thumb narrower than a finger can take, nor wider than the track', () => {
    expect(thumbMetrics(100000, 300, 0, 200)!.width).toBe(24)
    expect(thumbMetrics(100000, 300, 0, 200, 40)!.width).toBe(40)
    expect(thumbMetrics(800, 400, 0, 10)!.width).toBe(10)
  })

  it('turns a drag of the thumb back into a scroll position, and stays in range', () => {
    // Thumb 100 wide on a 200 track, a strip that scrolls 400: one thumb pixel is four scroll pixels.
    expect(scrollForThumb(25, 0, 800, 400, 200, 100)).toBe(100)
    expect(scrollForThumb(-25, 200, 800, 400, 200, 100)).toBe(100)
    expect(scrollForThumb(500, 0, 800, 400, 200, 100)).toBe(400)
    expect(scrollForThumb(-500, 200, 800, 400, 200, 100)).toBe(0)
    expect(scrollForThumb(10, 7, 300, 300, 200, 100)).toBe(7)
    expect(scrollForThumb(10, 7, 800, 400, 100, 100)).toBe(7)
    // What the thumb shows and what a drag means agree.
    const at = thumbMetrics(900, 350, 275, 240)!
    expect(scrollForThumb(at.left, 0, 900, 350, 240, at.width)).toBeCloseTo(275, 6)
  })
})

describe('the scroll controls as rendered', () => {
  it('give a preset with several windows two labelled buttons and a slider, hidden until the strip overflows', async () => {
    const { document } = await page('rs')
    const panel = document.querySelector('[data-preset="start-directory"]')!
    const buttons = [...panel.querySelectorAll<HTMLButtonElement>('.ws-layout__scroll')]
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['Scroll windows left', 'Scroll windows right'])
    expect(buttons.every((button) => button.type === 'button' && button.hasAttribute('hidden'))).toBe(true)
    expect(buttons.map((button) => button.dataset.scroll)).toEqual(['-1', '1'])
    const slider = panel.querySelector('[data-slider]')!
    expect(slider.hasAttribute('hidden')).toBe(true)
    expect(slider.getAttribute('aria-hidden')).toBe('true')
    expect(slider.querySelector('[data-thumb]')).not.toBeNull()
    // The tab list holds tabs and nothing else, so a screen reader hears only windows.
    const list = panel.querySelector('[role="tablist"]')!
    expect([...list.children].every((child) => child.getAttribute('role') === 'tab')).toBe(true)
    expect(list.querySelector('.ws-layout__scroll, [data-slider]')).toBeNull()
  })

  it('give a preset with one window none, since one tab cannot overflow', async () => {
    const { document } = await page('rs')
    const panel = document.querySelector('[data-preset="shorthand"]')!
    expect(panel.querySelectorAll('[role="tab"]')).toHaveLength(1)
    expect(panel.querySelector('.ws-layout__scroll, [data-slider]')).toBeNull()
  })

  it('keep the first window the first child of its stack, which the rule for a page without script relies on', async () => {
    const { document } = await page('rs')
    for (const stack of document.querySelectorAll('.ws-layout__stack')) expect(stack.firstElementChild?.classList.contains('ws-win')).toBe(true)
  })
})

describe('the scroll controls in a browser page', () => {
  /** A strip that overflows by the given amounts, in a page that has no layout of its own. */
  async function overflowing({ scrollWidth = 800, clientWidth = 300, scrollLeft = 0 }: { scrollWidth?: number; clientWidth?: number; scrollLeft?: number } = {}) {
    const run = await page('rs', { storage: memory() })
    // Only the preset on show can take focus, so this is the one the strip is read on.
    run.choose('start-directory')
    const panel = run.document.querySelector('[data-preset="start-directory"]')!
    const strip = panel.querySelector<HTMLElement>('[role="tablist"]')!
    const slider = panel.querySelector<HTMLElement>('[data-slider]')!
    const thumb = panel.querySelector<HTMLElement>('[data-thumb]')!
    const [start, end] = [...panel.querySelectorAll<HTMLButtonElement>('.ws-layout__scroll')]
    const state = { scrollWidth, clientWidth, scrollLeft }
    for (const key of ['scrollWidth', 'clientWidth', 'scrollLeft'] as const) {
      Object.defineProperty(strip, key, { configurable: true, get: () => state[key], set: (value: number) => { state[key] = value } })
    }
    Object.defineProperty(slider, 'clientWidth', { configurable: true, value: 200 })
    const scrolls: ScrollToOptions[] = []
    strip.scrollBy = ((options: ScrollToOptions) => { scrolls.push(options) }) as typeof strip.scrollBy
    const sync = () => strip.dispatchEvent(new run.win.Event('scroll') as unknown as Event)
    sync()
    return { ...run, strip, slider, thumb, start: start!, end: end!, state, scrolls, sync }
  }

  it('show the end button and the slider, and not the start button, at the start of an overflowing strip', async () => {
    const { start, end, slider, thumb } = await overflowing()
    expect(start.hidden).toBe(true)
    expect(end.hidden).toBe(false)
    expect(slider.hidden).toBe(false)
    expect(thumb.style.width).toBe('75px')
    expect(thumb.style.transform).toBe('translateX(0px)')
  })

  it('show both buttons in the middle and only the start button at the end, with the thumb following', async () => {
    const run = await overflowing()
    run.state.scrollLeft = 250
    run.sync()
    expect([run.start.hidden, run.end.hidden]).toEqual([false, false])
    expect(run.thumb.style.transform).toBe('translateX(62.5px)')
    run.state.scrollLeft = 500
    run.sync()
    expect([run.start.hidden, run.end.hidden]).toEqual([false, true])
    expect(run.thumb.style.transform).toBe('translateX(125px)')
  })

  it('show nothing when the strip fits, and again when it stops fitting', async () => {
    const run = await overflowing({ scrollWidth: 300 })
    expect([run.start.hidden, run.end.hidden, run.slider.hidden]).toEqual([true, true, true])
    run.state.scrollWidth = 900
    run.sync()
    expect([run.start.hidden, run.end.hidden, run.slider.hidden]).toEqual([true, false, false])
  })

  it('scroll about one tab with a click, toward the button', async () => {
    const run = await overflowing({ scrollLeft: 250 })
    const first = run.document.querySelector('[data-preset="start-directory"] [role="tab"]') as unknown as HTMLElement
    Object.defineProperty(first, 'offsetWidth', { configurable: true, value: 140 })
    run.click(run.end)
    run.click(run.start)
    expect(run.scrolls.map((scroll) => scroll.left)).toEqual([140, -140])
    // A tab narrower than a button's worth still moves the strip a useful step.
    Object.defineProperty(first, 'offsetWidth', { configurable: true, value: 20 })
    run.click(run.end)
    expect(run.scrolls.at(-1)!.left).toBe(80)
  })

  it('hand focus to the selected tab when the button that has it goes away', async () => {
    const run = await overflowing({ scrollLeft: 450 })
    run.end.focus()
    expect(run.document.activeElement).toBe(run.end)
    run.state.scrollLeft = 500
    run.sync()
    expect(run.end.hidden).toBe(true)
    expect(run.document.activeElement).toBe(run.document.querySelector('[data-preset="start-directory"] [role="tab"][aria-selected="true"]'))
  })

  it('drag the thumb to scroll the strip, and stop when the pointer is let go', async () => {
    const run = await overflowing({ scrollLeft: 100 })
    const pointer = (type: string, x: number) => run.thumb.dispatchEvent(Object.assign(new run.win.Event(type, { bubbles: true, cancelable: true }), { clientX: x, pointerId: 1 }) as unknown as Event)
    run.thumb.setPointerCapture = () => {}
    run.thumb.setPointerCapture = () => {}
    Object.defineProperty(run.thumb, 'offsetWidth', { configurable: true, value: 75 })
    pointer('pointerdown', 10)
    pointer('pointermove', 20)
    // Ten thumb pixels on a track with 125 spare is ten times 500 over 125 scroll pixels.
    expect(run.state.scrollLeft).toBe(140)
    pointer('pointerup', 20)
    pointer('pointermove', 60)
    expect(run.state.scrollLeft).toBe(140)
  })

  it('page toward a press on the track, a little less than a strip\'s width', async () => {
    const run = await overflowing()
    Object.defineProperty(run.thumb, 'getBoundingClientRect', { configurable: true, value: () => ({ left: 50, right: 125 }) })
    const press = (x: number, target: Element) => target.dispatchEvent(Object.assign(new run.win.Event('pointerdown', { bubbles: true, cancelable: true }), { clientX: x }) as unknown as Event)
    press(150, run.slider)
    press(10, run.slider)
    press(60, run.thumb)
    expect(run.scrolls.map((scroll) => scroll.left)).toEqual([240, -240])
  })
})

describe('the keys a preset uses', () => {
  it('lists the workspace keys at every level, once each, in order of appearance', () => {
    const config = { session_name: 'x', windows: [{ window_name: 'a', panes: [{ shell_command: ['ls'], focus: true }, 'echo hi'] }, { window_name: 'b', panes: [{ focus: true }] }] }
    expect(configKeys(config)).toEqual(['session_name', 'windows', 'window_name', 'panes', 'shell_command', 'focus'])
  })

  it('does not take an author\'s variable or option name for a workspace key', () => {
    const config = { environment: { MY_VARIABLE: '1' }, options: { 'main-pane-height': '50%' }, windows: [{ window_name: 'a', options_after: { 'synchronize-panes': 'on' }, panes: ['x'] }] }
    const keys = configKeys(config)
    expect(keys).toEqual(expect.arrayContaining(['environment', 'options', 'options_after']))
    expect(keys).not.toContain('MY_VARIABLE')
    expect(keys).not.toContain('main-pane-height')
    expect(keys).not.toContain('synchronize-panes')
  })

  it('finds what each rs preset exercises', () => {
    const options = presetOptions(workspaceShowcase('rs')!)
    expect(options.find((option) => option.id === 'environment')!.keys).toContain('environment')
    expect(options.find((option) => option.id === 'sleep')!.keys.some((key) => key.startsWith('sleep_'))).toBe(true)
    expect(options.find((option) => option.id === 'window-index')!.keys).toContain('window_index')
  })
})

describe('every window of a preset', () => {
  it('is drawn in tmux\'s order, each with its own index and unique ids', () => {
    const config = { windows: [
      { window_name: 'zero', panes: ['a'] },
      { window_name: 'five', window_index: 5, panes: ['b', 'c'] },
      { window_name: 'one', panes: ['d'] },
      { window_name: 'empty' },
    ] }
    const drawn = previewWindows(config, 'probe')
    // A window that lists no panes is still a window, and takes the lowest free index.
    expect(drawn.map((win) => [win.index, win.name, win.panes])).toEqual([[0, 'zero', 1], [1, 'one', 1], [2, 'empty', 0], [5, 'five', 2]])
    expect(new Set(drawn.map((win) => /id="([^"]+)-clip-0"/.exec(win.svg)![1])).size).toBe(drawn.length)
    expect(drawn[0]!.svg).toContain('id="probe-w0-clip-0"')
  })

  it('leaves out a window whose layout is a saved layout string', () => {
    const config = { windows: [{ window_name: 'saved', layout: '5e2d,80x24,0,0{40x24,0,0,0,39x24,41,0,1}', panes: ['a', 'b'] }, { window_name: 'plain', panes: ['c'] }] }
    expect(previewWindows(config, 'probe').map((win) => win.name)).toEqual(['plain'])
  })
})

describe('previewing a preset on hover', () => {
  const setup = async (hover = true) => {
    vi.useFakeTimers()
    const p = await page('rs')
    // The picker's clock and media query are the window's own; point them at the fakes.
    p.win.setTimeout = ((fn: () => void, ms: number) => setTimeout(fn, ms)) as unknown as typeof p.win.setTimeout
    p.win.clearTimeout = ((id: number) => clearTimeout(id)) as unknown as typeof p.win.clearTimeout
    p.win.matchMedia = (() => ({ matches: hover })) as unknown as typeof p.win.matchMedia
    const ids = [...p.document.querySelectorAll<HTMLElement>('[data-preset]')].map((panel) => panel.dataset.preset!)
    const menu = p.document.querySelector<HTMLDetailsElement>('[data-preset-menu]')!
    menu.open = true
    const other = ids[1]!
    const enter = (id: string, pointerType = 'mouse') => p.chip(id).dispatchEvent(new p.win.PointerEvent('pointerenter', { pointerType }) as unknown as Event)
    const leave = (id: string) => p.chip(id).dispatchEvent(new p.win.PointerEvent('pointerleave') as unknown as Event)
    return { ...p, ids, other, enter, leave, menu }
  }
  afterEach(() => void vi.useRealTimers())

  it('shows the hovered preset after the home page delay and restores on leave, keeping the choice', async () => {
    const p = await setup()
    const first = p.ids[0]!
    const url = p.win.location.href
    expect(HOME_PREVIEW_DELAY).toBe(1200)
    p.enter(p.other)
    vi.advanceTimersByTime(1199)
    expect(p.active()).toEqual([first])
    vi.advanceTimersByTime(HOME_PREVIEW_DELAY - 1199 - 1)
    expect(p.active()).toEqual([first])
    vi.advanceTimersByTime(1)
    expect(p.active()).toEqual([p.other])
    expect(p.reachable()).toEqual([p.other])
    expect(p.checked()).toEqual([first])
    expect(p.win.location.href).toBe(url)
    p.leave(p.other)
    expect(p.active()).toEqual([first])
    expect(p.reachable()).toEqual([first])
  })

  it('commits on click without reverting', async () => {
    const p = await setup()
    p.enter(p.other)
    vi.advanceTimersByTime(HOME_PREVIEW_DELAY)
    p.choose(p.other)
    p.leave(p.other)
    expect(p.active()).toEqual([p.other])
    expect(p.checked()).toEqual([p.other])
    expect(new URL(p.win.location.href).searchParams.get('preset')).toBe(p.other)
  })

  it('does not preview a click made before the delay ends', async () => {
    const p = await setup()
    p.enter(p.other)
    vi.advanceTimersByTime(HOME_PREVIEW_DELAY - 1)
    p.choose(p.other)
    vi.advanceTimersByTime(HOME_PREVIEW_DELAY)
    p.leave(p.other)
    expect(p.active()).toEqual([p.other])
  })

  it('never previews without any-hover, or for touch', async () => {
    const p = await setup(false)
    p.enter(p.other)
    vi.advanceTimersByTime(HOME_PREVIEW_DELAY * 2)
    expect(p.active()).toEqual([p.ids[0]])
    const q = await setup()
    q.enter(q.other, 'touch')
    vi.advanceTimersByTime(HOME_PREVIEW_DELAY * 2)
    expect(q.active()).toEqual([q.ids[0]])
  })

  it('restores on Escape and when the menu closes', async () => {
    const p = await setup()
    p.enter(p.other)
    vi.advanceTimersByTime(HOME_PREVIEW_DELAY)
    expect(p.active()).toEqual([p.other])
    p.document.dispatchEvent(new p.win.KeyboardEvent('keydown', { key: 'Escape' }) as unknown as Event)
    expect(p.active()).toEqual([p.ids[0]])
    p.enter(p.other)
    vi.advanceTimersByTime(HOME_PREVIEW_DELAY)
    expect(p.active()).toEqual([p.other])
    p.menu.open = false
    p.menu.dispatchEvent(new p.win.Event('toggle') as unknown as Event)
    expect(p.active()).toEqual([p.ids[0]])
  })
})

describe('window tab names', () => {
  const NAME = 'Another Django project'
  /** A viewport narrower than the label clips it; layout is stubbed because the DOM has none. */
  const setup = async (viewport: number) => {
    vi.useFakeTimers()
    const p = await page('rs')
    p.win.setTimeout = ((fn: () => void, ms: number) => setTimeout(fn, ms)) as unknown as typeof p.win.setTimeout
    p.win.clearTimeout = ((id: number) => clearTimeout(id)) as unknown as typeof p.win.clearTimeout
    const panel = p.document.querySelector<HTMLElement>('[data-preset="start-directory"]')!
    const tab = panel.querySelector<HTMLElement>('[role="tab"]')!
    const label = tab.querySelector<HTMLElement>('.ws-layout__tab-label')!
    label.textContent = `0:${NAME}`
    Object.defineProperty(label, 'scrollWidth', { configurable: true, value: 200 })
    Object.defineProperty(label, 'clientWidth', { configurable: true, value: viewport >= 1280 ? 240 : 120 })
    const tip = p.document.querySelector<HTMLElement>('[role="tooltip"]')!
    const hover = () => { tab.dispatchEvent(new p.win.PointerEvent('pointerenter', { pointerType: 'mouse' }) as unknown as Event); vi.advanceTimersByTime(HOVER_OPEN) }
    const focus = () => tab.dispatchEvent(new p.win.FocusEvent('focus') as unknown as Event)
    return { ...p, tab, label, tip, hover, focus }
  }
  afterEach(() => void vi.useRealTimers())

  it('ellipsizes in the label, not the flex button, and names the tab by its full text', async () => {
    const css = readFileSync(new URL('../src/styles/workspace-picker.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.ws-layout__tab-label\s*\{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap/)
    const p = await setup(390)
    expect(p.tab.textContent).toBe(`0:${NAME}`)
    expect(p.tab.hasAttribute('title')).toBe(false)
    expect(p.tab.hasAttribute('aria-label')).toBe(false)
  })

  it('wires a role=tooltip to a clipped tab on hover and focus at 390', async () => {
    const p = await setup(390)
    expect(p.tip.getAttribute('role')).toBe('tooltip')
    expect(p.tip.hidden).toBe(true)
    p.hover()
    expect(p.tip.hidden).toBe(false)
    expect(p.tip.textContent).toBe(`0:${NAME}`)
    expect(p.tab.getAttribute('aria-describedby')).toBe(p.tip.id)
    expect(p.document.getElementById(p.tip.id)).toBe(p.tip)
    const q = await setup(390)
    q.focus()
    expect(q.tip.hidden).toBe(false)
    expect(q.tab.getAttribute('aria-describedby')).toBe(q.tip.id)
  })

  it('waits the status badge delay before a hover opens it', async () => {
    const p = await setup(390)
    p.tab.dispatchEvent(new p.win.PointerEvent('pointerenter', { pointerType: 'mouse' }) as unknown as Event)
    vi.advanceTimersByTime(HOVER_OPEN - 1)
    expect(p.tip.hidden).toBe(true)
    vi.advanceTimersByTime(1)
    expect(p.tip.hidden).toBe(false)
  })

  it('dismisses with Escape, leaving focus where it is', async () => {
    const p = await setup(390)
    p.tab.focus()
    p.focus()
    expect(p.tip.hidden).toBe(false)
    p.document.dispatchEvent(new p.win.KeyboardEvent('keydown', { key: 'Escape', cancelable: true }) as unknown as Event)
    expect(p.tip.hidden).toBe(true)
    expect(p.tab.hasAttribute('aria-describedby')).toBe(false)
    expect(p.document.activeElement).toBe(p.tab)
    p.focus()
    expect(p.tip.hidden).toBe(true)
  })

  it('stays while the pointer moves onto the tooltip, and closes once it leaves', async () => {
    const p = await setup(390)
    p.hover()
    p.tab.dispatchEvent(new p.win.PointerEvent('pointerleave') as unknown as Event)
    p.tip.dispatchEvent(new p.win.PointerEvent('pointerenter') as unknown as Event)
    vi.advanceTimersByTime(1000)
    expect(p.tip.hidden).toBe(false)
    p.tip.dispatchEvent(new p.win.PointerEvent('pointerleave') as unknown as Event)
    vi.advanceTimersByTime(1000)
    expect(p.tip.hidden).toBe(true)
  })

  it('closes a clipped tab\'s tooltip when the pointer or focus moves to a tab that fits', async () => {
    const p = await setup(390)
    const next = p.tab.parentElement!.querySelectorAll<HTMLElement>('[role="tab"]')[1]!
    const text = next.querySelector<HTMLElement>('.ws-layout__tab-label')!
    Object.defineProperty(text, 'scrollWidth', { configurable: true, value: 50 })
    Object.defineProperty(text, 'clientWidth', { configurable: true, value: 120 })
    p.hover()
    p.tab.dispatchEvent(new p.win.PointerEvent('pointerleave') as unknown as Event)
    next.dispatchEvent(new p.win.PointerEvent('pointerenter', { pointerType: 'mouse' }) as unknown as Event)
    next.dispatchEvent(new p.win.PointerEvent('pointerleave') as unknown as Event)
    vi.advanceTimersByTime(2000)
    expect(p.tip.hidden).toBe(true)
    expect(p.tab.hasAttribute('aria-describedby')).toBe(false)
    p.focus()
    expect(p.tip.hidden).toBe(false)
    next.dispatchEvent(new p.win.FocusEvent('focus') as unknown as Event)
    expect(p.tip.hidden).toBe(true)
  })

  it('gives a name that fits no tooltip', async () => {
    const p = await setup(1280)
    p.hover()
    p.focus()
    expect(p.tip.hidden).toBe(true)
    expect(p.tab.hasAttribute('aria-describedby')).toBe(false)
    expect(p.label.scrollWidth).toBeLessThanOrEqual(p.label.clientWidth)
  })
})
