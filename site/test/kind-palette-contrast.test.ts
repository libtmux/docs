import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/styles/api-kinds.css', import.meta.url), 'utf8')
const FAMILIES = ['types', 'traits', 'callables', 'members', 'meta', 'tools']

const channel = (value: number) => {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16))
  return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!)
}
/** WCAG contrast ratio of two #rrggbb colours. */
const ratio = (a: string, b: string) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high! + 0.05) / (low! + 0.05)
}

/** The tokens one theme block declares, by name. */
const tokens = (block: string) => Object.fromEntries([...block.matchAll(/--mark-([a-z]+)-(bg|fg|hue|solid):\s*(#[0-9a-f]{6})/gi)]
  .map(([, family, part, value]) => [`${family}-${part}`, value!]))

const light = tokens(css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)')))
const dark = tokens(css.slice(css.indexOf(':root:not([data-color-scheme=\'light\'])'), css.indexOf('[data-color-scheme=\'dark\'] {')))
const forced = tokens(css.slice(css.indexOf('[data-color-scheme=\'dark\'] {'), css.indexOf('A kind joins a family')))

describe('kind palette contrast', () => {
  it.each(FAMILIES)('the %s glyph clears 4.5:1 on its fill in light and dark', (family) => {
    expect(ratio(light[`${family}-fg`]!, light[`${family}-bg`]!), `light ${family}`).toBeGreaterThanOrEqual(4.5)
    expect(ratio(dark[`${family}-fg`]!, dark[`${family}-bg`]!), `dark ${family}`).toBeGreaterThanOrEqual(4.5)
  })

  it('declares the dark preference and an explicit dark choice alike', () => {
    expect(forced).toEqual(dark)
  })

  it('sends only the families whose solid step cannot hold white text to a ring', () => {
    const ringed = FAMILIES.filter((family) => ratio('#ffffff', light[`${family}-solid`]!) < 4.5)
    expect(ringed).toEqual(['callables', 'members', 'tools'])
    for (const family of FAMILIES) {
      const rule = css.match(new RegExp(`--mk-bg: var\\(--mark-${family}-bg\\)[^}]*`))?.[0] ?? ''
      expect(rule, family).not.toBe('')
      // Solid where white holds; a 2px ring where it does not.
      expect(/--mk-act-ring: 0 0 0 0 transparent/.test(rule), `${family} solid`).toBe(!ringed.includes(family))
      expect(/--mk-act-ring: 0 0 0 2px/.test(rule), `${family} ring`).toBe(ringed.includes(family))
    }
  })

  describe('negative controls', () => {
    it('measures white on yellow as failing', () => {
      expect(ratio('#ffffff', '#fde047')).toBeLessThan(4.5)
    })
    it('measures black on white as passing', () => {
      expect(ratio('#000000', '#ffffff')).toBeGreaterThan(20)
    })
  })
})
