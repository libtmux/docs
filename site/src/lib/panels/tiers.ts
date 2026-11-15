/**
 * Width tiers of the panel workspace.
 *
 * A tier comes from how many 320 px columns fit, never from the device. A
 * 24 px dead band at each boundary stops a window dragged along it from
 * flipping between two tiers.
 */

export interface Tier { t: 0 | 1 | 2 | 3 | 4 | 5; name: string; min: number; cap: number }

export const TIERS: readonly Tier[] = [
  { t: 0, name: 'T0 Narrow', min: 0, cap: 1 },
  { t: 1, name: 'T1 Compact', min: 480, cap: 1 },
  { t: 2, name: 'T2 Medium', min: 768, cap: 2 },
  { t: 3, name: 'T3 Expanded', min: 1024, cap: 3 },
  { t: 4, name: 'T4 Large', min: 1440, cap: 4 },
  { t: 5, name: 'T5 Ultra', min: 2100, cap: 6 },
]

export const BAND = 24
/** No panel renders below this width; the layout folds a panel instead. */
export const MIN_COL = 320
/** The workspace centres at this width on an ultra-wide stage unless Full width is on. */
export const MAX_WORK = 2400
/** A stage under this height and under 1024 px wide reads one panel at a time. */
export const SHORT_HEIGHT = 500

/** The tier for a width; `prev` applies the dead band around each boundary. */
export function tierOf(width: number, prev?: Tier | null): Tier {
  const tier = [...TIERS].reverse().find((entry) => width >= entry.min) ?? TIERS[0]!
  if (prev && Math.abs(tier.t - prev.t) === 1) {
    if (tier.t > prev.t && width < tier.min + BAND / 2) return prev
    if (tier.t < prev.t && width >= prev.min - BAND / 2) return prev
  }
  return tier
}

/** A phone on its side renders as T1 whatever its width: two columns would each be a strip. */
export function effectiveTier(width: number, height: number, prev?: Tier | null): Tier {
  const tier = tierOf(width, prev)
  return height < SHORT_HEIGHT && tier.t > 1 && width < 1024 ? TIERS[1]! : tier
}

/** Nesting depth of the layout tree each tier draws; narrow tiers draw none. */
export const NESTING: Readonly<Record<number, number>> = { 2: 1, 3: 2, 4: 3, 5: 3 }

/** The icon rail's width: always icons at T2, a 240 px sidebar when pinned at T3 and up. */
export const railWidth = (tier: Tier, pinned: boolean): number => (tier.t === 2 ? 48 : pinned ? 240 : 48)

/** How many 320 px columns fit in the work area beside the rail, up to the tier's cap. */
export const columnCap = (tier: Tier, workWidth: number, rail: number): number =>
  Math.max(1, Math.min(tier.cap, Math.floor((workWidth - rail) / MIN_COL)))
