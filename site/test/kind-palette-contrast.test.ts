import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/styles/api-kinds.css', import.meta.url), 'utf8')
const brand = readFileSync(new URL('../src/styles/brand.css', import.meta.url), 'utf8')
const apiCss = readFileSync(new URL('../src/styles/api.css', import.meta.url), 'utf8')
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
const tokens = (block: string) => Object.fromEntries([...block.matchAll(/--mark-([a-z]+)-(bg|fg|hue|solid|ink):\s*(#[0-9a-f]{6})/gi)]
  .map(([, family, part, value]) => [`${family}-${part}`, value!]))

/**
 * A colour the brands declare, one per mode however many brands repeat it: `background-primary`, `inline-code-background`.
 * A surface is light in the light mode; text is the reverse.
 */
const brandColour = (name: string, text = false) => {
  const values = [...new Set([...brand.matchAll(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, 'gi'))].map(([, value]) => value!.toLowerCase()))]
  expect(values, name).toHaveLength(2)
  const [darker, lighter] = values.sort((a, b) => luminance(a) - luminance(b))
  return text ? { light: darker!, dark: lighter! } : { light: lighter!, dark: darker! }
}
/** The page and panel backgrounds. */
const surface = (name: 'primary' | 'secondary') => brandColour(`background-${name}`)

/** `color-mix(in srgb, a p%, b)` as the 8-bit colour the browser paints. */
const mix = (a: string, percent: number, b: string) => '#' + [1, 3, 5].map((index) => {
  const [x, y] = [a, b].map((hex) => Number.parseInt(hex.slice(index, index + 2), 16))
  return Math.round((percent / 100) * x! + (1 - percent / 100) * y!).toString(16).padStart(2, '0')
}).join('')

/** The declarations of the rule that holds `selector`. */
const ruleOf = (selector: string) => {
  const start = apiCss.indexOf(selector)
  expect(start, selector).toBeGreaterThan(-1)
  return apiCss.slice(start, apiCss.indexOf('}', start))
}
/** The share of the family ink that the rule's `background: color-mix(...)` paints, read from the stylesheet. */
const tintOf = (selector: string) => {
  const rule = ruleOf(selector)
  return Number(/background:\s*color-mix\(in srgb,\s*var\(--api-kind-ink,\s*var\(--color-link\)\)\s+(\d+)%/.exec(rule)?.[1])
}
/** How much of the ink a lit name keeps; the rest is the page's text colour. */
const litShare = Number(/--api-kind-ink-lit:\s*color-mix\(in srgb,\s*var\(--api-kind-ink\)\s+(\d+)%,\s*var\(--color-foreground-primary\)\)/.exec(apiCss)?.[1])

const light = tokens(css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)')))
const dark = tokens(css.slice(css.indexOf(':root:not([data-color-scheme=\'light\'])'), css.indexOf('[data-color-scheme=\'dark\'] {')))
const forced = tokens(css.slice(css.indexOf('[data-color-scheme=\'dark\'] {'), css.indexOf('A kind joins a family')))

describe('kind palette contrast', () => {
  it.each(FAMILIES)('the %s glyph clears 4.5:1 on its fill in light and dark', (family) => {
    expect(ratio(light[`${family}-fg`]!, light[`${family}-bg`]!), `light ${family}`).toBeGreaterThanOrEqual(4.5)
    expect(ratio(dark[`${family}-fg`]!, dark[`${family}-bg`]!), `dark ${family}`).toBeGreaterThanOrEqual(4.5)
  })

  it.each(FAMILIES)('the %s ink clears 4.5:1 on the page and panel backgrounds in light and dark', (family) => {
    for (const name of ['primary', 'secondary'] as const) {
      const background = surface(name)
      expect(ratio(light[`${family}-ink`]!, background.light), `light ${family} on ${name}`).toBeGreaterThanOrEqual(4.5)
      expect(ratio(dark[`${family}-ink`]!, background.dark), `dark ${family} on ${name}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  describe('a lit name', () => {
    const modes = { light, dark } as const
    /** Ink text on its own tint over a surface: what a hovered chip or a cross-lit name paints. */
    const lit = (mode: 'light' | 'dark', family: string, percent: number, surfaceColour: string, deepened = true) => {
      const ink = modes[mode][`${family}-ink`]!
      const text = deepened ? mix(ink, litShare, brandColour('foreground-primary', true)[mode]) : ink
      return { text, background: mix(ink, percent, surfaceColour) }
    }
    const chipHoverRule = '.api-directory a.api-mention--chip:focus-visible .api-literal--link'
    const chipHover = tintOf(chipHoverRule)

    it('reads the tints from the stylesheet, so a renamed rule fails here and is not skipped', () => {
      expect([litShare, chipHover].every(Number.isFinite)).toBe(true)
      // The check below measures the deepened ink, so the rule must paint it.
      expect(ruleOf(chipHoverRule)).toMatch(/\bcolor:\s*var\(--api-kind-ink-lit/)
    })

    it.each(FAMILIES)('the %s ink clears 4.5:1 on a hovered chip in light and dark', (family) => {
      for (const mode of ['light', 'dark'] as const) {
        const { text, background } = lit(mode, family, chipHover, brandColour('inline-code-background')[mode])
        expect(ratio(text, background), `${mode} ${family}`).toBeGreaterThanOrEqual(4.5)
      }
    })

    it('would not, with the ink undeepened on its tint, so the check above can fail', () => {
      const failing = FAMILIES.filter((family) => {
        const { text, background } = lit('light', family, chipHover, brandColour('inline-code-background').light, false)
        return ratio(text, background) < 4.5
      })
      expect(failing).toEqual(['members', 'tools'])
    })
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
    it('measures a family hue on the light page as failing, so the ink check tells ink from hue', () => {
      expect(ratio(light['callables-hue']!, surface('primary').light)).toBeLessThan(4.5)
    })
    it('measures black on white as passing', () => {
      expect(ratio('#000000', '#ffffff')).toBeGreaterThan(20)
    })
  })
})
