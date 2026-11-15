import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { createComponent, renderTemplate } from 'astro/runtime/server/index.js'
import { afterEach, describe, expect, it } from 'vitest'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

/**
 * Zero layout shift on a port landing (design system, CorePlayer and ProductTabs: stepping, hovering,
 * switching views and tabs shift nothing). Each rule below is a change a script used to make after the first
 * paint, decided in the markup and the stylesheet instead. `scripts/check-landing-shift.mjs` measures the same
 * pages in a browser.
 */
const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const showcase = read('components/CoreShowcase.astro')

const Code = createComponent((_result: unknown, props: { code: string }) => renderTemplate`<pre data-code>${props.code}</pre>`)
const windows: Window[] = []
afterEach(async () => { await Promise.all(windows.splice(0).map((window) => window.happyDOM.close())) })

async function renderShowcase(port: string) {
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

/** The rule block for `selector` inside `css`, comments removed; every rule that names it, joined. */
function rules(css: string, selector: string) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const found: string[] = []
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  for (let match = pattern.exec(clean); match; match = pattern.exec(clean)) {
    if (match[1]!.split(',').some((part) => part.trim() === selector)) found.push(match[2]!)
  }
  return found.join(';')
}

describe('the capability list at a phone width', () => {
  /** True when the server draws the list open, which a phone's script then closes and the page below moves up. */
  const drawsOpen = (html: string) => /<details\b[^>]*\bcore-showcase__picker[^>]*\sopen(=|\s|>)/.test(html)

  it('is drawn closed, so the script has nothing to close after the first paint', async () => {
    const doc = await renderShowcase('rs')
    const picker = doc.querySelector('details.core-showcase__picker')!
    expect(picker, 'rs offers three programs, so it has a list').not.toBeNull()
    expect(picker.hasAttribute('open'), 'an open list is height a phone loses when the script closes it').toBe(false)
  })

  it('still lists the capabilities beside the program from 56rem, open or not', () => {
    const wide = showcase.slice(showcase.lastIndexOf('@media (min-width: 56rem)'))
    expect(rules(wide, '.core-showcase__picker::details-content')).toMatch(/content-visibility: visible/)
  })

  it('has a negative case: markup drawn open is what the check refuses', () => {
    expect(drawsOpen('<details class="core-showcase__picker" open><summary>x</summary></details>')).toBe(true)
    expect(drawsOpen('<details class="core-showcase__picker"><summary>x</summary></details>')).toBe(false)
  })
})

describe('the capability tabs', () => {
  it('reserve the semibold width, so moving the current tab changes no tab\'s width', async () => {
    const doc = await renderShowcase('rs')
    for (const label of doc.querySelectorAll('[data-capability-option] [data-text]')) {
      expect(label.getAttribute('data-text'), 'the ghost repeats the label').toBe(label.textContent)
    }
    expect(doc.querySelectorAll('[data-capability-option]').length).toBeGreaterThan(1)
    expect(doc.querySelectorAll('[data-capability-option] [data-text]'), 'every tab reserves').toHaveLength(doc.querySelectorAll('[data-capability-option]').length)
    const ghost = rules(showcase, '.core-showcase__label::after')
    expect(ghost).toMatch(/content: attr\(data-text\)/)
    expect(ghost).toMatch(/font-weight: 600/)
    expect(ghost).toMatch(/visibility: hidden/)
    expect(ghost).toMatch(/height: 0/)
  })
})
