/**
 * @fileoverview Tests for runtime color transformations and browser compatibility features.
 *
 * This test file validates the runtime behavior of color mutations, including:
 * - Opacity transformations using color-mix()
 * - Browser fallbacks with @supports queries
 * - Theme switching mechanics and CSS variable cascading
 * - Color space conversions (OKLCH to sRGB)
 * - Component state transformations (hover, active)
 * - Gradient color combinations
 *
 * These tests ensure that colors behave correctly in real browsers and that
 * our progressive enhancement strategy provides proper fallbacks for older browsers.
 *
 * @example
 * // To run these tests:
 * pnpm test compatibility-side-effects
 *
 * // To update snapshots after intentional changes:
 * pnpm test compatibility-side-effects -- -u
 *
 * @see {@link color-pipeline-stages.test.ts} - Static theme definition tests
 * @see {@link browser-fallback-generation.test.ts} - CSS output and structure tests
 * @see {@link ../test-utils.ts} - Testing utilities and helpers
 */
import { describe, expect, it } from 'vitest'
import { THEME_DEFINITIONS } from '../constants'
import { compileWithPlugin } from '../test-utils'

describe('Color Mutation Pipeline', () => {
  describe('Opacity Mutations via color-mix()', () => {
    it('transforms colors with opacity modifiers', async () => {
      const opacityUtilities = [
        'bg-theme-primary/10',
        'bg-theme-primary/50',
        'bg-theme-primary/90',
        'text-theme-secondary/20',
        'border-theme-accent/30',
      ]

      const css = await compileWithPlugin(opacityUtilities)

      // Test that color-mix is used for opacity
      expect(css).toContain('color-mix(in srgb')
      expect(css).toContain('10%, transparent)')
      expect(css).toContain('50%, transparent)')
      expect(css).toContain('90%, transparent)')

      // Test that base color is preserved with fallback
      expect(css).toContain('background-color: var(--theme-primary);')
      expect(css).toContain('@supports (color: color-mix(in lab, red, red))')

      // Snapshot the opacity transformations
      expect(css).toMatchSnapshot('opacity-color-mutations')
    })

    it('handles edge case opacity values', async () => {
      const edgeCaseUtilities = [
        'bg-theme-primary/0', // 0% opacity
        'bg-theme-primary/100', // 100% opacity
        'bg-theme-primary/5', // 5% opacity
        'bg-theme-primary/95', // 95% opacity
      ]

      const css = await compileWithPlugin(edgeCaseUtilities)

      // Should contain all opacity values now with modifiers
      expect(css).toContain('/0')
      expect(css).toContain('/100')
      expect(css).toContain('/5')
      expect(css).toContain('/95')

      // Check that color-mix is used for these values
      expect(css).toContain('color-mix(in srgb, var(--theme-primary) 0%, transparent)')
      expect(css).toContain('color-mix(in srgb, var(--theme-primary) 100%, transparent)')
      expect(css).toContain('color-mix(in srgb, var(--theme-primary) 5%, transparent)')
      expect(css).toContain('color-mix(in srgb, var(--theme-primary) 95%, transparent)')
    })
  })

  describe('Color Space Conversions', () => {
    it('converts OKLCH to sRGB in color-mix', async () => {
      const css = await compileWithPlugin(['bg-theme-primary/50'])

      // color-mix uses sRGB color space
      expect(css).toContain('color-mix(in srgb')

      // Original OKLCH values are preserved in CSS variables
      expect(css).toContain(`oklch(${THEME_DEFINITIONS.emerald.primary.match(/oklch\(([^)]+)\)/)?.[1]})`)

      expect(css).toMatchSnapshot('color-space-conversion')
    })

    it('provides @supports fallback for color-mix', async () => {
      const css = await compileWithPlugin(['bg-theme-accent/30'])

      // Should have fallback without color-mix
      const lines = css.split('\n')
      const bgIndex = lines.findIndex((line) => line.includes('background-color: var(--theme-accent);'))
      const supportsIndex = lines.findIndex((line) => line.includes('@supports'))

      expect(bgIndex).toBeLessThan(supportsIndex)
      expect(bgIndex).toBeGreaterThan(-1)

      expect(css).toMatchSnapshot('color-mix-fallback')
    })
  })

  describe('Runtime Theme Switching', () => {
    it('generates correct CSS variable cascades for theme switching', async () => {
      const css = await compileWithPlugin(['bg-theme-primary', 'text-theme-secondary'])

      // Check emerald theme variables
      expect(css).toContain('html[data-theme="emerald"] {')
      expect(css).toContain('--theme-primary: var(--color-emerald-primary)')
      expect(css).toContain('--theme-secondary: var(--color-emerald-secondary)')

      // Check amber theme variables
      expect(css).toContain('html[data-theme="amber"] {')
      expect(css).toContain('--theme-primary: var(--color-amber-primary)')

      // Check utilities use theme-aware variables
      expect(css).toContain('background-color: var(--theme-primary)')
      expect(css).toContain('color: var(--theme-secondary)')

      expect(css).toMatchSnapshot('theme-switching-cascade')
    })

    it('applies dark mode overrides correctly', async () => {
      const css = await compileWithPlugin(['bg-theme-primary', 'bg-theme-accent'])

      // Check dark mode overrides for emerald
      expect(css).toContain('html[data-theme="emerald"][data-theme-mode="dark"] {')

      // Accent color changes in dark mode for emerald
      expect(css).toContain('--theme-accent: oklch(0.85 0.1 160)')

      // Primary stays the same in dark mode for emerald
      const darkEmeraldMatch = css.match(/data-theme="emerald"\]\[data-theme-mode="dark"\][^}]+}/s)
      expect(darkEmeraldMatch?.[0]).toContain('--theme-primary: oklch(0.65 0.2 160)')

      expect(css).toMatchSnapshot('dark-mode-mutations')
    })
  })

  describe('Gradient Color Mutations', () => {
    it('combines theme colors in gradients', async () => {
      const css = await compileWithPlugin([
        'bg-gradient-theme-right-primary-secondary',
        'bg-gradient-theme-radial-accent-primary',
      ])

      // Linear gradient
      expect(css).toContain('linear-gradient(to right, var(--theme-primary), var(--theme-secondary))')

      // Radial gradient
      expect(css).toContain('radial-gradient(circle at center, var(--theme-accent), var(--theme-primary))')

      expect(css).toMatchSnapshot('gradient-color-combinations')
    })

    it('handles dynamic gradient generation', async () => {
      // Values must exist in GRADIENT_VALUES; utilities are generated on
      // demand, so out-of-catalog candidates emit nothing.
      const css = await compileWithPlugin([
        'bg-gradient-theme-br-primary-secondary',
        'bg-gradient-theme-right-secondary-accent',
      ])

      // Check direction mapping
      expect(css).toContain('linear-gradient(to bottom right')
      expect(css).toContain('linear-gradient(to right')

      // Check color references
      expect(css).toContain('var(--theme-primary), var(--theme-secondary)')
      expect(css).toContain('var(--theme-secondary), var(--theme-accent)')

      expect(css).toMatchSnapshot('dynamic-gradient-mutations')
    })
  })

  describe('CSS Variable Inheritance and Cascading', () => {
    it('ensures proper variable inheritance chain', async () => {
      const css = await compileWithPlugin([])

      // Root level: base color definitions
      expect(css).toContain(':root {')
      expect(css).toContain('--color-emerald-primary: oklch(0.65 0.2 160)')

      // Theme level: theme-aware mappings
      expect(css).toContain('html[data-theme="emerald"] {')
      expect(css).toContain('--theme-primary: var(--color-emerald-primary)')

      // Dark mode level: selective overrides
      expect(css).toContain('[data-theme-mode="dark"] {')

      expect(css).toMatchSnapshot('css-variable-cascade')
    })

    it('validates CSS variable references are valid', async () => {
      const css = await compileWithPlugin(['bg-theme-primary', 'text-theme-text'])

      // Count var() references
      const _varReferences = css.match(/var\(--[^)]+\)/g) || []

      // Each should reference a defined variable
      const definedVars = new Set<string>()
      const varDefinitions = css.matchAll(/(--[\w-]+):\s*[^;]+;/g)
      for (const match of varDefinitions) {
        definedVars.add(match[1])
      }

      // Check that all referenced variables are defined
      const referencedVars = new Set<string>()
      const varRefs = css.matchAll(/var\((--[\w-]+)\)/g)
      for (const match of varRefs) {
        referencedVars.add(match[1])
      }

      // All referenced variables should be defined
      for (const ref of referencedVars) {
        expect(definedVars.has(ref), `Variable ${ref} is referenced but not defined`).toBe(true)
      }
    })
  })

  describe('OKLCH Value Preservation', () => {
    it('preserves exact OKLCH values through the pipeline', async () => {
      const css = await compileWithPlugin([])

      // Check that our exact OKLCH values are preserved
      for (const [themeName, colors] of Object.entries(THEME_DEFINITIONS)) {
        for (const [colorName, colorValue] of Object.entries(colors)) {
          expect(css).toContain(`--color-${themeName}-${colorName}: ${colorValue}`)
        }
      }
    })

    it('validates OKLCH format consistency', async () => {
      const css = await compileWithPlugin([])

      // All OKLCH values should match the expected format
      const oklchValues = css.matchAll(/oklch\([^)]+\)/g)
      for (const match of oklchValues) {
        const value = match[0]
        expect(value).toMatch(/^oklch\(\s*\d+\.?\d*\s+\d+\.?\d*\s+\d+\.?\d*\s*\)$/)
      }
    })
  })
})
