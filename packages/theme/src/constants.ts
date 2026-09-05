/**
 * Theme color constants
 * Central source of truth for all theme definitions
 */

/**
 * Theme definitions - each theme uses OKLCH color space for better perceptual uniformity
 */
export const THEME_DEFINITIONS = {
  amber: {
    accent: 'oklch(0.85 0.15 75)',
    background: 'oklch(0.97 0.03 75)',
    primary: 'oklch(0.7 0.2 75)',
    secondary: 'oklch(0.75 0.18 75)',
    text: 'oklch(0.35 0.15 75)',
  },
  emerald: {
    accent: 'oklch(0.8 0.15 160)',
    background: 'oklch(0.97 0.03 160)',
    primary: 'oklch(0.65 0.2 160)',
    secondary: 'oklch(0.7 0.18 160)',
    text: 'oklch(0.3 0.15 160)',
  },
  purple: {
    accent: 'oklch(0.75 0.15 280)',
    background: 'oklch(0.97 0.03 280)',
    primary: 'oklch(0.6 0.22 280)',
    secondary: 'oklch(0.65 0.2 280)',
    text: 'oklch(0.25 0.18 280)',
  },
  sky: {
    accent: 'oklch(0.8 0.15 230)',
    background: 'oklch(0.97 0.03 230)',
    primary: 'oklch(0.65 0.2 230)',
    secondary: 'oklch(0.7 0.18 230)',
    text: 'oklch(0.3 0.15 230)',
  },
} as const

/**
 * Dark color scheme adjustments
 * These override specific colors when the dark color scheme is active
 * Only includes colors that need adjustment for dark mode
 */
export const DARK_MODE_ADJUSTMENTS = {
  amber: {
    accent: 'oklch(0.85 0.15 75)',
    primary: 'oklch(0.7 0.2 75)',
    secondary: 'oklch(0.75 0.18 75)',
  },
  emerald: {
    accent: 'oklch(0.85 0.1 160)',
    primary: 'oklch(0.65 0.2 160)',
    secondary: 'oklch(0.7 0.18 160)',
  },
  purple: {
    accent: 'oklch(0.8 0.12 280)',
    primary: 'oklch(0.6 0.22 280)',
    secondary: 'oklch(0.65 0.2 280)',
  },
  sky: {
    accent: 'oklch(0.8 0.15 230)',
    primary: 'oklch(0.65 0.2 230)',
    secondary: 'oklch(0.7 0.18 230)',
  },
} as const

/**
 * Gradient value mappings
 */
export const GRADIENT_VALUES = {
  'bottom-primary-secondary': 'bottom-primary-secondary',
  'br-primary-secondary': 'br-primary-secondary',
  'radial-accent-primary': 'radial-accent-primary',
  'right-primary-accent': 'right-primary-accent',
  'right-primary-secondary': 'right-primary-secondary',
  'right-secondary-accent': 'right-secondary-accent',
  'tr-primary-secondary': 'tr-primary-secondary',
} as const

// Export theme names and color keys for iteration
export const THEME_NAMES = Object.keys(THEME_DEFINITIONS) as Array<keyof typeof THEME_DEFINITIONS>
export const COLOR_KEYS = ['primary', 'secondary', 'accent', 'background', 'text'] as const

// Type exports
export type ColorKey = (typeof COLOR_KEYS)[number]
