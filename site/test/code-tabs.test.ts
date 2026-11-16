import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import ts from 'typescript'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { rehypeCodeTabs } from '../src/plugins/rehype-code-tabs.mjs'

/** The browser probe and DOM tests share real Markdown and the owned component. */
const fixture = readFileSync(new URL('./fixtures/browser-code-tabs.md', import.meta.url), 'utf8')
const component = readFileSync(new URL('../src/components/CodeTabs.astro', import.meta.url), 'utf8')
const script = /<script>([\s\S]*?)<\/script>/.exec(component)![1]
const client = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

describe('code tabs', () => {
  let window: Window
  let document: Document
  let html: string
  const windows: Window[] = []

  const load = (stored?: string) => {
    window = new Window({ url: 'https://libtmux.org/en/code-tabs-probe/' })
    windows.push(window)
    document = window.document as unknown as Document
    if (stored) window.localStorage.setItem('libtmux-code-tab', stored)
    document.body.innerHTML = html
    window.eval(`(() => {\n${client}\n})()`)
    return { window, document }
  }

  beforeAll(async () => {
    const renderer = await createMarkdownProcessor({ rehypePlugins: [rehypeCodeTabs], syntaxHighlight: false })
    html = (await renderer.render(fixture)).code
    load()
  })

  afterAll(async () => {
    await Promise.all(windows.map((instance) => instance.happyDOM.close()))
  })

  it('renders one group with a tab per port', () => {
    const groups = document.querySelectorAll('libtmux-code-tabs')
    expect(groups.length).toBeGreaterThan(0)
    const tabs = groups[0].querySelectorAll('.code-tab')
    expect(tabs.length).toBeGreaterThan(1)
    expect(groups).toHaveLength(2)
    expect(document.querySelectorAll('li')).toHaveLength(60)
    expect(groups[0].querySelector('.code-tab[data-port="cxx"]')).not.toBeNull()
  })

  it('shows exactly one panel at a time', () => {
    const panels = [...document.querySelectorAll('.code-tab-panel')]
    const visible = panels.filter((p) => !(p as HTMLElement).hidden)
    expect(visible.length).toBe(document.querySelectorAll('libtmux-code-tabs').length)
  })

  it('switches to the clicked language', () => {
    const group = document.querySelector('libtmux-code-tabs')!
    const rust = group.querySelector<HTMLElement>('.code-tab[data-port="rs"]')
    expect(rust, 'a Rust tab').toBeTruthy()
    rust!.click()
    expect(rust!.getAttribute('aria-selected')).toBe('true')
    const shown = [...group.querySelectorAll<HTMLElement>('.code-tab-panel')].filter((p) => !p.hidden)
    expect(shown.length).toBe(1)
    expect(shown[0].dataset.port).toBe('rs')
  })

  it('remembers the choice for the next page', () => {
    const group = document.querySelector('libtmux-code-tabs')!
    group.querySelector<HTMLElement>('.code-tab[data-port="go"]')!.click()
    expect(window.localStorage.getItem('libtmux-code-tab')).toBe('go')

    // A fresh page load with that preference stored opens on Go, not Python.
    const fresh = load('go')
    const panel = [...fresh.document.querySelectorAll<HTMLElement>('.code-tab-panel')].find(
      (p) => !p.hidden,
    )
    expect(panel?.dataset.port).toBe('go')
  })

  it('leaves a group alone when it lacks the chosen language', () => {
    // Not every page documents all eight. Blanking a group that has no Swift
    // block would be a worse answer than showing what it does have.
    const fresh = load('swift')
    for (const group of fresh.document.querySelectorAll('libtmux-code-tabs')) {
      const shown = [...group.querySelectorAll<HTMLElement>('.code-tab-panel')].filter(
        (p) => !p.hidden,
      )
      expect(shown.length, 'exactly one panel per group').toBe(1)
    }
  })

  it('initializes real groups inserted after the component is registered', () => {
    const current = load()
    const replacement = current.document.createElement('template')
    replacement.innerHTML = html
    current.document.body.replaceChildren(replacement.content.cloneNode(true))
    current.document.querySelector<HTMLElement>('.code-tab[data-port="cxx"]')!.click()
    const selected = [...current.document.querySelectorAll('.code-tab[aria-selected="true"]')]
    expect(selected).toHaveLength(2)
    expect(selected.every((tab) => tab.getAttribute('data-port') === 'cxx')).toBe(true)
    const visible = [...current.document.querySelectorAll<HTMLElement>('.code-tab-panel')]
      .filter((panel) => !panel.hidden)
    expect(visible).toHaveLength(2)
    expect(visible.every((panel) => panel.dataset.port === 'cxx')).toBe(true)
  })
  describe('keyboard and names', () => {
    const press = (tab: Element, key: string) => {
      const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      tab.dispatchEvent(event as unknown as Event)
      return event
    }
    const selectedPort = (group: Element) =>
      group.querySelector('.code-tab[aria-selected="true"]')!.getAttribute('data-port')

    it('moves to the first and last tab with Home and End, and keeps focus on it', () => {
      const { document } = load()
      const group = document.querySelector('libtmux-code-tabs')!
      const tabs = [...group.querySelectorAll<HTMLElement>('.code-tab')]
      expect(selectedPort(group)).toBe(tabs[0]!.dataset.port)
      const end = press(tabs[0]!, 'End')
      expect(end.defaultPrevented, 'the page does not scroll to its end').toBe(true)
      expect(selectedPort(group)).toBe(tabs.at(-1)!.dataset.port)
      expect(document.activeElement).toBe(tabs.at(-1))
      expect(tabs.at(-1)!.tabIndex).toBe(0)
      expect(tabs[0]!.tabIndex).toBe(-1)
      press(tabs.at(-1)!, 'Home')
      expect(selectedPort(group)).toBe(tabs[0]!.dataset.port)
      expect(document.activeElement).toBe(tabs[0])
    })

    it('still wraps with the arrow keys and leaves other keys alone', () => {
      const { document } = load()
      const group = document.querySelector('libtmux-code-tabs')!
      const tabs = [...group.querySelectorAll<HTMLElement>('.code-tab')]
      press(tabs[0]!, 'ArrowLeft')
      expect(selectedPort(group)).toBe(tabs.at(-1)!.dataset.port)
      press(tabs.at(-1)!, 'ArrowRight')
      expect(selectedPort(group)).toBe(tabs[0]!.dataset.port)
      expect(press(tabs[0]!, 'a').defaultPrevented).toBe(false)
    })

    it('names what the tabs choose and pairs every tab with its panel', () => {
      const { document } = load()
      for (const group of document.querySelectorAll('libtmux-code-tabs')) {
        expect(group.querySelector('[role="tablist"]')!.getAttribute('aria-label')).toBe('Programming language')
        for (const tab of group.querySelectorAll('.code-tab')) {
          const panel = group.querySelector(`#${tab.getAttribute('aria-controls')}`)!
          expect(panel.getAttribute('role')).toBe('tabpanel')
          expect(panel.getAttribute('aria-labelledby')).toBe(tab.id)
          expect(panel.getAttribute('tabindex')).toBe('0')
        }
      }
      const ids = [...document.querySelectorAll('[id^="code-tab"]')].map((element) => element.id)
      expect(ids.length).toBeGreaterThan(8)
      expect(new Set(ids).size, 'ids are unique across the groups of a page').toBe(ids.length)
    })
  })
})
