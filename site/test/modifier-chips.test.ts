import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const marks = read('../src/styles/kind-marks.css')
const kinds = read('../src/styles/api-kinds.css')
const vendor = read('../src/styles/vendor/gp-sphinx-api.css')
const model = read('../../packages/api-model/src/model.ts')

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

/** The gp-sphinx modifier tokens, light and dark, as the vendored stylesheet declares them. */
const declared = (block: string) => Object.fromEntries([...block.matchAll(/--gp-sphinx-badge-mod-([a-z-]+): (#[0-9a-f]{6})/g)].map(([, name, value]) => [name!, value!]))
const blocks = (selector: string) => [...vendor.matchAll(new RegExp(`${selector.replace(/[[\]']/g, '\\$&')} \\{([^}]*)\\}`, 'g'))].map(([, body]) => body!).filter((body) => body.includes('badge-mod')).join('\n')
const light = declared(blocks(':root'))
const dark = declared(blocks("[data-theme-mode='dark']"))

/** The token a modifier's rule gives its ink and its outline, as `kind-marks.css` writes it. */
const tokenFor = (modifier: string) => {
  const rule = marks.split('\n').find((line) => new RegExp(`\\.api-badge--mod-${modifier}\\b[^{]*\\{`).test(line))
  const defaults = marks.match(/\.api-badge--mod \{\s*--md-fg: var\(([^)]+)\)/)![1]!
  const fg = rule?.match(/--md-fg: var\(([^)]+)\)/)?.[1] ?? defaults
  return { explicit: Boolean(rule), fg }
}

const MODIFIERS = [...model.slice(model.indexOf('export type Modifier ='), model.indexOf('/** One parameter')).matchAll(/'([a-z]+)'/g)].map(([, name]) => name!)
// The maintainer's list adds the three the model's union does not carry: package, inherited and the gp-sphinx `final`.
const EVERY = [...new Set([...MODIFIERS, 'package', 'inherited', 'final'])]

describe('modifier chips', () => {
  it('knows every modifier the API model declares', () => {
    expect(MODIFIERS).toEqual(expect.arrayContaining(['readonly', 'async', 'static', 'overload', 'classmethod', 'abstract', 'opaque', 'annotation', 'private', 'deprecated']))
  })

  it('gives each modifier its gp-sphinx hue, and the readable grey to the rest', () => {
    const hues: Record<string, string> = {
      async: '--gp-sphinx-badge-mod-async-fg',
      abstract: '--gp-sphinx-badge-mod-abstract-fg',
      classmethod: '--md-amber-fg',
      static: '--md-amber-fg',
      readonly: '--gp-sphinx-badge-mod-final-fg',
      final: '--gp-sphinx-badge-mod-final-fg',
      deprecated: '--api-ink-keyword',
      package: '--mark-types-fg',
    }
    for (const modifier of EVERY) {
      const { explicit, fg } = tokenFor(modifier)
      expect(fg, modifier).toBe(hues[modifier] ?? '--gp-sphinx-badge-mod-default-fg')
      expect(explicit, modifier).toBe(modifier in hues)
    }
  })

  /** The light amber ink: the token five percent toward black, as `--md-amber-fg` writes it. */
  const darkened = (hex: string, keep = 0.95) => `#${[1, 3, 5].map((index) => Math.round(Number.parseInt(hex.slice(index, index + 2), 16) * keep).toString(16).padStart(2, '0')).join('')}`
  it('draws the ink of every gp-sphinx hue at 4.5:1 on the page and on the header band, light and dark', () => {
    expect(marks).toContain(':root { --md-amber-fg: color-mix(in srgb, var(--gp-sphinx-badge-mod-classmethod-fg) 95%, #000); }')
    const ink = ['async', 'abstract', 'classmethod', 'final', 'default']
    for (const name of ink) {
      for (const [mode, tokens, surfaces] of [['light', light, ['#ffffff', '#f1f1f2']], ['dark', dark, ['#131416', '#1e1f21']]] as const) {
        const fg = mode === 'light' && name === 'classmethod' ? darkened(tokens[`${name}-fg`]!) : tokens[`${name}-fg`]!
        for (const surface of surfaces) expect(ratio(fg, surface), `${mode} ${name} on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('is outline-only, with ink and never a muted or faded one', () => {
    const rule = marks.match(/\.api-badge\.api-badge--mod\.api-badge--mod \{[^}]*\}/)![0]
    expect(rule).toMatch(/background: transparent/)
    expect(rule).toMatch(/color: var\(--md-fg\)/)
    expect(rule).toMatch(/border: 1px solid var\(--md-bd\)/)
    expect(rule).not.toMatch(/muted|opacity|color-mix/)
    expect(marks).not.toMatch(/\.api-badge--mod[^{]*\{[^}]*--api-muted/)
  })

  it('shares the legend chip\'s height, radius, sans weight and baseline snap', () => {
    const chip = marks.match(/\.api-badge\.api-badge--mod\.api-badge--mod \{[^}]*\}/)![0]
    const legend = marks.match(/\.api-badge\.api-leg \{[^}]*\}/)![0]
    for (const declaration of ['--leg-h: round(1.35em, 2px)', 'border-radius: .2em', 'font: 600 .8125rem']) {
      expect(chip, declaration).toContain(declaration)
      expect(legend, declaration).toContain(declaration)
    }
    expect(chip).toContain('--leg-pb: round(calc((var(--leg-h) - 2px - .8 * 1cap) / 2), var(--mark-step))')
    expect(marks).toMatch(/\.api-badge--mod > \.api-badge__label \{[^}]*text-box: trim-both cap alphabetic/)
  })

  it('makes a package an outline in the types hue, not a second filled badge', () => {
    expect(kinds).not.toMatch(/mod-package/)
    expect(marks).toMatch(/\.api-badge--mod-package \{ --md-fg: var\(--mark-types-fg\); --md-bd: var\(--mark-types-hue\); \}/)
  })

  describe('negative controls', () => {
    it('measures the gp-sphinx border grey as too faint for text', () => {
      expect(ratio(light['default-border']!, '#ffffff')).toBeLessThan(4.5)
    })
    it('measures the dark grey ink on the dark page as passing, and on the light page as failing', () => {
      expect(ratio(dark['default-fg']!, '#131416')).toBeGreaterThan(4.5)
      expect(ratio(dark['default-fg']!, '#ffffff')).toBeLessThan(4.5)
    })
    it('measures gp-sphinx\'s own amber ink as just under 4.5:1 on the band, which is why it is darkened', () => {
      expect(ratio(light['classmethod-fg']!, '#f1f1f2')).toBeLessThan(4.5)
    })
    it('would notice a modifier left on the default grey that should be a hue', () => {
      expect(tokenFor('async').fg).not.toBe(tokenFor('overload').fg)
    })
  })
})
