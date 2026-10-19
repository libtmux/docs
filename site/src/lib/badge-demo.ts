/**
 * Palette and kind data for the badge demo pages.
 *
 * The in-context page builds every treatment on one global palette: six hue
 * families, tuned per mode. The functions here only produce data and CSS text;
 * nothing in the site's own badge styles reads them.
 */
import { kindMark, markClass, markHeight } from './api-labels'

export type Scheme = 'light' | 'dark'
export const SCHEMES: Scheme[] = ['light', 'dark']

// Tailwind steps 100 to 950, for the hues the families use.
const SCALE: Record<string, string[]> = {
  blue: ['#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a', '#172554'],
  violet: ['#ede9fe', '#ddd6fe', '#c4b5fd', '#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9', '#5b21b6', '#4c1d95', '#2e1065'],
  amber: ['#fef3c7', '#fde68a', '#fcd34d', '#fbbf24', '#f59e0b', '#d97706', '#b45309', '#92400e', '#78350f', '#451a03'],
  green: ['#dcfce7', '#bbf7d0', '#86efac', '#4ade80', '#22c55e', '#16a34a', '#15803d', '#166534', '#14532d', '#052e16'],
  rose: ['#ffe4e6', '#fecdd3', '#fda4af', '#fb7185', '#f43f5e', '#e11d48', '#be123c', '#9f1239', '#881337', '#4c0519'],
  cyan: ['#cffafe', '#a5f3fc', '#67e8f9', '#22d3ee', '#06b6d4', '#0891b2', '#0e7490', '#155e75', '#164e63', '#083344'],
  orange: ['#ffedd5', '#fed7aa', '#fdba74', '#fb923c', '#f97316', '#ea580c', '#c2410c', '#9a3412', '#7c2d12', '#431407'],
  slate: ['#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#475569', '#334155', '#1e293b', '#0f172a', '#020617'],
}
export const hx = (hue: string, step: number): string => SCALE[hue]![step === 950 ? 9 : step / 100 - 1]!

const rgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const lin = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4)
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex)
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!)
}
export const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

/**
 * Colour says the category, the glyph says the kind. Families differ in
 * lightness as well as hue: types and tools sit a step heavier.
 */
export const FAMS: Record<string, { hue: string; light: [number, number]; dark: [number, number] }> = {
  types: { hue: 'blue', light: [200, 900], dark: [800, 100] },
  traits: { hue: 'violet', light: [100, 700], dark: [900, 300] },
  callables: { hue: 'amber', light: [200, 900], dark: [900, 200] },
  members: { hue: 'green', light: [100, 800], dark: [900, 200] },
  meta: { hue: 'rose', light: [100, 700], dark: [900, 300] },
  tools: { hue: 'cyan', light: [200, 900], dark: [800, 100] },
}

/** The active state fills with the 600 step; a family whose white text is under 4.5:1 takes a ring instead. */
export const famSolid = (fam: string) => hx(FAMS[fam]!.hue, 600)
export const RING_FAMS = new Set(Object.keys(FAMS).filter((f) => ratio('#ffffff', famSolid(f)) < 4.5))

/** Family variables per scheme, scoped to the demo panes. */
export const familyCss = SCHEMES.map((scheme) =>
  Object.entries(FAMS)
    .map(([fam, f]) => {
      const [bg, fg] = f[scheme]
      const h = f.hue
      return `.ic-pane[data-pane='${scheme}'] [data-fam='${fam}']{--fb:${hx(h, bg)};--ff:${hx(h, fg)};--fh:${hx(h, 500)};--fs:${hx(h, 600)};--fm:${hx(h, 400)};--f9:${hx(h, 950)};--f8:${hx(h, scheme === 'light' ? 800 : 200)}}`
    })
    .join(''),
).join('')

/** Pills for status: a neutral and a warning hue, per scheme. */
export const pillCss = SCHEMES.map((scheme) => {
  const light = scheme === 'light'
  return `.ic-pane[data-pane='${scheme}']{--pn-bg:${hx('slate', light ? 100 : 800)};--pn-fg:${hx('slate', light ? 700 : 200)};--pw-bg:${hx('orange', light ? 100 : 900)};--pw-fg:${hx('orange', light ? 800 : 200)}}`
}).join('')

export interface Kind {
  kind: string
  word: string
  mark: string
  x: boolean
  cls: string
  fam: string
  shape: string
  geo: string
}

// kind, word, family, silhouette family
const DEFS: [string, string, string, string][] = [
  ['class', 'class', 'types', 'types'],
  ['interface', 'interface', 'traits', 'types'],
  ['struct', 'struct', 'types', 'types'],
  ['union', 'union', 'types', 'types'],
  ['enum', 'enum', 'types', 'types'],
  ['trait', 'trait', 'traits', 'types'],
  ['module', 'module', 'types', 'types'],
  ['typealias', 'type alias', 'types', 'types'],
  ['prompt', 'prompt', 'meta', 'types'],
  ['resource-template', 'template', 'meta', 'types'],
  ['exception', 'exception', 'meta', 'types'],
  ['format', 'format', 'meta', 'data'],
  ['command', 'command', 'callables', 'calls'],
  ['key', 'key', 'members', 'data'],
  ['function', 'function', 'callables', 'calls'],
  ['method', 'method', 'callables', 'calls'],
  ['property', 'property', 'members', 'data'],
  ['attribute', 'attribute', 'members', 'data'],
  ['constant', 'constant', 'members', 'data'],
  ['tool', 'tool', 'tools', 'calls'],
  ['resource', 'resource', 'tools', 'data'],
  ['option', 'option', 'members', 'data'],
  ['hook', 'hook', 'tools', 'calls'],
]
const shapeOf = (mark: string) => (/^[A-Z#:]$/.test(mark) ? 'sq' : /^[$!]$/.test(mark) ? 'di' : 'ci')

export const KINDS: Kind[] = DEFS.map(([kind, word, fam, geo]) => {
  const mark = kindMark(kind)!
  return { kind, word, mark, x: markHeight(mark) === 'x', cls: markClass(mark), fam, shape: shapeOf(mark), geo }
})
export const kindOf = (kind: string) => KINDS.find((k) => k.kind === kind)!

/** The lowest glyph-on-fill ratio among the families in a scheme, with the family that sets it. */
export function famWorst(scheme: Scheme): string {
  let low = { r: Infinity, f: '' }
  for (const [f, v] of Object.entries(FAMS)) {
    const [bg, fg] = v[scheme]
    const r = ratio(hx(v.hue, fg), hx(v.hue, bg))
    if (r < low.r) low = { r, f }
  }
  return `${low.r.toFixed(2)}:1 ${low.f}`
}
