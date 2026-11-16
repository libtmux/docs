/**
 * The design system's breakpoints (`bp-phone`, `bp-tablet`, `bp-nav`, `bp-outline`).
 *
 * A custom property cannot name a media query, so stylesheets write these
 * widths out and scripts read them here; `test/breakpoints.test.ts` fails when
 * a script's query drifts from its token.
 */
export const BP = {
  /** Below it the context strip folds its settings into one trigger and the release notice keeps to one line. */
  phone: 30,
  /** The header's destinations move out of the Menu and into the bar. */
  tablet: 48,
  /** The sidebar or API tree becomes a column. */
  nav: 64,
  /** The outline column appears. */
  outline: 80,
} as const

export type Breakpoint = keyof typeof BP

/** A `min-width` query for "this wide or wider", in rem. */
export const atLeast = (name: Breakpoint) => `(min-width: ${BP[name]}rem)`

/**
 * A `max-width` query for "narrower than", in rem. A thousandth of a rem
 * below the breakpoint, so no width answers both this and `atLeast`.
 */
export const below = (name: Breakpoint) => `(max-width: ${BP[name] - 0.001}rem)`
