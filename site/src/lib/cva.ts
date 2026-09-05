/**
 * Shared CVA (class-variance-authority) utilities and variant definitions
 *
 * This module provides:
 * - Re-exports of CVA core functions for consistent imports across the codebase
 * - Shared variant definitions for common component patterns (buttons, cards)
 * - Type-safe variant props using VariantProps
 *
 * @see https://cva.style/docs for CVA documentation
 */

import { cva, type VariantProps } from 'class-variance-authority'

// Re-export CVA utilities for convenient access
export { cva, type VariantProps }

/**
 * Shared button variants for navigation and control elements
 *
 * Usage:
 * ```astro
 * import { navButtonVariants } from '@/lib/cva'
 *
 * <button class={navButtonVariants({ variant: 'icon', size: 'md' })}>
 *   ...
 * </button>
 * ```
 */
export const navButtonVariants = cva(
  'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-primary/40 dark:focus-visible:ring-theme-primary/40',
  {
    variants: {
      variant: {
        // Icon-only button (mobile nav toggle, toc toggle)
        icon: 'flex items-center justify-center rounded-md bg-surface border-edge border shadow-[0_1px_2px_0_rgba(0,0,0,0.03)] dark:shadow-sm hover:bg-surface-hover',
        // Button with icon and label
        iconLabel:
          'flex items-center gap-2 rounded-md bg-surface border-edge border shadow-[0_1px_2px_0_rgba(0,0,0,0.03)] dark:shadow-sm hover:bg-surface-hover',
        // Theme color selector (round colored button)
        themeColor:
          'rounded-full hover:scale-110 shadow-sm bg-gradient-to-br focus-visible:ring-2 focus-visible:ring-theme-primary/40',
        // Scheme radio button (light/dark/system)
        schemeRadio:
          'inline-flex items-center justify-center rounded-sm cursor-pointer font-medium text-muted hover:bg-surface-hover',
      },
      size: {
        sm: '',
        md: '',
        lg: '',
      },
    },
    compoundVariants: [
      // Icon button sizes
      {
        variant: 'icon',
        size: 'sm',
        class: 'h-8 w-8 text-xs',
      },
      {
        variant: 'icon',
        size: 'md',
        class: 'h-10 w-10 text-sm',
      },
      {
        variant: 'icon',
        size: 'lg',
        class: 'h-12 w-12 text-base',
      },
      // Icon+Label button sizes
      {
        variant: 'iconLabel',
        size: 'sm',
        class: 'h-8 px-2 text-xs',
      },
      {
        variant: 'iconLabel',
        size: 'md',
        class: 'h-10 px-2.5 text-sm',
      },
      {
        variant: 'iconLabel',
        size: 'lg',
        class: 'h-12 px-3 text-base',
      },
      // Theme color button sizes
      {
        variant: 'themeColor',
        size: 'sm',
        class: 'h-4 w-4',
      },
      {
        variant: 'themeColor',
        size: 'md',
        class: 'h-5 w-5',
      },
      {
        variant: 'themeColor',
        size: 'lg',
        class: 'h-6 w-6',
      },
      // Scheme radio button sizes
      {
        variant: 'schemeRadio',
        size: 'sm',
        class: 'px-2 py-1 text-xs mx-0.5',
      },
      {
        variant: 'schemeRadio',
        size: 'md',
        class: 'px-3 py-1.5 text-sm mx-0.5',
      },
      {
        variant: 'schemeRadio',
        size: 'lg',
        class: 'px-4 py-2 text-base mx-0.5',
      },
    ],
    defaultVariants: {
      variant: 'icon',
      size: 'md',
    },
  },
)

/**
 * Shared card/container variants for card-style components
 *
 * Usage:
 * ```astro
 * import { cardVariants } from '@/lib/cva'
 *
 * <div class={cardVariants({ variant: 'default', interactive: true })}>
 *   ...
 * </div>
 * ```
 */
export const cardVariants = cva(
  'relative rounded-lg border border-edge bg-surface shadow-sm',
  {
    variants: {
      variant: {
        // Default card style (ProjectCard)
        default: 'p-6',
        // Compact card style (Badge)
        compact: 'p-4',
      },
      interactive: {
        true: '',
        false: '',
      },
      layout: {
        // Vertical layout (ProjectCard)
        vertical: 'flex flex-col items-center gap-3',
        // Horizontal layout (Badge)
        horizontal: 'flex items-start gap-3',
      },
    },
    compoundVariants: [
      {
        interactive: true,
        class:
          'cursor-pointer hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-theme-primary/40 focus:ring-offset-2',
      },
      {
        interactive: true,
        variant: 'default',
        class: 'hover:shadow-md',
      },
    ],
    defaultVariants: {
      variant: 'default',
      interactive: false,
      layout: 'vertical',
    },
  },
)
