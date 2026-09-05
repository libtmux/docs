/**
 * Tailwind CSS Plugin
 *
 * This plugin creates a comprehensive theme system for React applications using
 * Tailwind CSS v4's plugin API. It provides a centralized source of truth for
 * themes and color schemes, generates CSS variables, and creates theme-aware utility classes.
 *
 * @module tailwind-plugin
 */

import type { PluginAPI } from 'tailwindcss/plugin'
import plugin from 'tailwindcss/plugin'
import { DARK_MODE_ADJUSTMENTS, GRADIENT_VALUES, THEME_DEFINITIONS } from './constants'
import { validateDarkModeAdjustments, validateGradientValues, validateThemes } from './schema'

/**
 * CssInJs type from Tailwind CSS
 */
type CssInJs = { [key: string]: string | string[] | CssInJs | CssInJs[] }

/**
 * Type definition for a Tailwind plugin
 * This is needed because Tailwind's type system doesn't export a direct Plugin type
 */
type TailwindPlugin = { handler: (api: PluginAPI) => void }

/**
 * Tailwind plugin
 * Creates a comprehensive theme system with semantic color utilities
 */
const tailwindPlugin = plugin((api: PluginAPI) => {
  // Bound, not plainly destructured. Tailwind hands these out as standalone
  // functions, so the bare destructure works in fact — but `oxlint
  // --type-aware`'s unbound-method rule cannot know that, and it is right in
  // general. Binding keeps the short call sites below and stays correct if
  // Tailwind ever makes one of them depend on `this`; a suppression comment
  // would do neither, and would hide the next unbound method added here.
  const { addBase, addUtilities, matchUtilities } = {
    addBase: api.addBase.bind(api),
    addUtilities: api.addUtilities.bind(api),
    matchUtilities: api.matchUtilities.bind(api),
  }

  /**
   * Theme definitions - central source of truth
   * Each theme uses OKLCH color space for better perceptual uniformity
   * Validated using Zod schemas
   */
  const themes = validateThemes(THEME_DEFINITIONS)

  /**
   * Dark color scheme adjustments
   * These override specific colors when the dark color scheme is active
   * Only includes colors that need adjustment for dark mode
   * Validated using Zod schemas
   */
  const darkModeAdjustments = validateDarkModeAdjustments(DARK_MODE_ADJUSTMENTS)

  // Generate base variables for all themes
  const baseVariables = Object.entries(themes).reduce<Record<string, string>>((acc, [themeName, colors]) => {
    for (const [key, value] of Object.entries(colors)) {
      acc[`--color-${themeName}-${key}`] = value
    }
    return acc
  }, {})

  // Add CSS variables to :root
  addBase({
    ':root': baseVariables,
  })

  // Create theme-aware CSS for each theme
  for (const [themeName, _] of Object.entries(themes)) {
    addBase({
      [`html[data-theme="${themeName}"]`]: {
        '--theme-accent': `var(--color-${themeName}-accent)`,
        '--theme-background': `var(--color-${themeName}-background)`,
        '--theme-primary': `var(--color-${themeName}-primary)`,
        '--theme-secondary': `var(--color-${themeName}-secondary)`,
        '--theme-text': `var(--color-${themeName}-text)`,
      },
    })

    // Add dark mode theme variables
    if (darkModeAdjustments[themeName]) {
      addBase({
        [`html[data-theme="${themeName}"][data-theme-mode="dark"]`]: {
          '--theme-accent': darkModeAdjustments[themeName]?.accent || `var(--color-${themeName}-accent)`,
          '--theme-primary': darkModeAdjustments[themeName]?.primary || `var(--color-${themeName}-primary)`,
          '--theme-secondary': darkModeAdjustments[themeName]?.secondary || `var(--color-${themeName}-secondary)`,
        },
      })
    }
  }

  // Add semantic theme utilities with opacity support using modifiers
  matchUtilities(
    {
      'text-theme': (value: string, { modifier }): CssInJs => {
        const baseColor = `var(--theme-${value})`
        if (modifier) {
          const opacity = Number.parseFloat(modifier)
          if (!Number.isNaN(opacity)) {
            // Only generate CSS for valid opacity range
            if (opacity >= 0 && opacity <= 100) {
              return {
                color: `color-mix(in srgb, ${baseColor} ${opacity}%, transparent)`,
              }
            }
            // Skip CSS generation for numeric values outside valid range
            return {}
          }
          // For non-numeric modifiers, fall back to base color
          return { color: baseColor }
        }
        return { color: baseColor }
      },
    },
    {
      modifiers: 'any',
      values: {
        accent: 'accent',
        background: 'background',
        border: 'border',
        'border-secondary': 'border-secondary',
        muted: 'muted',
        'muted-foreground': 'muted-foreground',
        primary: 'primary',
        secondary: 'secondary',
        surface: 'surface',
        'surface-secondary': 'surface-secondary',
        text: 'text',
      },
    },
  )

  matchUtilities(
    {
      'bg-theme': (value: string, { modifier }): CssInJs => {
        const baseColor = `var(--theme-${value})`
        if (modifier) {
          const opacity = Number.parseFloat(modifier)
          if (!Number.isNaN(opacity)) {
            // Only generate CSS for valid opacity range
            if (opacity >= 0 && opacity <= 100) {
              return {
                backgroundColor: `color-mix(in srgb, ${baseColor} ${opacity}%, transparent)`,
              }
            }
            // Skip CSS generation for numeric values outside valid range
            return {}
          }
          // For non-numeric modifiers, fall back to base color
          return { backgroundColor: baseColor }
        }
        return { backgroundColor: baseColor }
      },
    },
    {
      modifiers: 'any',
      values: {
        accent: 'accent',
        background: 'background',
        border: 'border',
        'border-secondary': 'border-secondary',
        muted: 'muted',
        'muted-foreground': 'muted-foreground',
        primary: 'primary',
        secondary: 'secondary',
        surface: 'surface',
        'surface-secondary': 'surface-secondary',
        text: 'text',
      },
    },
  )

  matchUtilities(
    {
      'border-theme': (value: string, { modifier }): CssInJs => {
        const baseColor = `var(--theme-${value})`
        if (modifier) {
          const opacity = Number.parseFloat(modifier)
          if (!Number.isNaN(opacity)) {
            // Only generate CSS for valid opacity range
            if (opacity >= 0 && opacity <= 100) {
              return {
                borderColor: `color-mix(in srgb, ${baseColor} ${opacity}%, transparent)`,
              }
            }
            // Skip CSS generation for numeric values outside valid range
            return {}
          }
          // For non-numeric modifiers, fall back to base color
          return { borderColor: baseColor }
        }
        return { borderColor: baseColor }
      },
    },
    {
      modifiers: 'any',
      values: {
        accent: 'accent',
        background: 'background',
        border: 'border',
        'border-secondary': 'border-secondary',
        muted: 'muted',
        'muted-foreground': 'muted-foreground',
        primary: 'primary',
        secondary: 'secondary',
        surface: 'surface',
        'surface-secondary': 'surface-secondary',
        text: 'text',
      },
    },
  )

  matchUtilities(
    {
      'ring-theme': (value: string, { modifier }): CssInJs => {
        const baseColor = `var(--theme-${value})`
        if (modifier) {
          const opacity = Number.parseFloat(modifier)
          if (!Number.isNaN(opacity)) {
            // Only generate CSS for valid opacity range
            if (opacity >= 0 && opacity <= 100) {
              return {
                '--tw-ring-color': `color-mix(in srgb, ${baseColor} ${opacity}%, transparent)`,
              }
            }
            // Skip CSS generation for numeric values outside valid range
            return {}
          }
          // For non-numeric modifiers, fall back to base color
          return { '--tw-ring-color': baseColor }
        }
        return { '--tw-ring-color': baseColor }
      },
    },
    {
      modifiers: 'any',
      values: {
        accent: 'accent',
        background: 'background',
        border: 'border',
        'border-secondary': 'border-secondary',
        muted: 'muted',
        'muted-foreground': 'muted-foreground',
        primary: 'primary',
        secondary: 'secondary',
        surface: 'surface',
        'surface-secondary': 'surface-secondary',
        text: 'text',
      },
    },
  )

  // Add gradient utilities with corrected mapping and validation
  const gradientValues = validateGradientValues(GRADIENT_VALUES)

  // The direction/color gradient combinations are served by the dynamic
  // matchUtilities('bg-gradient-theme') registration below; only the enhanced
  // three-stop gradient needs an explicit utility because the dynamic parser
  // cannot express it. addUtilities puts it in the utilities layer and
  // tree-shakes it when unused.
  addUtilities({
    '.bg-gradient-theme-enhanced-vertical': {
      backgroundImage: 'linear-gradient(to bottom, var(--theme-primary), var(--theme-secondary), var(--theme-accent))',
      // Add subtle radial overlay for enhanced depth
      position: 'relative',
    },
  })

  // Keep the original dynamic matching for flexibility but with CORRECTED direction mapping
  matchUtilities(
    {
      'bg-gradient-theme': (value: string) => {
        const parts = value.split('-')
        const direction = parts[0]

        // Map directional shortcuts to proper CSS direction values
        const directionMap: Record<string, string> = {
          bl: 'bottom left',
          bottom: 'bottom',
          br: 'bottom right',
          right: 'right',
          tl: 'top left',
          tr: 'top right',
        }

        if (direction === 'radial') {
          const colors = parts.slice(1)
          // Handle radial gradients
          return {
            backgroundImage: `radial-gradient(circle at center, ${colors
              .map((color) => `var(--theme-${color})`)
              .join(', ')})`,
          }
        }

        // Use the mapped direction or the original if not found
        const mappedDirection = directionMap[direction] || direction

        // Handle linear gradients
        return {
          backgroundImage: `linear-gradient(to ${mappedDirection}, ${parts
            .slice(1)
            .map((color) => `var(--theme-${color})`)
            .join(', ')})`,
        }
      },
    },
    {
      values: gradientValues,
    },
  )

  // Note: hover variants of the theme utilities (hover:bg-theme-*, etc.) are
  // generated automatically from the matchUtilities registrations above;
  // hand-written escaped selectors are unnecessary and landed in the wrong
  // cascade layer.
})

// Export the plugin with proper typing
export default tailwindPlugin as TailwindPlugin
