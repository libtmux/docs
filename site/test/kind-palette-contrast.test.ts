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
    /** The states that tint a name, with the rule that paints each and the surfaces it can sit on. */
    const PROSE = 'a.api-doc-link.is-cross-lit:not(.api-mention--chip)'
    const STATES: { state: string; rule: string; textRule?: string; text: RegExp; surfaces: string[] }[] = [
      { state: 'a hovered chip', rule: '.api-directory a.api-mention--chip:focus-visible .api-literal--link', text: /\bcolor:\s*var\(--api-kind-ink-lit/, surfaces: ['inline-code-background'] },
      { state: 'a cross-lit chip', rule: '.api-directory a.api-mention--chip.is-cross-lit .api-literal--link', text: /\bcolor:\s*var\(--api-kind-ink-lit/, surfaces: ['inline-code-background'] },
      // The tint sits on the code box inside the link; the deeper text is set on the link, which the code box inherits.
      { state: 'a cross-lit name in prose', rule: `${PROSE} .api-literal--link`, textRule: `${PROSE} {`, text: /--api-kind-text:\s*var\(--api-kind-ink-lit\)/, surfaces: ['background-primary', 'background-secondary'] },
      { state: 'a cross-lit name in prose with no code inside', rule: `${PROSE}:not(:has(.api-literal--link))`, textRule: `${PROSE} {`, text: /--api-kind-text:\s*var\(--api-kind-ink-lit\)/, surfaces: ['background-primary', 'background-secondary'] },
    ]
    /** The families whose ink misses 4.5:1 in light on a state's surfaces, deepened or as the resting ink. */
    const failing = (rule: string, surfaces: string[], deepened: boolean) => FAMILIES.filter((family) => surfaces.some((name) => {
      const { text, background } = lit('light', family, tintOf(rule), brandColour(name).light, deepened)
      return ratio(text, background) < 4.5
    }))

    it('reads the tints from the stylesheet, so a renamed rule fails here and is not skipped', () => {
      expect(Number.isFinite(litShare)).toBe(true)
      for (const { rule, textRule, text } of STATES) {
        expect(Number.isFinite(tintOf(rule)), rule).toBe(true)
        // The check below measures the deepened ink, so the rule must paint it.
        expect(ruleOf(textRule ?? rule), rule).toMatch(text)
      }
    })

    describe.each(STATES)('$state', ({ rule, surfaces }) => {
      it.each(FAMILIES)('the %s ink clears 4.5:1 in light and dark', (family) => {
        for (const mode of ['light', 'dark'] as const) for (const name of surfaces) {
          const { text, background } = lit(mode, family, tintOf(rule), brandColour(name)[mode])
          expect(ratio(text, background), `${mode} ${family} on ${name}`).toBeGreaterThanOrEqual(4.5)
        }
      })

      it('would not, with the ink undeepened on its tint, so the check above can fail', () => {
        expect(failing(rule, surfaces, false)).toEqual(expect.arrayContaining(['members', 'tools']))
        expect(failing(rule, surfaces, true)).toEqual([])
      })
    })

    it('keeps the link colour of a lit member row or sidebar row at 4.5:1 on its tint, in every brand and mode', () => {
      const percent = Number(/background:\s*color-mix\(in srgb,\s*var\(--color-link\)\s+(\d+)%/.exec(ruleOf('.api-nav__row.is-cross-lit'))?.[1])
      expect(Number.isFinite(percent)).toBe(true)
      const blocks = [...brand.matchAll(/(html\[[^{}]*)\{([^{}]*)\}/g)]
        .map(([, selector, body]) => ({ selector: selector!.trim(), colours: Object.fromEntries([...body!.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/gi)].map(([, name, value]) => [name, value!.toLowerCase()])) as Record<string, string> }))
        .filter(({ colours }) => colours['--color-link'])
      expect(blocks.length).toBeGreaterThan(0)
      const failures = (share: number) => blocks.flatMap(({ selector, colours }) => ['--color-background-primary', '--color-background-secondary']
        .filter((surfaceName) => ratio(colours['--color-link']!, mix(colours['--color-link']!, share, colours[surfaceName]!)) < 4.5)
        .map((surfaceName) => `${selector} ${surfaceName}`))
      expect(failures(percent)).toEqual([])
      // Control: a 14% tint, which the Rust palette fails in light mode, is caught.
      expect(failures(14).some((entry) => entry.includes('data-brand="rust"'))).toBe(true)
    })
  })

  describe('the inks of a native signature', () => {
    /** The signature surface in every brand and mode: the page colour with 6% of the text colour mixed in, as the header paints it. */
    const surfaces = () => {
      const share = Number(/dt\.gp-sphinx-api-header:not\(:target\)\s*\{\s*background:\s*color-mix\(in srgb,\s*var\(--background-color\),\s*var\(--text-color\)\s+(\d+)%\)/.exec(apiCss)?.[1])
      expect(Number.isFinite(share), 'the signature surface is read from the stylesheet').toBe(true)
      const blocks = [...brand.matchAll(/(html\[[^{}]*)\{([^{}]*)\}/g)]
        .map(([, selector, body]) => ({ selector: selector!.trim(), colours: Object.fromEntries([...body!.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/gi)].map(([, name, value]) => [name, value!.toLowerCase()])) as Record<string, string> }))
        .filter(({ colours }) => colours['--background-color'] && colours['--text-color'])
      expect(blocks.length).toBeGreaterThan(0)
      return blocks.map(({ selector, colours }) => ({
        selector, colours, mode: luminance(colours['--background-color']!) > 0.5 ? 'light' as const : 'dark' as const,
        surface: mix(colours['--text-color']!, share, colours['--background-color']!),
      }))
    }
    /** The brands whose signature surface a colour misses 4.5:1 on, given the colour each mode paints. */
    const failing = (colour: (mode: 'light' | 'dark', colours: Record<string, string>) => string) => surfaces()
      .filter(({ mode, surface, colours }) => ratio(colour(mode, colours), surface) < 4.5).map(({ selector }) => selector)

    describe.each([
      ['a type a signature links', '.api-native-signature .api-type-link:not(.api-parameter-name)', '--api-ink-type'],
      ['an attribute\'s path', '.api-native-signature .api-attribute', '--api-ink-attribute'],
      ['a string in an attribute', '.api-native-signature .api-string', '--api-ink-string'],
    ])('%s', (_, rule, token) => {
      /** The `--api-ink-*` the rule paints, and its colour in the light and dark blocks of the kind palette. */
      const ink = () => {
        const name = /\bcolor:\s*var\((--api-ink-[a-z]+)\)/.exec(ruleOf(rule))?.[1]
        expect(name, 'the rule paints an api ink').toBe(token)
        const values = [...css.matchAll(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'gi'))].map(([, value]) => value!.toLowerCase())
        expect(values, `${name} in the light, dark and forced dark blocks`).toHaveLength(3)
        expect(values[2], 'an explicit dark choice paints what the dark preference does').toBe(values[1])
        return { light: values[0]!, dark: values[1]! }
      }

      it('clears 4.5:1 on the signature surface in light and dark, in every brand', () => {
        const { light, dark } = ink()
        expect(failing((mode) => mode === 'light' ? light : dark)).toEqual([])
      })

      it('would not with the other mode\'s ink, so the check above can fail', () => {
        const { light, dark } = ink()
        expect(failing((mode) => mode === 'light' ? dark : light).length).toBeGreaterThan(0)
      })
    })

    it('keeps the muted ink of an attribute\'s punctuation at 4.5:1 on the signature surface in every brand', () => {
      expect(ruleOf('.api-native-signature .api-delimiter')).toMatch(/\bcolor:\s*var\(--color-muted\)/)
      expect(failing((_, colours) => colours['--color-foreground-muted']!)).toEqual([])
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
