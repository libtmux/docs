import { arrange, type TmuxLayout } from './tmux-layout'

/**
 * A window's panes as a small tile for a menu row.
 *
 * The same geometry as the full drawing (`arrange`), without text: pane
 * outlines only, in the colour of the text they sit beside, so the tile
 * follows the menu's own ink in both colour schemes. A preset with more than
 * one window gets the edge of a second tile behind the first.
 */

/** The icon's coordinate space, which is also its size in CSS pixels at 1x. */
const WIDTH = 32
const HEIGHT = 24
/** Space the stacked-window hint takes from the front tile. */
const STACK = 4
/** Keep strokes off the viewBox edge. */
const INSET = 1

const n = (value: number) => String(Number(value.toFixed(2)))

/**
 * Draw `layout` with `panes` panes as an `<svg>`.
 *
 * @param stacked Whether the preset has further windows behind this one.
 */
export function layoutIcon(layout: TmuxLayout, panes: number, stacked = false): string {
  const width = WIDTH - 2 * INSET - (stacked ? STACK : 0)
  const height = HEIGHT - 2 * INSET - (stacked ? STACK : 0)
  const left = INSET
  const top = INSET + (stacked ? STACK : 0)
  const segments = new Set<string>()
  for (const rect of arrange(layout, Math.max(1, panes), width, height)) {
    const right = rect.x + rect.w
    const bottom = rect.y + rect.h
    if (right < width - 1e-6) segments.add(`M${n(left + right)} ${n(top + rect.y)}V${n(top + bottom)}`)
    if (bottom < height - 1e-6) segments.add(`M${n(left + rect.x)} ${n(top + bottom)}H${n(left + right)}`)
  }
  const parts = [`<svg class="ws-tile" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">`]
  // The edge of the window behind, which shows above and to the right of the front one.
  if (stacked) parts.push(`<path class="ws-tile__back" d="M${n(left + STACK)} ${n(top)}V${INSET}H${WIDTH - INSET}V${n(INSET + height)}H${n(left + width)}"/>`)
  parts.push(`<rect class="ws-tile__window" x="${n(left)}" y="${n(top)}" width="${n(width)}" height="${n(height)}" rx="2"/>`)
  if (segments.size) parts.push(`<path class="ws-tile__divider" d="${[...segments].join('')}"/>`)
  parts.push('</svg>')
  return parts.join('')
}
