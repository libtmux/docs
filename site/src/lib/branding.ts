/** Shared artwork and metadata for Astro and native documentation. */
import palettes from './brand-palettes.json' with { type: 'json' }
import { pageBrand } from './ports.ts'

export { palettes }
export const PYTHON_DESCRIPTION = 'Typed scripting library / ORM / API wrapper for tmux'
export const PYTHON_SAME_AS = [
  'https://libtmux.git-pull.com/',
  'https://github.com/tmux-python/libtmux',
  'https://pypi.org/project/libtmux/',
]

export function branding(portSlug?: string, pagePath = '', root = '') {
  const { language, variant } = pageBrand(portSlug, pagePath)
  const palette = palettes[language as keyof typeof palettes]
  if (!palette) throw new Error(`Missing logo palette: ${language}`)
  const base = `${root.replace(/\/+$/, '')}/brand/${language}/${variant}`
  const label = `libtmux for ${palette.name}${variant === 'library' ? '' : variant === 'mcp' ? ' MCP' : ' workspace CLI'}`
  return { language, variant, palette, label, asset: (filename: string) => `${base}/${filename}` }
}

/** JSON-LD is data inside an HTML script element; never allow a closing tag. */
export function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}
