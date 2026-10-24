import { SIDEBAR_PRESENTATIONS, sidebarCatalog, type SidebarPresentation } from './api-sidebar'
import type { ApiTreeJson } from './api-search'

export const DEMO_VIEWPORTS = { desktop: 1180, tablet: 820, phone: 390 } as const
export interface SidebarDemoConfig {
  variant: SidebarPresentation
  language: string
  symbol: string
  viewport: keyof typeof DEMO_VIEWPORTS
  theme: 'light' | 'dark'
  width: number
}

export function demoConfig(params: URLSearchParams, languages: readonly string[]): SidebarDemoConfig {
  const variant = params.get('variant') as SidebarPresentation
  const language = params.get('language') as SidebarDemoConfig['language']
  const viewport = params.get('viewport') as SidebarDemoConfig['viewport']
  const width = Number(params.get('width') ?? 296)
  return {
    variant: SIDEBAR_PRESENTATIONS.includes(variant) ? variant : 'outline',
    language: languages.includes(language) ? language : languages.includes('csharp') ? 'csharp' : languages[0] ?? 'csharp',
    symbol: params.get('symbol') ?? '',
    viewport: Object.hasOwn(DEMO_VIEWPORTS, viewport) ? viewport : 'desktop',
    theme: params.get('theme') === 'light' ? 'light' : 'dark',
    width: Number.isFinite(width) ? Math.max(248, Math.min(380, Math.round(width))) : 296,
  }
}

export function demoUrl(base: URL, config: SidebarDemoConfig): URL {
  const url = new URL(base)
  for (const [key, value] of Object.entries(config)) url.searchParams.set(key, String(value))
  return url
}

/** Examples stay tied to the current inventory, including genuinely empty types. */
export function sidebarExamples(json: ApiTreeJson) {
  const catalog = sidebarCatalog(json)
  const native = catalog.records.filter((record) => !json.hrefs?.[record.id])
  const preferred = { csharp: 'Server.Windows', kotlin: 'Session.Companion', tmux: 'capture-pane' }[json.port]
  const named = (preferred && catalog.records.find((record) => record.id.endsWith(preferred)))
    || native.find((record) => /(?:^|[.:])Server$/.test(record.id)) || native[0] || catalog.records[0]
  const repeated = catalog.records.find((record) => record.id !== named?.id && record.name === named?.name)
  const long = [...catalog.records].sort((a, b) => b.name.length - a.name.length)[0]
  const empty = catalog.owners.find((record) => !catalog.membersOf(record.id).length)
  return [
    named && { id: named.id, label: named.qualifiedName },
    repeated && { id: repeated.id, label: `Repeated name: ${repeated.qualifiedName}` },
    long && { id: long.id, label: `Long name: ${long.qualifiedName}` },
    empty && { id: empty.id, label: `No members: ${empty.qualifiedName}` },
  ].filter((record): record is { id: string; label: string } => Boolean(record))
}
