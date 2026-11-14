import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { palettes } from '../src/lib/branding'

const read = (name: string) => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), 'utf8')
const tokensCss = read('tokens.css')

type Rgb = [number, number, number]

const hex = (value: string): Rgb => {
  const [r, g, b] = [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16))
  return [r!, g!, b!]
}
const channel = (value: number) => {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const luminance = ([r, g, b]: Rgb) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
/** WCAG contrast ratio of two colours. */
const ratio = (a: Rgb, b: Rgb) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high! + 0.05) / (low! + 0.05)
}
/** `share` of `over` painted on `under`: what `color-mix(in oklab, over, transparent)` over a ground paints. */
const tint = (over: Rgb, share: number, under: Rgb): Rgb =>
  over.map((value, index) => Math.round(share * value + (1 - share) * under[index]!)) as Rgb

/** An `oklch(L C h)` colour as 8-bit sRGB, clipped to the gamut. */
const oklch = (value: string): Rgb => {
  const [l, c, h] = /oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/.exec(value)!.slice(1).map(Number) as [number, number, number]
  const a = c * Math.cos((h * Math.PI) / 180)
  const b = c * Math.sin((h * Math.PI) / 180)
  const [lp, mp, sp] = [l + 0.3963377774 * a + 0.2158037573 * b, l - 0.1055613458 * a - 0.0638541728 * b, l - 0.0894841775 * a - 1.291485548 * b].map((x) => x ** 3) as Rgb
  const linear = [4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp,
    -1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp,
    -0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp]
  return linear.map((x) => {
    const encoded = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.max(x, 0) ** (1 / 2.4) - 0.055
    return Math.round(Math.min(1, Math.max(0, encoded)) * 255)
  }) as Rgb
}

/** The declarations of every rule whose selector is `selector`, by property. */
const rule = (css: string, selector: string): Record<string, string> => {
  const found: Record<string, string> = {}
  for (let start = css.indexOf(`${selector} {`); start > -1; start = css.indexOf(`${selector} {`, start + 1)) {
    const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start))
    for (const [, name, value] of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) found[name!] = value!.trim()
  }
  expect(Object.keys(found), selector).not.toHaveLength(0)
  return found
}

const LIGHT = rule(tokensCss, '\n:root')
const DARK = rule(tokensCss, '\nhtml[data-theme-mode="dark"]')
const FALLBACK = rule(tokensCss.slice(tokensCss.indexOf('@media (prefers-color-scheme: dark)')), '  html:not([data-theme-mode]):not([data-theme="light"])')

/** The design system's values for the tokens this stylesheet declares: [light, dark]. */
const THEMED: Record<string, [string, string]> = {
  'control-border': ['#7f8d9b', '#718294'],
  scrim: ['rgba(15, 20, 25, 0.5)', 'rgba(0, 0, 0, 0.6)'],
  'diff-bg': ['#fdf3d8', '#3a2c0c'],
  'aside-note-ink': ['oklch(0.47 0.15 250)', 'oklch(0.82 0.09 250)'],
  'aside-tip-ink': ['oklch(0.46 0.12 130)', 'oklch(0.84 0.11 125)'],
  'aside-caution-ink': ['oklch(0.48 0.12 70)', 'oklch(0.85 0.12 85)'],
  'aside-danger-ink': ['oklch(0.48 0.16 20)', 'oklch(0.82 0.1 15)'],
  'mod-async-fg': ['#7c3aed', '#c4b5fd'],
  'mod-async-border': ['#a78bfa', '#7c3aed'],
  'mod-abstract-fg': ['#4338ca', '#a5b4fc'],
  'mod-abstract-border': ['#818cf8', '#4338ca'],
  'mod-classmethod-fg': ['#b45309', '#fcd34d'],
  'mod-classmethod-border': ['#f59e0b', '#d97706'],
  'mod-final-fg': ['#047857', '#6ee7b7'],
  'mod-final-border': ['#34d399', '#059669'],
  'mod-default-fg': ['#4b5563', '#cbd5e1'],
  'mod-default-border': ['#9ca3af', '#64748b'],
  'syntax-bg': ['#ffffff', '#24292e'],
  'syntax-fg': ['#24292e', '#e1e4e8'],
  'syntax-keyword': ['#bf3441', '#f97583'],
  'syntax-string': ['#032f62', '#9ecbff'],
  'syntax-comment': ['#616972', '#99a0a6'],
  'syntax-function': ['#6f42c1', '#b392f0'],
  'syntax-constant': ['#005cc5', '#79b8ff'],
  'syntax-variable': ['#ae4b07', '#ffab70'],
  'json-key': ['#963b63', '#f0a0c0'],
  'json-string': ['#755400', '#e6c86e'],
  'json-number': ['#6840a0', '#c3a6f4'],
  'yaml-key': ['#1e7734', '#85e89d'],
  'tmux-usage-tmux': ['#6d28d9', '#cb84e0'],
  'tmux-usage-command': ['#16713a', '#98c379'],
  'tmux-usage-flag': ['#7e22ce', '#56b6c2'],
  'tmux-usage-param': ['#8a5400', '#e5c07b'],
  'tmux-usage-bracket': ['#586579', '#ccced4'],
  'lm-reroll-from': ['#6366f1', '#818cf8'],
  'lm-reroll-to': ['#a855f7', '#c084fc'],
}
const HUES: Record<string, string> = {
  'aside-note': 'oklch(0.65 0.15 250)',
  'aside-tip': 'oklch(0.73 0.13 120)',
  'aside-caution': 'oklch(0.72 0.15 80)',
  'aside-danger': 'oklch(0.68 0.14 10)',
}
const FIXED: Record<string, string> = {
  'space-1': '4px', 'space-2': '8px', 'space-3': '12px', 'space-4': '16px', 'space-5': '20px', 'space-6': '24px', 'space-8': '32px', 'space-12': '48px',
  'radius-xs': '4px', 'context-height': '3rem', 'sidebar-width': '16rem', 'outline-width': '14rem', 'content-max': '100rem', 'pane-width': '34rem',
  'measure-prose': '72ch', 'measure-reference': '100ch', 'code-columns-example': '80', 'code-columns-api': '60',
  'control-sm': '2rem', 'control-md': '2.5rem', 'control-lg': '3.5rem', 'touch-target': '2.75rem', 'row-compact': '1.75rem', 'row-default': '2.125rem',
  'kind-mark': '1.25rem', 'list-budget': '28rem', 'opacity-deprecated': '0.7',
  'z-context': '35', 'z-topnav': '40', 'z-drawer': '50', 'z-pane': '55', 'z-dialog': '60',
  'bp-phone': '30rem', 'bp-tablet': '48rem', 'bp-nav': '64rem', 'bp-outline': '80rem',
}

describe('design tokens', () => {
  it('declares each themed token with the design system value in light, dark and the no-script dark fallback', () => {
    for (const [name, [light, dark]] of Object.entries(THEMED)) {
      expect(LIGHT[`--${name}`], `light ${name}`).toBe(light)
      expect(DARK[`--${name}`], `dark ${name}`).toBe(dark)
      expect(FALLBACK[`--${name}`], `fallback ${name}`).toBe(dark)
    }
    for (const [name, value] of Object.entries(HUES)) expect(LIGHT[`--${name}`], name).toBe(value)
  })

  it('declares each size, spacing, measure, layer and breakpoint token once, in both themes alike', () => {
    for (const [name, value] of Object.entries(FIXED)) expect(LIGHT[`--${name}`], name).toBe(value)
    expect(DARK['--space-1']).toBeUndefined()
  })

  it('points the form and button variables at the tokens instead of restating their values', () => {
    const global = read('global.css')
    expect(global).toContain('--input-border: var(--control-border);')
    expect(global).toContain('--button-height-sm: var(--control-sm);')
    expect(global).not.toMatch(/--input-border:\s*oklch/)
  })
})

/** The pairs a change in this slice paints, over every port's palette and both themes. */
describe('contrast of the shared chrome', () => {
  const modes = ['light', 'dark'] as const
  const grounds = (palette: (typeof palettes)[keyof typeof palettes], mode: (typeof modes)[number]) =>
    [['page', hex(palette[mode].background)], ['panel', hex(palette[mode].surface)]] as const

  it('keeps the control outline at 3:1 on the page and on a panel in every palette', () => {
    for (const [slug, palette] of Object.entries(palettes)) {
      for (const mode of modes) {
        const outline = hex(mode === 'light' ? THEMED['control-border']![0] : THEMED['control-border']![1])
        for (const [name, ground] of grounds(palette, mode)) {
          expect(ratio(outline, ground), `${slug} ${mode} on ${name}`).toBeGreaterThanOrEqual(3)
        }
      }
    }
  })

  // Navigation columns and drawers sit on the page ground, so that is the ground the current row is measured on.
  it('keeps the current row legible: primary text on its own tint, 10% light and 15% dark, in every palette', () => {
    for (const [slug, palette] of Object.entries(palettes)) {
      for (const mode of modes) {
        const primary = hex(palette[mode].link)
        const row = tint(primary, mode === 'light' ? 0.1 : 0.15, hex(palette[mode].background))
        expect(ratio(primary, row), `${slug} ${mode}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('keeps the focus ring at 3:1 on the page and on a panel in every palette', () => {
    for (const [slug, palette] of Object.entries(palettes)) {
      for (const mode of modes) {
        for (const [name, ground] of grounds(palette, mode)) {
          expect(ratio(hex(palette[mode].link), ground), `${slug} ${mode} on ${name}`).toBeGreaterThanOrEqual(3)
        }
      }
    }
  })

  it('sets aside titles in an ink that clears 4.5:1 on the page and on the compact tint, light and dark', () => {
    for (const [slug, palette] of Object.entries(palettes)) {
      for (const mode of modes) {
        const [light, dark] = [0, 1] as const
        for (const type of ['note', 'tip', 'caution', 'danger']) {
          const ink = oklch(THEMED[`aside-${type}-ink`]![mode === 'light' ? light : dark])
          const hue = oklch(HUES[`aside-${type}`]!)
          const ground = hex(palette[mode].background)
          // The compact variant paints its hue at 7% over the page in light and 10% in dark.
          for (const [name, under] of [['page', ground], ['compact tint', tint(hue, mode === 'light' ? 0.07 : 0.1, ground)]] as const) {
            expect(ratio(ink, under), `${slug} ${mode} ${type} on ${name}`).toBeGreaterThanOrEqual(4.5)
          }
        }
      }
    }
  })

  it('fails the pairs this slice replaced, so the checks above can fail', () => {
    const light = palettes.go.light
    const oldInputBorder = oklch('oklch(0.8 0 0)')
    expect(ratio(oldInputBorder, hex(light.background))).toBeLessThan(3)
    const oldTitle = oklch(HUES['aside-caution']!)
    expect(ratio(oldTitle, tint(oldTitle, 0.07, hex(light.background)))).toBeLessThan(3)
    const accent = hex('#9aa0a6')
    expect(ratio(accent, tint(accent, 0.1, hex(light.background)))).toBeLessThan(4.5)
  })
})
