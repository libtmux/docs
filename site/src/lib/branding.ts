/** Shared artwork and metadata for Astro and native documentation. */
import palettes from './brand-palettes.json' with { type: 'json' }
import { pageBrand, PORTS } from './ports.ts'

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
  const port = PORTS.find((candidate) => candidate.logoLanguage === language)
  const projectName = port?.projectName ?? 'libtmux'
  const label = `${projectName} · ${palette.name}${variant === 'library' ? '' : variant === 'mcp' ? ' MCP' : ' workspace CLI'}`
  return { language, variant, palette, port, projectName, label, asset: (filename: string) => `${base}/${filename}` }
}

/** Keep one project suffix, including when normalizing an older native page. */
export function documentationTitle(title: string, projectName: string): string {
  const page = title.replace(/ \| libtmux(?:-[a-z]+)?$/, '')
    .replace(/ [-–—] libtmux(?:-[a-z]+)?(?: v?\d[\w.+-]*)? documentation$/, '')
  return page === projectName ? page : `${page} | ${projectName}`
}

/** JSON-LD is data inside an HTML script element; never allow a closing tag. */
export function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}
