/**
 * Zod schemas for validating the Tailwind plugin's themes and colors
 *
 * This module provides runtime validation of colors and other configuration
 * values using Zod.
 */

import { z } from 'zod'

/**
 * Helper function to create a ranged number schema with descriptive error messages
 */
export function createRangedNumberSchema(min: number, max: number, name: string, colorSpace?: string, units?: string) {
  const description = colorSpace
    ? `${name} component [${min}-${max}] (${colorSpace}${units ? ` ${units}` : ''})`
    : `${name} [${min}-${max}]${units ? ` ${units}` : ''}`

  return z
    .number()
    .min(min, `${name} must be at least ${min}${units ? ` ${units}` : ''}`)
    .max(max, `${name} must be at most ${max}${units ? ` ${units}` : ''}`)
    .describe(description)
}

/**
 * Alpha transparency schema
 */
export const alphaSchema = createRangedNumberSchema(0, 1, 'Alpha').default(1).describe('Alpha channel [0-1]')

/**
 * OKLCH color components schema
 */
export const lightnessSchema = createRangedNumberSchema(0, 1, 'Lightness', 'OKLCH')
export const chromaSchema = createRangedNumberSchema(0, 0.4, 'Chroma', 'OKLCH')
export const hueSchema = createRangedNumberSchema(0, 360, 'Hue', undefined, 'degrees')
  .optional()
  .describe('Hue [0-360 degrees] (undefined for achromatic colors)')

/**
 * Complete OKLCH color schema
 */
export const oklchSchema = z
  .object({
    alpha: alphaSchema.default(1),
    c: chromaSchema,
    format: z.literal('oklch'),
    h: hueSchema,
    l: lightnessSchema,
    preserved: z
      .object({
        hue: z.number().optional().describe('Remembered hue for achromatic colors'),
      })
      .optional(),
  })
  .refine((data) => data.h !== undefined || data.c === 0, 'Hue must be defined when chroma is not zero')
  .describe('OKLCH color components')

/**
 * Schema for OKLCH color strings
 */
export const oklchStringSchema = z
  .string()
  .regex(
    /^oklch\(\s*([0-9]*\.?[0-9]+)\s+([0-9]*\.?[0-9]+)\s+([0-9]*\.?[0-9]+)(\s+\/\s+([0-9]*\.?[0-9]+))?\s*\)$/,
    'Invalid OKLCH color format. Expected format: oklch(L C H / alpha)',
  )
  .describe('OKLCH color string')

/**
 * Schema for semantic color names in themes
 */
export const themeColorNameSchema = z
  .enum(['primary', 'secondary', 'accent', 'background', 'text'])
  .describe('Theme color name')

/**
 * Schema for theme colors
 */
export const themeColorsSchema = z
  .object({
    accent: oklchStringSchema,
    background: oklchStringSchema,
    primary: oklchStringSchema,
    secondary: oklchStringSchema,
    text: oklchStringSchema,
  })
  .describe('Theme colors configuration')

/**
 * Schema for dark mode color adjustments
 */
export const darkModeColorsSchema = z
  .object({
    accent: oklchStringSchema.optional(),
    primary: oklchStringSchema.optional(),
    secondary: oklchStringSchema.optional(),
  })
  .describe('Dark mode color adjustments')

/**
 * Schema for theme names
 */
export const themeNameSchema = z.enum(['emerald', 'amber', 'sky', 'purple']).describe('Theme name')

/**
 * Schema for color scheme names
 */
export const colorSchemeSchema = z.enum(['light', 'dark', 'system']).describe('Color scheme')

/**
 * Schema for gradient directions
 */
export const gradientDirectionSchema = z
  .enum(['right', 'bottom', 'br', 'tr', 'bl', 'tl', 'radial'])
  .describe('Gradient direction')

/**
 * Schema for gradient keys format
 */
export const gradientKeySchema = z
  .string()
  .regex(
    /^(right|bottom|br|tr|bl|tl|radial)-(primary|secondary|accent|background|text)-(primary|secondary|accent|background|text)$/,
    'Invalid gradient key format. Should be {direction}-{colorName1}-{colorName2}',
  )
  .describe('Gradient key format')

/**
 * Schema for complete themes configuration
 */
export const themesSchema = z
  .object({
    amber: themeColorsSchema,
    emerald: themeColorsSchema,
    purple: themeColorsSchema,
    sky: themeColorsSchema,
  })
  .catchall(themeColorsSchema) // Allow any additional theme names with valid colors
  .describe('Themes configuration')

/**
 * Schema for dark mode adjustments configuration
 */
export const darkModeAdjustmentsSchema = z
  .record(z.string(), darkModeColorsSchema) // Allow any theme name, not just enum values
  .describe('Dark mode adjustments configuration')

/**
 * Parses and validates a theme colors configuration
 */
export function validateThemeColors(input: unknown): z.infer<typeof themeColorsSchema> {
  return themeColorsSchema.parse(input)
}

/**
 * Parses and validates a complete themes configuration
 */
export function validateThemes(input: unknown): z.infer<typeof themesSchema> {
  return themesSchema.parse(input)
}

/**
 * Parses and validates dark mode adjustments
 */
export function validateDarkModeAdjustments(input: unknown): z.infer<typeof darkModeAdjustmentsSchema> {
  return darkModeAdjustmentsSchema.parse(input)
}

/**
 * Parses and validates OKLCH color string
 *
 * @param input The color string to validate
 * @returns The validated color string
 * @throws {ZodError} If the color string is invalid
 */
export function validateOklchString(input: unknown): string {
  return oklchStringSchema.parse(input)
}

/**
 * Helper function to extract OKLCH components from a valid OKLCH string
 */
export function parseOklchString(input: string): z.infer<typeof oklchSchema> {
  const valid = validateOklchString(input)

  // Extract values using regex
  const match = valid.match(
    /^oklch\(\s*([0-9]*\.?[0-9]+)\s+([0-9]*\.?[0-9]+)\s+([0-9]*\.?[0-9]+)(\s+\/\s+([0-9]*\.?[0-9]+))?\s*\)$/,
  )

  if (!match) {
    throw new Error(`Failed to parse OKLCH string: ${input}`)
  }

  const [, l, c, h, , alpha] = match

  return {
    alpha: alpha ? Number(alpha) : 1,
    c: Number(c),
    format: 'oklch',
    h: Number(h),
    l: Number(l),
  }
}

/**
 * Validates the gradient configuration
 */
export function validateGradientValues(input: unknown): Record<string, string> {
  return z.record(gradientKeySchema, z.string()).parse(input)
}

/**
 * Type exports for TypeScript compatibility
 */
export type OklchColor = z.infer<typeof oklchSchema>
export type ThemeColors = z.infer<typeof themeColorsSchema>
export type DarkModeColors = z.infer<typeof darkModeColorsSchema>
export type Themes = z.infer<typeof themesSchema>
export type ThemeName = z.infer<typeof themeNameSchema>
export type ColorScheme = z.infer<typeof colorSchemeSchema>
export type GradientDirection = z.infer<typeof gradientDirectionSchema>
export type GradientKey = z.infer<typeof gradientKeySchema>
