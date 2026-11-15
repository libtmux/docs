/** Escapes and glyphs the column components build their markup from. */

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]!)

const SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
export const ICON = {
  chevron: SVG.replace('<svg', '<svg class="miller__chev"') + '<path d="m6 3.5 4.5 4.5L6 12.5"/></svg>',
  back: `${SVG}<path d="m10 3.5-4.5 4.5 4.5 4.5"/></svg>`,
  close: `${SVG}<path d="M4 4l8 8M12 4l-8 8"/></svg>`,
  up: `${SVG}<path d="M8 13V3M3.5 7.5 8 3l4.5 4.5"/></svg>`,
  search: `${SVG}<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>`,
}
