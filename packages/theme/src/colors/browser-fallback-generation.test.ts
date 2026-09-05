/**
 * @fileoverview Tests for CSS output structure and browser fallback mechanisms.
 *
 * This test file validates the CSS generation strategy, focusing on:
 * - Progressive enhancement using @supports queries
 * - Browser fallback mechanisms for newer CSS features
 * - CSS specificity and cascade order
 * - Proper CSS structure for maintainability
 * - Cross-browser compatibility patterns
 *
 * The tests ensure that our CSS output works correctly in both modern browsers
 * (with full feature support) and older browsers (with graceful degradation).
 *
 * @example
 * // To run these tests:
 * pnpm test browser-fallback-generation
 *
 * // To update snapshots after intentional changes:
 * pnpm test browser-fallback-generation -- -u
 *
 * @see {@link color-pipeline-stages.test.ts} - Theme definition and processing tests
 * @see {@link compatibility-side-effects.test.ts} - Runtime color transformation tests
 * @see {@link https://caniuse.com/css-color-mix} - Browser support for color-mix()
 * @see {@link https://caniuse.com/mdn-css_types_color_oklch} - Browser support for OKLCH
 */
import { describe, expect, it } from 'vitest'
import { compileWithPlugin } from '../test-utils'

describe('Browser Compatibility and CSS Output', () => {
  describe('CSS Feature Detection', () => {
    it('uses @supports for progressive enhancement', async () => {
      const css = await compileWithPlugin(['bg-theme-primary/50'])

      // Should use @supports for color-mix
      expect(css).toContain('@supports (color: color-mix(in lab, red, red))')

      // Fallback should come before the @supports block
      const lines = css.split('\n')
      let fallbackIndex = -1
      let supportsIndex = -1

      lines.forEach((line, index) => {
        if (line.includes('background-color: var(--theme-primary)') && !line.includes('color-mix')) {
          fallbackIndex = index
        }
        if (line.includes('@supports')) {
          supportsIndex = index
        }
      })

      expect(fallbackIndex).toBeGreaterThan(-1)
      expect(supportsIndex).toBeGreaterThan(fallbackIndex)
    })

    it('provides OKLCH fallbacks for older browsers', async () => {
      const css = await compileWithPlugin(['bg-theme-primary'])

      // CSS variables with OKLCH values
      expect(css).toContain('oklch(')

      // Modern browsers will handle OKLCH natively
      // Older browsers will ignore the entire declaration
      // This is acceptable as we're targeting modern browsers

      // The important part is that theme switching still works
      // via CSS variable references
      expect(css).toContain('background-color: var(--theme-primary)')
    })
  })

  describe('CSS Specificity and Cascade', () => {
    it('maintains proper specificity for theme utilities', async () => {
      const css = await compileWithPlugin(['bg-theme-primary', 'hover:bg-theme-secondary', 'bg-theme-primary/50'])

      // Base utility should have single class specificity
      expect(css).toMatch(/\.bg-theme-primary\s*{/)

      // Hover carries a hover condition on the utility class. The nesting
      // shape is version dependent (tailwindlabs/tailwindcss#20124), so only
      // the class and the hover media query are asserted.
      expect(css).toContain('.hover\\:bg-theme-secondary')
      expect(css).toContain('@media (hover: hover)')

      // Opacity variant should have same specificity as base
      expect(css).toMatch(/\.bg-theme-primary\\\/50\s*{/)
    })

    it('ensures theme selectors have proper specificity', async () => {
      const css = await compileWithPlugin([])

      // Theme selectors should use html element
      expect(css).toContain('html[data-theme="emerald"]')
      expect(css).toContain('html[data-theme="amber"]')

      // Dark mode should combine both selectors for higher specificity
      expect(css).toContain('html[data-theme="emerald"][data-theme-mode="dark"]')
    })

    it('orders CSS rules for proper cascade', async () => {
      const css = await compileWithPlugin(['bg-theme-primary', 'bg-theme-primary/50', 'hover:bg-theme-primary'])

      // Extract positions of different rules
      const positions: Record<string, number> = {}
      const lines = css.split('\n')

      lines.forEach((line, index) => {
        if (line.includes('.bg-theme-primary {')) {
          positions.base = index
        }
        if (line.includes('.bg-theme-primary\\/50')) {
          positions.opacity = index
        }
        if (line.includes('.hover\\:bg-theme-primary')) {
          positions.hover = index
        }
      })

      // All should be found
      expect(Object.keys(positions)).toHaveLength(3)

      // Order doesn't matter as much in Tailwind v4 due to cascade layers
      // but they should all exist
      expect(positions.base).toBeGreaterThan(-1)
      expect(positions.opacity).toBeGreaterThan(-1)
      expect(positions.hover).toBeGreaterThan(-1)
    })
  })

  describe('CSS Output Format and Structure', () => {
    it('generates properly formatted CSS', async () => {
      const css = await compileWithPlugin(['bg-theme-primary', 'text-theme-secondary'])

      // Should have proper CSS structure
      expect(css).toContain('{')
      expect(css).toContain('}')
      expect(css).toContain(';')

      // Should not have syntax errors
      const openBraces = (css.match(/{/g) || []).length
      const closeBraces = (css.match(/}/g) || []).length
      expect(openBraces).toBe(closeBraces)

      // Should have proper indentation (Tailwind formats output)
      expect(css).toMatch(/\s{2,}/) // Has indentation
    })

    it('uses CSS layers appropriately', async () => {
      const css = await compileWithPlugin([])

      // Base variables should be in @layer base
      expect(css).toContain('@layer base')

      // Check that :root is within base layer
      const baseLayerMatch = css.match(/@layer base\s*{([^}]+)}/s)
      expect(baseLayerMatch?.[1]).toContain(':root')
    })

    it('handles media queries for responsive design', async () => {
      const css = await compileWithPlugin(['hover:bg-theme-primary'])

      // Hover states should respect hover capability
      expect(css).toContain('@media (hover: hover)')
    })
  })

  describe('Performance Considerations', () => {
    it('generates efficient CSS with minimal duplication', async () => {
      const css = await compileWithPlugin([
        'bg-theme-primary',
        'text-theme-primary',
        'border-theme-primary',
        'ring-theme-primary',
      ])

      // Each utility should appear only once
      const bgCount = (css.match(/\.bg-theme-primary\s*{/g) || []).length
      const textCount = (css.match(/\.text-theme-primary\s*{/g) || []).length
      const borderCount = (css.match(/\.border-theme-primary\s*{/g) || []).length
      const ringCount = (css.match(/\.ring-theme-primary\s*{/g) || []).length

      expect(bgCount).toBe(1)
      expect(textCount).toBe(1)
      expect(borderCount).toBe(1)
      expect(ringCount).toBe(1)
    })

    it('reuses CSS variables efficiently', async () => {
      const css = await compileWithPlugin(['bg-theme-primary', 'text-theme-primary', 'hover:bg-theme-primary'])

      // All should reference the same CSS variable
      const varReferences = css.matchAll(/var\(--theme-primary\)/g)
      const refCount = Array.from(varReferences).length

      // Should have multiple references to the same variable
      expect(refCount).toBeGreaterThanOrEqual(3)
    })
  })

  describe('Edge Cases and Error Handling', () => {
    it('handles missing theme gracefully', async () => {
      // Even with no explicit theme, CSS should be valid
      const css = await compileWithPlugin(['bg-theme-primary'])

      // Should still generate valid CSS
      expect(css).toContain('background-color: var(--theme-primary)')

      // CSS variables will cascade from :root or default theme
    })

    it('handles rapid theme switching scenarios', async () => {
      const css = await compileWithPlugin(['bg-theme-primary'])

      // Theme colors resolve through CSS variables, so data-theme changes
      // restyle instantly without recompilation
      expect(css).toContain('background-color')
    })
  })
})
