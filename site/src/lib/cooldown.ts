/**
 * Dependency cooldowns, as the install pickers render them.
 *
 * A cooldown holds back releases younger than a number of days. Every tool
 * that supports one reads that number in its own unit — npm and Yarn in days,
 * pnpm in minutes, Bun in seconds, uv and pip as an ISO 8601 duration — so an
 * install command carries a placeholder naming the unit, and the reader's day
 * count is written into it in that unit, at build time for the default and in
 * the browser when the reader changes it.
 *
 * The reader's choice is one setting for the whole site: the MCP picker and
 * the package pickers read and write the same saved state, so turning a
 * cooldown on in one turns it on in every picker on every page.
 */
export const COOLDOWN_SLOTS = {
  days: '<COOLDOWN_DAYS>',
  minutes: '<COOLDOWN_MINUTES>',
  seconds: '<COOLDOWN_SECONDS>',
  duration: '<COOLDOWN_DURATION>',
} as const

export type CooldownUnit = keyof typeof COOLDOWN_SLOTS

/**
 * How each unit spells a day count: `scale` per day, written into `template`.
 * The slot elements carry these as attributes, so the widget scripts rewrite
 * any unit without a table of their own.
 */
export const COOLDOWN_FORMATS: Readonly<Record<CooldownUnit, { scale: number; template: string }>> = {
  days: { scale: 1, template: '{}' },
  minutes: { scale: 1440, template: '{}' },
  seconds: { scale: 86_400, template: '{}' },
  duration: { scale: 1, template: 'P{}D' },
}

/** The reader's day count, spelled in `unit`. */
export function formatCooldown(unit: CooldownUnit, days: number): string {
  const { scale, template } = COOLDOWN_FORMATS[unit]
  return template.replace('{}', String(days * scale))
}

export function hasCooldownSlot(code: string): boolean {
  return Object.values(COOLDOWN_SLOTS).some((token) => code.includes(token))
}

// A private-use character per unit. Shiki passes them through untouched and no
// command contains one, so after highlighting each still marks exactly where
// its slot goes, whichever token the highlighter put it in. See
// `highlightWithCooldownSlots` in highlight.ts.
export const COOLDOWN_MARKERS: Readonly<Record<CooldownUnit, string>> = {
  days: '\uE000',
  minutes: '\uE001',
  seconds: '\uE002',
  duration: '\uE003',
}
