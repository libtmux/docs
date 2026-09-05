/**
 * @tony/sh-tailwind-plugin
 *
 * A comprehensive Tailwind CSS v4 plugin that creates the site theme system.
 * Includes Zod validation for runtime type checking.
 */

import tailwindPlugin from './tailwind-plugin'

// Export constants
export * from './constants'
// Export schema validation utilities
export * from './schema'
// Export additional types and utilities
export * from './tailwind-plugin'
// Export everything as named exports to avoid default export issues
export { tailwindPlugin }

// Default export for Tailwind CSS plugin system
export default tailwindPlugin
