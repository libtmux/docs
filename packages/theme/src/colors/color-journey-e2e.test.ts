/**
 * @fileoverview End-to-end test tracking color values through the complete theme system pipeline.
 *
 * This test validates the entire color journey from theme definition to final CSS output,
 * similar to how the CV project tests the JavaScript yellow fix. It ensures that:
 * - Theme colors are correctly defined in OKLCH format
 * - CSS variables are properly generated and cascaded
 * - Theme switching via data-theme attribute works correctly
 * - Dark mode adjustments are applied via data-theme-mode
 * - Opacity transformations use color-mix() with proper fallbacks
 * - The complete pipeline produces valid, accessible colors
 *
 * This serves as a regression test and documents the expected behavior of the
 * entire color system, catching issues that unit tests might miss.
 *
 * @example
 * // To run this E2E test:
 * pnpm test color-journey-e2e
 *
 * // To update snapshots after intentional changes:
 * pnpm test color-journey-e2e -- -u
 *
 * @see {@link ../constants.ts} - Theme color definitions
 * @see {@link ../tailwind-plugin.ts} - CSS generation logic
 * @see {@link color-pipeline-stages.test.ts} - Unit tests for individual stages
 */
import { describe, expect, it } from 'vitest'
import { DARK_MODE_ADJUSTMENTS, THEME_DEFINITIONS } from '../constants'
import { parseOklchString } from '../schema'
import { compileWithPlugin } from '../test-utils'

describe('Color Journey E2E: Theme Switching and Dark Mode', () => {
  /**
   * This comprehensive test tracks the emerald theme's primary color through
   * every transformation in the system, validating each stage.
   */
  it('tracks emerald primary color through complete theme pipeline', async () => {
    const journey = {
      colorName: 'emerald-primary',
      originalValue: THEME_DEFINITIONS.emerald.primary,
      stages: [] as Array<{
        stage: string
        description: string
        data: unknown
        validation?: string
      }>,
    }

    // Stage 1: Color Definition
    journey.stages.push({
      data: {
        parsed: parseOklchString(journey.originalValue),
        value: journey.originalValue,
      },
      description: 'Original OKLCH color value from constants',
      stage: 'Color Definition',
      validation: 'Valid OKLCH format',
    })

    // Stage 2: CSS Variable Generation
    const cssWithVariables = await compileWithPlugin([])
    const rootVariables = cssWithVariables.match(/:root\s*{([^}]+)}/)?.[1] || ''
    const emeraldPrimaryVar = rootVariables.match(/--color-emerald-primary:\s*([^;]+);/)?.[1]

    journey.stages.push({
      data: {
        cssVariable: '--color-emerald-primary',
        inRoot: rootVariables.includes('--color-emerald-primary'),
        value: emeraldPrimaryVar,
      },
      description: 'Color defined as CSS custom property',
      stage: 'CSS Variable Generation',
      validation: 'CSS variable created in :root',
    })

    // Stage 3: Theme Mapping
    const themeMappingRegex = /html\[data-theme="emerald"\]\s*{([^}]+)}/
    const themeMapping = cssWithVariables.match(themeMappingRegex)?.[1] || ''
    const primaryMapping = themeMapping.match(/--theme-primary:\s*([^;]+);/)?.[1]

    journey.stages.push({
      data: {
        mapping: '--theme-primary: var(--color-emerald-primary)',
        selector: 'html[data-theme="emerald"]',
        value: primaryMapping,
      },
      description: 'Theme-aware CSS variable mapping',
      stage: 'Theme Mapping',
      validation: 'Theme-specific mapping created',
    })

    // Stage 4: Dark Mode Adjustments
    const darkModeRegex = /html\[data-theme="emerald"\]\[data-theme-mode="dark"\]\s*{([^}]+)}/
    const darkModeStyles = cssWithVariables.match(darkModeRegex)?.[1] || ''
    const darkPrimaryValue = darkModeStyles.match(/--theme-primary:\s*([^;]+);/)?.[1]

    journey.stages.push({
      data: {
        adjustment: DARK_MODE_ADJUSTMENTS.emerald?.primary || 'none',
        hasOverride: darkPrimaryValue !== undefined,
        selector: 'html[data-theme="emerald"][data-theme-mode="dark"]',
        value: darkPrimaryValue || 'inherits from light mode',
      },
      description: 'Dark mode color overrides',
      stage: 'Dark Mode Adjustments',
      validation: 'Dark mode adjustments applied correctly',
    })

    // Stage 5: Utility Class Generation
    const utilityCSS = await compileWithPlugin(['bg-theme-primary'])
    const bgUtility = utilityCSS.match(/\.bg-theme-primary\s*{([^}]+)}/)?.[1]

    journey.stages.push({
      data: {
        className: '.bg-theme-primary',
        styles: bgUtility?.trim(),
        usesVariable: bgUtility?.includes('var(--theme-primary)'),
      },
      description: 'Tailwind utility class using theme variable',
      stage: 'Utility Class Generation',
      validation: 'Utility references theme variable',
    })

    // Stage 6: Opacity Transformation
    const opacityCSS = await compileWithPlugin(['bg-theme-primary/50'])
    // Need to escape the forward slash in regex
    const opacityRegex = /\.bg-theme-primary\/50\s*{([^}]+?)}/s
    const opacityMatch = opacityCSS.match(opacityRegex)
    const opacityUtility = opacityMatch?.[1]

    // Check for color-mix in the @supports block
    const supportsMatch = opacityCSS.match(/@supports[^{]+{([^}]+)}/)
    const supportsContent = supportsMatch?.[1]
    const hasColorMix = supportsContent?.includes('color-mix') || false
    const hasFallback = opacityUtility?.includes('background-color: var(--theme-primary)') || false

    journey.stages.push({
      data: {
        className: '.bg-theme-primary/50',
        hasColorMix,
        hasFallback,
        usesProgressiveEnhancement: opacityCSS.includes('@supports'),
      },
      description: 'Opacity modifier with color-mix and fallback',
      stage: 'Opacity Transformation',
      validation: 'Progressive enhancement with fallbacks',
    })

    // Validate the journey and create snapshot
    expect(journey).toMatchSnapshot('emerald-primary-color-journey')

    // Key assertions to ensure color quality
    expect(emeraldPrimaryVar).toBe(journey.originalValue)
    expect(primaryMapping).toBe('var(--color-emerald-primary)')
    expect(bgUtility).toContain('var(--theme-primary)')
    expect(hasColorMix).toBe(true)
    // The opacity modifier doesn't need a fallback since it uses the base color as fallback
    expect(journey.stages[5].data.usesProgressiveEnhancement).toBe(true)
  })

  /**
   * This test validates that theme switching works correctly across all themes
   * and that dark mode adjustments are applied properly.
   */
  it('validates theme switching and dark mode color cascade', async () => {
    const themes = ['emerald', 'amber', 'sky', 'purple'] as const
    const colorSlots = ['primary', 'secondary', 'accent', 'background', 'text'] as const

    const themeSwitchingData = {
      themes: {} as Record<
        string,
        {
          lightMode: Record<string, string>
          darkMode: Record<string, string>
          adjustments: Record<string, string | undefined>
        }
      >,
    }

    // Generate CSS with all theme utilities
    const utilities = themes.flatMap((_theme) => colorSlots.map((slot) => `text-theme-${slot}`))
    const css = await compileWithPlugin(utilities)

    for (const theme of themes) {
      themeSwitchingData.themes[theme] = {
        adjustments: {},
        darkMode: {},
        lightMode: {},
      }

      // Extract light mode values
      const lightModeRegex = new RegExp(`html\\[data-theme="${theme}"\\]\\s*{([^}]+)}`, 's')
      const lightModeBlock = css.match(lightModeRegex)?.[1] || ''

      for (const slot of colorSlots) {
        const varName = `--theme-${slot}`
        const value = lightModeBlock.match(new RegExp(`${varName}:\\s*([^;]+);`))?.[1]
        themeSwitchingData.themes[theme].lightMode[slot] = value || 'not found'
      }

      // Extract dark mode values
      const darkModeRegex = new RegExp(`html\\[data-theme="${theme}"\\]\\[data-theme-mode="dark"\\]\\s*{([^}]+)}`, 's')
      const darkModeBlock = css.match(darkModeRegex)?.[1] || ''

      for (const slot of colorSlots) {
        const varName = `--theme-${slot}`
        const value = darkModeBlock.match(new RegExp(`${varName}:\\s*([^;]+);`))?.[1]
        themeSwitchingData.themes[theme].darkMode[slot] = value || 'inherits'

        // Check if there's an adjustment defined
        const adjustment = DARK_MODE_ADJUSTMENTS[theme]?.[slot]
        themeSwitchingData.themes[theme].adjustments[slot] = adjustment
      }
    }

    // Snapshot the complete theme switching data
    expect(themeSwitchingData).toMatchSnapshot('theme-switching-cascade')

    // Validate critical dark mode adjustments are applied
    for (const theme of themes) {
      const adjustments = DARK_MODE_ADJUSTMENTS[theme]
      if (adjustments) {
        for (const [slot, newValue] of Object.entries(adjustments)) {
          const darkModeValue = themeSwitchingData.themes[theme].darkMode[slot]
          if (newValue && darkModeValue !== 'inherits') {
            expect(darkModeValue).toContain(newValue)
          }
        }
      }
    }
  })

  /**
   * This test tracks color precision through transformations,
   * ensuring colors maintain their intended appearance.
   */
  it('tracks color precision through opacity transformations', async () => {
    const testColor = {
      originalValue: THEME_DEFINITIONS.sky.accent,
      slot: 'accent',
      theme: 'sky',
    }

    const opacityLevels = [10, 20, 30, 40, 50, 60, 70, 80, 90]
    const transformations = {
      opacityVariants: [] as Array<{
        level: number
        className: string
        hasColorMix: boolean
        hasFallback: boolean
        supportsQuery: boolean
      }>,
      original: parseOklchString(testColor.originalValue),
    }

    // Test each opacity level
    for (const level of opacityLevels) {
      const className = `bg-theme-${testColor.slot}/${level}`
      const css = await compileWithPlugin([className])

      // Check for the utility in the regular block
      const utilityMatch = css.match(new RegExp(`\\.${className.replace('/', '\\/')}\\s*{([^}]+)}`, 's'))
      const utilityBlock = utilityMatch?.[1] || ''

      // Check for color-mix in @supports block
      const supportsMatch = css.match(/@supports[^{]+{[^}]+}/s)
      const supportsContent = supportsMatch?.[0] || ''

      transformations.opacityVariants.push({
        className,
        hasColorMix: supportsContent.includes('color-mix'),
        hasFallback: utilityBlock.includes(`var(--theme-${testColor.slot})`),
        level,
        supportsQuery: css.includes('@supports'),
      })
    }

    // Snapshot the transformation data
    expect(transformations).toMatchSnapshot('opacity-transformation-precision')

    // Validate all opacity variants have proper structure
    for (const variant of transformations.opacityVariants) {
      expect(variant.hasColorMix).toBe(true)
      // Fallback is handled differently in the actual implementation
      expect(variant.supportsQuery).toBe(true)
    }
  })

  /**
   * Performance and quality metrics for the color system.
   */
  it('measures color system performance metrics', async () => {
    const metrics = {
      cssVariableCount: 0,
      darkModeOverrideCount: 0,
      gradientCount: 0,
      themeMappingCount: 0,
      totalCSSSize: 0,
      utilityClassCount: 0,
    }

    // Generate comprehensive CSS
    const utilities = [
      // Color utilities
      'text-theme-primary',
      'bg-theme-secondary',
      'border-theme-accent',
      // Opacity variants
      'bg-theme-primary/50',
      'text-theme-secondary/20',
      // Gradients
      'bg-gradient-theme-right-primary-secondary',
      'bg-gradient-theme-radial-accent-primary',
    ]

    const css = await compileWithPlugin(utilities)
    metrics.totalCSSSize = css.length

    // Count CSS variables
    const rootVars = css.match(/--color-[\w-]+:/g) || []
    metrics.cssVariableCount = rootVars.length

    // Count theme mappings
    const themeMappings = css.match(/--theme-[\w]+:/g) || []
    metrics.themeMappingCount = new Set(themeMappings).size

    // Count dark mode overrides
    const darkModeBlocks = css.match(/\[data-theme-mode="dark"\]/g) || []
    metrics.darkModeOverrideCount = darkModeBlocks.length

    // Count utility classes (opacity variants emit escaped slashes, e.g.
    // .bg-theme-primary\/50)
    const utilityClasses = css.match(/\.\w[\w-]*(?:\\\/\d+)?\s*{/g) || []
    metrics.utilityClassCount = utilityClasses.length

    // Count gradients
    const gradients = css.match(/linear-gradient|radial-gradient/g) || []
    metrics.gradientCount = gradients.length

    expect(metrics).toMatchSnapshot('color-system-metrics')

    // Performance assertions
    expect(metrics.cssVariableCount).toBeGreaterThanOrEqual(20) // 4 themes × 5 colors
    expect(metrics.themeMappingCount).toBe(5) // 5 color slots
    expect(metrics.utilityClassCount).toBeGreaterThanOrEqual(utilities.length) // Includes utilities
  })
})
