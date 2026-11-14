import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { createComponent, renderTemplate } from 'astro/runtime/server/index.js'
import { afterEach, describe, expect, it } from 'vitest'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

/**
 * ProductTabs (design system): capabilities that only a script can switch to
 * stay reachable without one. Every capability's panel is stacked under its
 * title, and the list of anchors replaces the picker.
 */
const Code = createComponent((_result: unknown, props: { code: string }) => renderTemplate`<pre data-code>${props.code}</pre>`)
const source = readFileSync(new URL('../src/components/CoreShowcase.astro', import.meta.url), 'utf8')
const windows: Window[] = []
afterEach(async () => { await Promise.all(windows.splice(0).map((window) => window.happyDOM.close())) })

async function render(port: string) {
  const template = await loadAstroTemplate('components/CoreShowcase.astro', {
    stubs: {
      'components/HomeExample.astro': '---\n---\n<div data-home-example />',
      'components/core/CorePlayer.astro': '---\n---\n<div data-core-player />',
    },
    modules: { 'astro-expressive-code/components': { Code } },
  })
  const window = new Window()
  windows.push(window)
  window.document.body.innerHTML = await renderAstroTemplate(template, { url: `https://libtmux.org/${port}/latest/`, props: { port } })
  return window.document as unknown as Document
}

describe('capabilities without a script', () => {
  it('give every panel an anchor and a title, and list the anchors beside the picker', async () => {
    const doc = await render('rs')
    const panels = [...doc.querySelectorAll<HTMLElement>('[data-capability-panel]')]
    expect(panels.length).toBeGreaterThan(1)
    const anchors = [...doc.querySelectorAll('nav.core-showcase__static a')]
    expect(anchors.map((link) => link.getAttribute('href'))).toEqual(panels.map((panel) => `#capability-${panel.dataset.capabilityPanel}`))
    for (const panel of panels) {
      expect(panel.id).toBe(`capability-${panel.dataset.capabilityPanel}`)
      const label = doc.querySelector(`[data-capability-option="${panel.dataset.capabilityPanel}"] span`)!.firstChild!.textContent
      expect(panel.querySelector('.core-showcase__panel-title')!.textContent).toBe(label)
    }
    // The script's route is unchanged: the picker still carries `?capability=`.
    expect(doc.querySelector('[data-capability-option]')!.getAttribute('href')).toBe('?capability=typed-graph')
  })

  it('add neither a list nor titles where one capability is all there is', async () => {
    const doc = await render('ts')
    expect(doc.querySelector('.core-showcase__static, .core-showcase__panel-title')).toBeNull()
  })

  it('stack the panels and hide the picker only while the page has no script', () => {
    expect(source).toMatch(/:global\(html:not\(\[data-js\]\)\) \.core-showcase__panels \{ display: block; \}/)
    expect(source).toMatch(/:global\(html:not\(\[data-js\]\)\) \.core-showcase__panel \{ visibility: visible;/)
    expect(source).toMatch(/:global\(html:not\(\[data-js\]\)\) \.core-showcase__picker \{ display: none; \}/)
    // With a script the list and the titles stay hidden.
    expect(source).toMatch(/\.core-showcase__static, \.core-showcase__panel-title \{ display: none; \}/)
  })
})
