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
  'current-row-bg': ['color-mix(in oklab, var(--theme-primary), transparent 90%)', 'color-mix(in oklab, var(--theme-primary), transparent 85%)'],
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
  'logo-primary': 'var(--brand-color)', 'logo-base': '#231f20',
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

  // Firefox draws a white scrollbar on an inner scroller in dark unless the page names its colours.
  it('names the scrollbar colours from the control token in dark, at the root where every scroller inherits them', () => {
    const global = read('global.css')
    expect(global).toMatch(/html\[data-theme-mode='dark'\]\s*\{\s*scrollbar-color:\s*var\(--control-border\) transparent;/)
    expect(global).toMatch(/prefers-color-scheme: dark\)\s*\{\s*html:not\(\[data-theme-mode\]\):not\(\[data-theme='light'\]\)\s*\{\s*scrollbar-color:\s*var\(--control-border\) transparent;/)
    expect(global, 'light keeps the native scrollbar').not.toMatch(/html\[data-theme-mode='light'\][^{]*\{[^}]*scrollbar-color/)
  })

  // The `$` of a shell session is bold 13px text on the code frame: syntax-bg, white in light and #24292e in dark.
  it('keeps the shell prompt at 4.5:1 on the code frame in both themes, in the violet it had', () => {
    const [light, dark] = [...read('global.css').matchAll(/--lm-shell-prompt:\s*(#[0-9a-f]{6})/g)].map((match) => match[1]!)
    expect(light && dark, 'a light and a dark prompt colour').toBeTruthy()
    // The token ground, and the ground Expressive Code's GitHub themes draw (#f6f8fa and #1f2428, read from a rendered frame in Firefox).
    for (const ground of [THEMED['syntax-bg']![0], '#f6f8fa']) expect(ratio(hex(light!), hex(ground)), `light on ${ground}`).toBeGreaterThanOrEqual(4.5)
    for (const ground of [THEMED['syntax-bg']![1], '#1f2428']) expect(ratio(hex(dark!), hex(ground)), `dark on ${ground}`).toBeGreaterThanOrEqual(4.5)
    // The hue stays violet (about 271 degrees), as `#a855f7` and `#c084fc` were.
    const hueOf = ([r, g, b]: Rgb) => {
      const [max, min] = [Math.max(r, g, b), Math.min(r, g, b)]
      return (r === max ? ((g - b) / (max - min)) % 6 : g === max ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4) * 60 + (r === max && g < b ? 360 : 0)
    }
    for (const colour of [light!, dark!]) expect(hueOf(hex(colour))).toBeGreaterThan(265)
    for (const colour of [light!, dark!]) expect(hueOf(hex(colour))).toBeLessThan(278)
    // The control: the colour this replaced is below 4.5:1 on the white frame.
    expect(ratio(hex('#a855f7'), hex('#f6f8fa'))).toBeLessThan(4.5)
  })

  // The 12px selected label sits on a 16% wash of the text colour over the header ground (adoption plan step 50).
  it('keeps the selected scheme label at 4.5:1 on its wash in every palette and both themes, in the text colour, not the link colour', () => {
    const switchCss = read('global.css')
    const selected = switchCss.slice(switchCss.indexOf(".scheme-switch__option:has(input:checked)"), switchCss.indexOf("/* The attribute is the authority"))
    expect(selected).toMatch(/color:\s*var\(--topnav-text-color\)/)
    expect(selected).toMatch(/color-mix\(in oklab, var\(--topnav-background\), var\(--topnav-text-color\) 16%\)/)
    const brand = read('brand.css')
    // Light is `html[data-brand="x"]`; dark is the same with `[data-theme-mode="dark"]`.
    const blocks = [...brand.matchAll(/^html\[data-brand="([^"]+)"\](\[data-theme-mode="dark"\])?[^{]*\{([^}]*)\}/gm)]
    const value = (body: string, name: string) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(body)?.[1]
    let checked = 0
    for (const [, slug, dark, body] of blocks) {
      const [ground, text, link] = ['topnav-background', 'topnav-text-color', 'topnav-link-color'].map((name) => hex(value(body!, name)!))
      const wash = tint(text!, 0.16, ground!)
      expect(ratio(text!, wash), `${slug} ${dark ? 'dark' : 'light'} text`).toBeGreaterThanOrEqual(4.5)
      checked++
      // The control: the link colour this replaced is below 4.5:1 in some palette's wash, or this loop could not fail.
      if (ratio(link!, wash) < 4.5) expect(ratio(text!, wash), `${slug} text beats link`).toBeGreaterThan(ratio(link!, wash))
    }
    expect(checked, 'a light and a dark block for each palette').toBe(Object.keys(palettes).length * 2)
  })

  // Record 0079. The tint is the link colour over the code background, under the syntax inks: GitHub light and dark, which tokens.css states.
  it('keeps every syntax ink at 4.5:1 on the Core player\'s current and hover tints, in every palette and both themes', () => {
    const css = read('core-player.css')
    const shares = {
      light: rule(css, '\n.home-example-view'),
      dark: rule(css, '\nhtml[data-theme-mode="dark"] .home-example-view'),
    }
    expect(rule(css.slice(css.indexOf('@media (prefers-color-scheme: dark)')), '\n  html:not([data-theme-mode]):not([data-theme="light"]) .home-example-view'), 'before the theme script runs, dark reads the same shares').toEqual(shares.dark)
    const tokens = { light: LIGHT, dark: DARK }
    /** The lowest ratio of any ink over any palette's tint, and where it is. */
    const lowest = (share: (mode: (typeof modes)[number]) => number) => {
      let worst: [number, string] = [Infinity, '']
      for (const [slug, palette] of Object.entries(palettes)) {
        for (const mode of modes) {
          const ground = tint(hex(palette[mode].link), share(mode), hex(tokens[mode]['--syntax-bg']!))
          for (const [name, ink] of Object.entries(tokens[mode]).filter(([key]) => /^--syntax-(?!bg$)/.test(key))) {
            const value = ratio(hex(ink), ground)
            if (value < worst[0]) worst = [value, `${slug} ${mode} ${name}`]
          }
        }
      }
      return worst
    }
    for (const state of ['current', 'hover']) {
      const [value, where] = lowest((mode) => Number.parseFloat(shares[mode][`--core-tint-${state}`]!) / 100)
      expect(value, `${state}: ${where}`).toBeGreaterThanOrEqual(4.5)
    }
    // A control: the 14% the owner set on 2026-11-14 must read as failing, or this loop could not fail.
    expect(lowest(() => 0.14)[0], 'the old current tint').toBeLessThan(4.5)
    expect(shares.light, 'light: current 8%, hover 5%').toEqual({ '--core-tint-hover': '5%', '--core-tint-current': '8%' })
    expect(shares.dark, 'dark: current 7%, hover 4%').toEqual({ '--core-tint-hover': '4%', '--core-tint-current': '7%' })
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

  // The port picker's label and differences are 11px muted text: on the panel, and on the row under the pointer.
  it('keeps the port picker\'s muted lines at 4.5:1 on the panel and on a hovered row, in every palette and in the base tokens', () => {
    const share = Number(/\.doc-picker-option\[href\]:hover small \{ color: color-mix\(in srgb, var\(--color-muted\) (\d+)%, var\(--text-color\)\)/.exec(read('documentation-picker.css'))?.[1]) / 100
    expect(share).toBeGreaterThan(0)
    const tokens = read('gp-sphinx-tokens.css')
    // The page ground and text colour the base tokens sit on are `--background-color` and `--text-color` in global.css.
    const base: Record<(typeof modes)[number], Record<string, string>> = { light: { ...rule(tokens, ':root'), ground: '#ffffff', text: '#000000' }, dark: { ...rule(tokens, "[data-theme-mode='dark']"), ground: '#131416', text: '#cfd0d0' } }
    const sets = [
      ...Object.entries(palettes).flatMap(([slug, palette]) => modes.map((mode) => [`${slug} ${mode}`, palette[mode].muted, palette[mode].hover, palette[mode].background, palette[mode].text] as const)),
      ...modes.map((mode) => [`base ${mode}`, base[mode]['--color-foreground-muted']!, base[mode]['--color-api-background-hover']!, base[mode]['ground']!, base[mode]['text']!] as const),
    ]
    for (const [name, muted, hover, panel, text] of sets) {
      expect(ratio(hex(muted), hex(panel)), `${name} on the panel`).toBeGreaterThanOrEqual(4.5)
      expect(ratio(tint(hex(muted), share, hex(text)), hex(hover)), `${name} on a hovered row`).toBeGreaterThanOrEqual(4.5)
    }
    // Control: the muted colour alone misses on a hovered row in the base tokens, which is why the line mixes toward the text colour.
    for (const mode of modes) expect(ratio(hex(base[mode]['--color-foreground-muted']!), hex(base[mode]['--color-api-background-hover']!)), `base ${mode}`).toBeLessThan(4.5)
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

/** Controls that an outline identifies read the control token, never the hairline that decorates a surface. */
describe('control outlines', () => {
  const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
  /** The declarations of every rule whose selector list contains `selector`. */
  const declarations = (text: string, selector: string) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&')
    const found = [...text.matchAll(new RegExp(`(?:^|[\\n,}])\\s*${escaped}[^{}]*\\{([^}]*)\\}`, 'g'))].map((match) => match[1]!)
    expect(found, selector).not.toHaveLength(0)
    return found.join('\n')
  }
  const CONTROLS: [string, string][] = [
    ['styles/documentation-picker.css', '.doc-picker > summary'],
    ['styles/documentation-picker.css', '.doc-picker-search input'],
    ['styles/api-tree.css', '.api-nav__owner-field'],
    ['styles/api-tree.css', '.api-nav__owner-search'],
    ['styles/api-tree.css', '.api-nav__more > summary'],
    ['styles/api-tree.css', '.api-nav__search input'],
    ['styles/api-tree.css', '.api-nav__filters'],
    ['styles/api-tree.css', '.api-nav__search-field > kbd'],
    ['components/docs/Sidebar.astro', '.section-search input'],
    ['components/SearchPanel.astro', '.search-panel__field'],
    ['components/widgets/TaskPicker.astro', '.task-native select'],
    ['components/widgets/AgentPrompt.astro', '.lm-agent-prompt__copy'],
    ['styles/global.css', '.scheme-switch'],
    ['styles/global.css', '.scheme-cycle'],
    ['components/widgets/install-surface.css', '.lm-install__cdtoggle'],
    ['styles/global.css', '.prerelease-notice__dismiss'],
    ['components/SearchPanel.astro', '.search-panel__more'],
    ['styles/api-tree.css', 'html[data-api-nav] .api-nav-toggle'],
    ['components/StatusBadge.astro', 'button.status-badge'],
  ]

  it.each(CONTROLS)('%s %s is outlined in --control-border', (file, selector) => {
    const body = declarations(source(file), selector)
    expect(body).toMatch(/border:\s*1px solid var\(--control-border\)/)
  })

  it('names the control token to Tailwind for the header search chip', () => {
    expect(source('styles/global.css')).toContain('--color-control: var(--control-border);')
    expect(source('components/SiteHeader.astro')).toMatch(/site-header__search border border-control/)
  })

  it('fails a control that keeps the decorative hairline, so the check can fail', () => {
    const hairline = '.field { border: 1px solid var(--color-edge); }'
    expect(declarations(hairline, '.field')).not.toMatch(/var\(--control-border\)/)
  })

  /**
   * Hide and Show preview are round buttons of the replay's controls: the controls' own class draws them (size, fill, radius,
   * colour, focus), and their rules only place them. The head row that holds Hide preview is inset like the controls bar.
   */
  const OWN_LOOK = /(?:^|[\s;])(?:width|height|border(?:-[a-z-]+)?|background|color|padding)\s*:/
  const TOGGLES: [string, string][] = [['styles/core-player.css', '.expressive-code .core-show'], ['styles/mcp-replay.css', '.mcp-replay .mcp-replay__show']]
  const padding = (text: string, selector: string) => /padding:\s*([^;]+);/.exec(declarations(text, selector))?.[1]
  const property = (text: string, selector: string, name: string) => new RegExp(`(?:^|[\\s;])${name}:\\s*([^;]+);`).exec(declarations(text, selector))?.[1]
  /** The head row is the controls bar's box (record 0089): the same padding and top border, and the bar's own height. */
  const insetLikeControls = (text: string) => {
    const head = padding(text, '.mcp-replay__sidehead')
    return head === 'var(--mcp-inset-block) var(--mcp-inset-inline)' && head === padding(text, '.mcp-replay__controls') &&
      property(text, '.mcp-replay__sidehead', 'border-top') === property(text, '.mcp-replay__controls', 'border-top') &&
      property(text, '.mcp-replay__sidehead', 'height') === 'var(--mcp-sidehead)' &&
      /--mcp-sidehead:\s*var\(--mcp-bar\);/.test(text) &&
      /--mcp-bar:\s*calc\(var\(--mcp-track\) \+ 2 \* var\(--mcp-inset-block\) \+ var\(--mcp-edge\)\);/.test(text) &&
      property(text, '.mcp-replay__track', 'height') === 'var(--mcp-track)'
  }

  it.each(TOGGLES)('%s %s only places the button: the controls\' class draws it', (file, selector) => {
    expect(declarations(source(file), selector)).not.toMatch(OWN_LOOK)
  })

  it('insets the head row that holds Hide preview by the controls bar\'s own tokens', () => {
    expect(insetLikeControls(source('styles/mcp-replay.css'))).toBe(true)
  })

  it('fails a toggle that restyles itself, and a head row inset by values of its own, so the checks can fail', () => {
    expect(declarations('.core-show {\n  position: absolute;\n  border: 1px solid var(--control-border);\n}', '.core-show')).toMatch(OWN_LOOK)
    const drifted = '.mcp-replay__sidehead { padding: 0.25rem 0.5rem; }\n.mcp-replay__controls { padding: var(--mcp-inset-block) var(--mcp-inset-inline); }'
    expect(insetLikeControls(drifted)).toBe(false)
    const fixed = source('styles/mcp-replay.css').replace('--mcp-sidehead: var(--mcp-bar);', '--mcp-sidehead: 3rem;')
    expect(insetLikeControls(fixed), 'a head row of its own fixed height').toBe(false)
    const unbordered = source('styles/mcp-replay.css').replace('  border-top: var(--mcp-edge) solid var(--color-edge);\n}\n\nhtml:not([data-js]) .mcp-replay__sidehead', '}\n\nhtml:not([data-js]) .mcp-replay__sidehead')
    expect(unbordered).not.toBe(source('styles/mcp-replay.css'))
    expect(insetLikeControls(unbordered), 'a head row with no top border').toBe(false)
  })

  /** Every copy button is a bare clipboard (record 0087): 2rem square, no border, no fill at rest, muted ink, the control hover fill on hover. */
  const isMinimalCopy = (body: string) =>
    /width:\s*2rem/.test(body) && /height:\s*2rem/.test(body) && /border:\s*0\s*;/.test(body) &&
    /background:\s*none/.test(body) && !/font-size/.test(body) && !/opacity:/.test(body)
  const hoverFill = (text: string, selector: string) => /background:\s*var\(--color-surface-hover\)/.test(declarations(text, `${selector}:hover`))

  const COPIES: [string, string][] = [
    ['components/widgets/mcp-install.css', '.lm-mcp-install__copy'],
    ['components/widgets/package-install.css', '.lm-pkg-install__copy'],
    ['styles/core-player.css', '.expressive-code .core-copy'],
  ]

  it.each(COPIES)('%s %s is a bare 2rem clipboard that fills on hover', (file, selector) => {
    const text = source(file)
    expect(isMinimalCopy(declarations(text, selector))).toBe(true)
    expect(hoverFill(text, selector)).toBe(true)
  })

  it('has a control: the outlined square record 0067 drew, and an outlined text button, are not minimal', () => {
    const outlined = '.copy { width: 1.875rem; height: 1.875rem; border: 1px solid var(--control-border); background: var(--lm-bg); }'
    expect(isMinimalCopy(declarations(outlined, '.copy'))).toBe(false)
    const textButton = '.copy { border: 0; background: none; font-size: 0.75em; padding: 0.3rem 0.5rem; }'
    expect(isMinimalCopy(declarations(textButton, '.copy'))).toBe(false)
  })
})

/** One current-row rule for the API tree, the docs and MCP protocol sidebars and the catalog tree. */
describe('the current row', () => {
  const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
  const RULE = /background:\s*var\(--current-row-bg\);\s*color:\s*var\(--theme-primary\);\s*font-weight:\s*600;/

  it('tints the tree row, its closed bucket and the leaf in --theme-primary at weight 600', () => {
    const tree = source('styles/api-tree.css')
    const start = tree.indexOf(".api-nav__leaf[aria-current='page'],\n.api-nav__row:has(> [aria-current='page']),")
    expect(start).toBeGreaterThan(-1)
    expect(tree.slice(start, tree.indexOf('}', start) + 1)).toMatch(RULE)
    expect(tree).not.toMatch(/theme-accent\) 18%/)
  })

  it('gives the docs sidebar, which the MCP protocol pages use, and the page outline the same rule', () => {
    expect(source('components/TableOfContents/TableOfContentsList.astro')).toMatch(/a\[aria-current='true'\] \{\s*color: var\(--theme-primary\);\s*background: var\(--current-row-bg\);\s*font-weight: 600;/)
    expect(source('components/docs/SidebarLink.astro')).toMatch(/\.sidebar-link\.active \{\s*color: var\(--theme-primary\);\s*background: var\(--current-row-bg\);\s*font-weight: 600;/)
    expect(source('components/docs/SidebarSection.astro')).toMatch(/> summary \{\s*background: var\(--current-row-bg\);\s*color: var\(--theme-primary\);\s*font-weight: 600;/)
  })

  it('draws no accent bar at the start edge of the MCP install prerequisite block', () => {
    expect(source('components/widgets/mcp-install.css')).not.toMatch(/border-left:\s*3px solid var\(--lm-mcp-install-accent\)/)
  })

  it('draws no start-edge bar on a current row', () => {
    const outline = source('components/TableOfContents/TableOfContentsList.astro')
    expect(outline).not.toMatch(/aria-current='true'\]::before/)
    expect(outline).not.toMatch(/rgb\(/)
  })
})

/** Records 0015 and 0047: only an aside's start edge carries a bar; a current or lit row is marked by tint, colour and weight. */
describe('the start edge of a row', () => {
  const api = readFileSync(new URL('../src/styles/api.css', import.meta.url), 'utf8')
  /** The declarations of every rule whose selector list contains `selector`, including its states. */
  const declarations = (text: string, selector: string) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&')
    const found = [...text.matchAll(new RegExp(`(?:^|[\\n,}])\\s*${escaped}[^{}]*\\{([^}]*)\\}`, 'g'))].map((match) => match[1]!)
    expect(found, selector).not.toHaveLength(0)
    return found.join('\n')
  }
  /** A border or an inset shadow on the start edge: how a bar is drawn without a pseudo-element. */
  const BAR = /border-(?:left|inline-start)(?:-color|-width)?\s*:|box-shadow:\s*inset\s+-?\d+(?:\.\d+)?px\s+0/

  it('draws no bar on an entry of the contents of an API page, a glossary or the tmux catalog; the current one is tinted', () => {
    const entry = declarations(api, ':is(.api-page-contents, .api-glossary-contents) a')
    expect(entry).not.toMatch(BAR)
    expect(declarations(api, ':is(.api-page-contents, .api-glossary-contents) a[aria-current="location"]')).toMatch(/background:\s*var\(--current-row-bg\);[^}]*color:\s*var\(--color-link\);[^}]*font-weight:\s*600;/)
  })

  it('marks a tree row or a member link lit by its twin with a tint, not a bar', () => {
    const lit = declarations(api, '.api-nav__row.is-cross-lit')
    expect(lit).not.toMatch(BAR)
    // The tint kind-palette-contrast.test.ts measures the link colour against.
    expect(lit).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--color-link\)/)
  })

  it('has a control: the border and the inset shadow that drew the bars are caught', () => {
    expect('a { border-left: 2px solid transparent; }').toMatch(BAR)
    expect('a[aria-current] { border-left-color: var(--color-link); }').toMatch(BAR)
    expect('.row { box-shadow: inset 2px 0 0 var(--color-link); }').toMatch(BAR)
    expect('.row { box-shadow: 0 0 0 .15em red; border-radius: 2px; }').not.toMatch(BAR)
  })
})

describe('pickers, touch targets, focus and labels', () => {
  const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')

  it('gives every picker panel one inset: boxes on the padding, text and icons .5rem inside', () => {
    const picker = source('styles/documentation-picker.css')
    expect(picker).toContain('--picker-inset: .5rem;')
    for (const rule of ['.doc-picker-title', '.doc-picker-option', '.header-picker__heading', '.header-picker__footer']) {
      const start = picker.indexOf(`${rule} {`)
      expect(start, rule).toBeGreaterThan(-1)
      expect(picker.slice(start, picker.indexOf('}', start)), rule).toContain('var(--picker-inset)')
    }
    expect(picker).not.toContain('.header-picker__group > .header-picker__option')
    expect(source('components/docs/SurfacePicker.astro')).not.toMatch(/\.surface-picker-footer \{[^}]*margin:[^;]*-\.75rem/)
  })

  it('gives touch screens touch-target taps on the header, the sidebar head and the outline drawer without growing them', () => {
    const css = source('styles/global.css')
    const coarse = css.slice(css.indexOf('@media (pointer: coarse) {\n  .site-header'), css.indexOf('#mobile-toc li > a') + 120)
    expect(coarse).toContain(':is(.sidebar-head__up, .sidebar-head__title)::before { content: \'\'; position: absolute; inset: calc((100% - var(--touch-target)) / 2) -.25rem; }')
    expect(coarse).toContain('#mobile-toc li > a { display: flex; align-items: center; min-height: var(--touch-target); }')
  })

  it('gives touch screens touch-target taps on the page content: hit areas for small controls, full rows for lists (record 0071)', () => {
    const hit = 'content: \'\'; position: absolute; inset: calc((100% - var(--touch-target)) / 2) 0; }'
    const square = 'content: \'\'; position: absolute; inset: min(0px, calc((100% - var(--touch-target)) / 2)); }'
    const rules: Array<[string, string]> = [
      ['styles/global.css', '.prerelease-notice__more summary)::after { content: \'\'; position: absolute; inset: -.25rem -.25rem calc(.25rem + 100% - var(--touch-target)); }'],
      ['styles/global.css', '.inventory-help-link, footer .icons a)::after { ' + square],
      ['styles/global.css', ':is([data-breadcrumb-item], .crumb-collapsed > a, footer ul.flex a, [data-ci-examples] li a) { display: inline-flex; align-items: center; min-height: var(--touch-target); }'],
      ['styles/global.css', '.site-header .scheme-switch__option::before { ' + hit],
      ['styles/global.css', '.expressive-code .frame .copy button { width: var(--touch-target); height: var(--touch-target); }'],
      ['styles/api.css', '.api-member-chips button::after, .api-reference-eyebrow > a.api-badge::before { ' + hit],
      ['styles/api.css', '.heading-link::after { ' + square],
      ['styles/api.css', '.api-copy-name::before { inset: min(0px, calc((1lh - var(--touch-target)) / 2)); }'],
      ['styles/api.css', 'a.api-badge:is(.api-leg, .api-badge--mod) { overflow: visible; }'],
      ['styles/api.css', '.api-member-search > input { min-height: var(--touch-target); }'],
      ['styles/api.css', ':is(a.api-member-link, .api-guides-list a, .api-collection__limit a, .api-definition dd a, .tmux-usage__links a) { display: inline-flex; align-items: center; min-height: var(--touch-target); }'],
      ['components/api/EquivalentsTable.astro', '.api-eq-chipset button::after { ' + hit],
      ['components/docs/PageEnd.astro', ':is(.page-end__up a, .page-end__group li a) { display: inline-flex; align-items: center; min-height: var(--touch-target); }'],
      ['components/PortLinks.astro', '.port-link::before { ' + hit],
      ['components/widgets/install-surface.css', '.lm-install__seg button::after { ' + hit],
      ['styles/mcp-replay.css', '.mcp-replay__mark::after { content: \'\'; position: absolute; inset: calc((100% - var(--touch-target)) / 2) -.375rem; }'],
    ]
    for (const [file, rule] of rules) {
      const css = source(file)
      const at = css.indexOf(rule)
      expect(at, `${file}: ${rule}`).toBeGreaterThan(-1)
      const media = css.lastIndexOf('@media', at)
      expect(css.slice(media, css.indexOf('{', media)), `${file} is under coarse: ${rule}`).toContain('pointer: coarse')
    }
    // A link to another site draws its mark in `::after` (the shell's external-links.css), so its hit area must not.
    expect(source('components/PortLinks.astro')).not.toContain('.port-link::after')
    expect(source('styles/api.css')).not.toMatch(/a\.api-badge[^{]*::after/)
  })

  it('draws a picker row\'s differences in the caution ink, as the design system does', () => {
    expect(source('styles/documentation-picker.css')).toContain('.doc-picker-option .doc-picker-differences, .doc-picker-option[href]:hover .doc-picker-differences { color: var(--aside-caution-ink); font-weight: 500; }')
  })

  it('draws one rule above a page end that holds only the up row', () => {
    expect(source('components/docs/PageEnd.astro')).toContain('.page-end__up:first-child { padding-top: 0; border-top: 0; }')
  })

  it('keeps the member row head span first so its kind mark keeps its gap', () => {
    const list = source('components/api/ApiMemberList.astro')
    expect(list.indexOf('<span><ApiBadge label={kindOf(m)}')).toBeGreaterThan(-1)
    expect(list.indexOf('<span><ApiBadge label={kindOf(m)}')).toBeLessThan(list.indexOf('anchorsFor?.(m)'))
    expect(source('styles/kind-marks.css')).toContain('.api-member-list li > span:first-child) > .api-nav__kind:first-child')
  })

  it('draws port picker rows with 26px language icons in a panel as wide as its rows', () => {
    const switcher = source('components/PagePortSwitcher.astro')
    expect(switcher).toContain('.port-picker-panel[data-details] { --picker-width: 32rem; }')
    expect(switcher).not.toContain('.port-picker-panel { --picker-width: 32rem; }')
    expect(switcher).toMatch(/\.port-artwork \{[^}]*width: 1\.625rem; height: 1\.625rem;/)
    expect(switcher).toContain('src={withRoot(`/brand/languages/${entry.port}/icon.svg`)} width="26" height="26"')
    expect(switcher).not.toContain("branding(entry.port).asset('logo.svg')")
    expect(switcher).toContain('white-space: nowrap')
  })

  it('lifts rows to the touch target below the phone breakpoint', () => {
    for (const file of ['styles/api-tree.css', 'styles/documentation-picker.css']) {
      expect(source(file), file).toMatch(/@media [^{]*width < 30rem\)[^{]*\{[^@]*var\(--touch-target\)/)
    }
  })

  it('shows every focusable control the one ring, with no other colour for the tree', () => {
    expect(source('styles/global.css')).toMatch(/:where\(.*\):focus-visible \{\s*outline: 2px solid var\(--focus-ring-color\);\s*outline-offset: 2px;/)
    expect(source('styles/api-tree.css')).not.toMatch(/outline: 2px solid var\(--color-link\)/)
  })

  it('names the two language controls for what they choose', () => {
    expect(source('components/PagePortSwitcher.astro')).toContain('choose a programming language or tmux documentation')
    expect(source('components/widgets/AgentPrompt.astro')).toContain('aria-label="Programming language"')
    expect(source('components/LocaleSwitcher.astro')).toContain("t(locale, 'i18n.translationLanguage')")
    expect(source('i18n/ui.ts')).toContain("'i18n.translationLanguage': 'Translation language'")
    for (const file of ['components/PagePortSwitcher.astro', 'components/LocaleSwitcher.astro', 'components/widgets/AgentPrompt.astro']) {
      expect(source(file), file).not.toMatch(/aria-label="Language"|>Language</)
    }
  })

  it('says what the sidebar filter filters', () => {
    expect(source('components/docs/Sidebar.astro')).toContain('placeholder="Filter this section"')
  })
})

/** Labels are people's words, set in IBM Plex Sans (record 0031); mono stays for code, identifiers, paths and values. */
describe('labels in sans', () => {
  const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')

  it.each([
    ['components/api/RelationshipCollection.astro', '  .api-collection__kind { font'],
    ['components/HomeIntro.astro', '.home-eyebrow {'],
    ['styles/global.css', '.mcp-group > h2.api-index-summary {'],
  ])('%s sets %s in the sans face', (file, selector) => {
    const start = source(file).indexOf(selector)
    expect(start, selector).toBeGreaterThan(-1)
    const body = source(file).slice(start, source(file).indexOf('}', start))
    expect(body).toMatch(/var\(--font-sans[,)]|var\(--font-sans\)/)
    expect(body).not.toMatch(/mono/)
  })
})

/** "Back to top" covered about 30% of "Copy the prompt" at 476px (adoption plan step 51): below the phone breakpoint it sits 12px in and waits for two screens. */
describe('the Back to top button', () => {
  const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
  const button = source('components/BackToTop.astro')

  it('takes its corner from the inset property, 2rem and 0.75rem below the phone breakpoint, and its size from the size property', () => {
    const global = source('styles/global.css')
    expect(global).toMatch(/:root \{\s*--back-to-top-size: 2\.875rem;\s*--back-to-top-inset: 2rem;\s*\}/)
    expect(global).toMatch(/@media \(max-width: 29\.999rem\) \{\s*:root \{\s*--back-to-top-inset: 0\.75rem;/)
    expect(button).toMatch(/right: var\(--back-to-top-inset\);/)
    expect(button, 'no fixed 2rem inset left in the classes').not.toMatch(/\b(?:bottom|right)-8\b/)
  })

  it('appears after two screens of scrolling on a phone, and after 300px elsewhere', () => {
    expect(button).toContain("import { below } from '../lib/breakpoints'")
    expect(button).toMatch(/matchMedia\(below\('phone'\)\)/)
    expect(button).toMatch(/pageYOffset > \(phone\.matches \? 2 \* window\.innerHeight : 300\)/)
  })

  it('leaves the home page\'s last block room for it: its size plus its inset below the phone breakpoint', () => {
    const home = source('pages/index.astro')
    expect(home).toContain('class="home-last mt-16"')
    expect(home).toMatch(/@media \(max-width: 29\.999rem\) \{\s*\.home-last \{ padding-bottom: calc\(var\(--back-to-top-size\) \+ var\(--back-to-top-inset\)\); \}/)
  })
})

describe('shared chrome reads tokens, not greys', () => {
  const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')

  it.each(['components/BackToTop.astro', 'components/MobileToC.astro', 'layouts/DocsLayout.astro', 'components/TableOfContents/TableOfContents.astro', 'components/TableOfContents/TableOfContentsList.astro', 'components/docs/Sidebar.astro', 'components/RerollButton.astro'])(
    '%s has no slate or gray palette utility and no rgb or hex grey literal', (file) => {
      expect(source(file)).not.toMatch(/(?:bg|text|border|ring|divide|from|via|to)-(?:slate|gray|zinc|neutral|stone)-\d{2,3}/)
      expect(source(file)).not.toMatch(/rgb\(\d+ \d+ \d+\)/)
    })

  it('paints every drawer overlay with the scrim token', () => {
    expect(source('layouts/DocsLayout.astro')).toContain('bg-[var(--scrim)]')
    expect(source('components/MobileToC.astro')).toContain('bg-[var(--scrim)]')
    expect(source('styles/api-tree.css')).toContain('background: var(--scrim);')
    expect(source('components/SearchModal.astro')).toContain('background: var(--scrim);')
  })

  it('draws the reroll gradient from its tokens', () => {
    expect(source('components/RerollButton.astro')).toContain('linear-gradient(to right, var(--lm-reroll-from), var(--lm-reroll-to))')
  })
})

describe('muted text on API pages: a colour, never opacity', () => {
  const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')

  it('draws definition labels, signature separators and Default labels in the muted text colour', () => {
    const api = read('api.css')
    expect(api).toMatch(/\.api-definition dt \{[^}]*color: var\(--color-foreground-muted\);/)
    expect(api).not.toMatch(/\.api-definition dt \{[^}]*opacity/)
    expect(api).toMatch(/\.api-punct, \.api-type-label \{ color: var\(--color-foreground-muted\); \}/)
  })

  it.each(['components/api/ApiReference.astro', 'components/mcp/ProtocolReference.astro', 'components/tmux/Catalog.astro'])(
    '%s dims no member or type count, and no card summary, with opacity', (file) => {
      expect(source(file)).not.toMatch(/\bopacity-(?:60|80)\b/)
    })
})

describe('the dark signature header (record 0080)', () => {
  // The page ground and text of the default dark palette, and the approved dark name red.
  const ground = hex(/--background-color:\s*(#[0-9a-f]{6})/i.exec(read('brand.css').slice(read('brand.css').indexOf('dark')))![1]!)
  const text = hex('#e7edf3')
  const name = hex(/--color-api-name:\s*(#[0-9a-f]{6})/i.exec(read('vendor/gp-sphinx-api.css').slice(read('vendor/gp-sphinx-api.css').indexOf('--color-api-name: #ee5151') - 10))![1]!)
  const header = (share: number) => tint(text, share, ground)

  it('reads its share of the text colour from a token that dark sets to 3%', () => {
    const tokens = read('tokens.css')
    expect(tokens).toMatch(/:root \{[^}]*--signature-ground-share: 6%;/)
    expect(tokens.match(/--signature-ground-share: 3%;/g)).toHaveLength(2)
    expect(read('api.css')).toContain('var(--text-color) var(--signature-ground-share, 6%)')
  })

  it('keeps the approved name red at 4.5:1 on the 3% ground, which the 6% ground does not', () => {
    expect(ratio(name, header(0.03))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(name, header(0.06))).toBeLessThan(4.5)
  })
})

describe('badge and tab label floors (records 0051 and 0071)', () => {
  it('names the floor: 11px for a badge word', () => {
    expect(read('tokens.css')).toContain('--badge-word-floor: 11px;')
  })

  it('sizes the legend chip and the modifier badge so their .8em word reaches the badge floor', () => {
    const marks = read('kind-marks.css')
    expect(marks.match(/font: 600 max\(\.8125rem, calc\(var\(--badge-word-floor\) \/ \.8\)\)\/1/g)).toHaveLength(2)
  })

  it('draws a declaration\'s tab chips as the native 18px chip, so the kind word, Source and the modifier all reach the badge floor', () => {
    const api = read('api.css')
    const tab = api.slice(api.indexOf('The folder tab (design system'), api.indexOf('Source and the other ecosystem reference'))
    expect(read('tokens.css')).toContain('--tab-height: 18px;')
    // The chips take no size of their own, so each keeps the native chip's font and height; only the toolset badge is held to the tab's height.
    expect(tab).not.toMatch(/font-size|--leg-h|--corner/)
    expect(tab).toMatch(/\.api-corner > \.mcp-tier \{[^}]*height: var\(--tab-height\);/)
  })

  it('draws a parameter\'s "added" and deprecation labels at 12px, over the vendored 11px', () => {
    expect(read('api.css')).toContain('span.gp-sphinx-api-param-since, span.gp-sphinx-api-param-deprecated { font-size: max(0.75rem, 12px); }')
  })
})

describe('"In other ports" (record 0049)', () => {
  it('fills a hovered or focused name\'s kind mark with its family fill, not the table\'s neutral one', () => {
    const table = readFileSync(new URL('../src/components/api/EquivalentsTable.astro', import.meta.url), 'utf8')
    expect(table).toMatch(/\.api-eq-table \.api-elsewhere-value a:is\(:hover, :focus-visible\) > \.api-nav__kind \{\s*--mk-fill: var\(--mk-bg\);/)
  })
})

describe('inline code in 13px lists (records 0051 and 0071)', () => {
  const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')

  it('sets the tmux usage list\'s names at the list\'s own 13px and its other code at no less than 13px', () => {
    const usage = source('components/tmux/TmuxUsage.astro')
    expect(usage).toMatch(/\.tmux-usage \{ --name-scale: 1;[^}]*font-size: 0\.8125rem;/)
    expect(usage).toContain('.tmux-usage__item code { font-size: max(0.875em, 13px); }')
  })

  it('keeps the mark centred on the name at whatever scale the name takes', () => {
    const marks = read('kind-marks.css')
    expect(marks).toContain('top: calc(-1 * round(calc((var(--name-scale, .875) * 1cap - var(--mk-gh)) / 2), var(--mark-step)));')
    expect(marks).toContain('font-size: calc(var(--name-scale, .875) * 1em);')
  })

  it('floors the code in a doc comment\'s link at 12px', () => {
    expect(read('api.css')).toContain('.api-doc-link .api-literal { font-size: max(0.875em, 12px); }')
  })
})
