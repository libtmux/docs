/**
 * The design system's breakpoints (`bp-phone`, `bp-tablet`, `bp-nav`, `bp-outline`).
 *
 * A custom property cannot name a media query, so stylesheets write these
 * widths out and scripts read them here; `test/breakpoints.test.ts` fails when
 * a script's query drifts from its token.
 */
export const BP = {
  /** Below it the context strip folds its settings into one trigger. */
  phone: 30,
  /** The header's destinations move out of the Menu and into the bar. */
  tablet: 48,
  /** The sidebar or API tree becomes a column. Below it the release notice keeps to one line, with its sentence behind "More". */
  nav: 64,
  /** The outline column appears. */
  outline: 80,
  /** The root size starts to grow with the display (record 0071). */
  large: 120,
} as const

export type Breakpoint = keyof typeof BP

/** A `min-width` query for "this wide or wider", in rem. */
export const atLeast = (name: Breakpoint) => `(min-width: ${BP[name]}rem)`

/**
 * A `max-width` query for "narrower than", in rem. A thousandth of a rem
 * below the breakpoint, so no width answers both this and `atLeast`.
 */
export const below = (name: Breakpoint) => `(max-width: ${BP[name] - 0.001}rem)`

/** `bp-short`: under this height, in rem, a landscape screen is short (record 0071). */
export const SHORT = 30

/** Panels open as a bottom sheet on phones in portrait and as a side sheet on short landscape screens (record 0071). */
export const PANEL_QUERIES = {
  sheet: `${below('phone')}, ${below('tablet')} and (orientation: portrait)`,
  side: `(max-height: ${SHORT - 0.001}rem) and (orientation: landscape)`,
} as const

export type PanelMode = 'popover' | 'sheet' | 'side'

/** How a panel opens on this display: a side sheet on a short landscape screen, a bottom sheet on a phone, a popover elsewhere (record 0071). */
export function panelMode(): PanelMode {
  const matches = (query: string) => typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  return matches(PANEL_QUERIES.side) ? 'side' : matches(PANEL_QUERIES.sheet) ? 'sheet' : 'popover'
}
