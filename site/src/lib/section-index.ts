/**
 * Where a section index puts its intro.
 *
 * A section index says what the section is and where its neighbours live, so
 * the lead comes first at the prose measure and the cards follow
 * (15-typesetting.md). The lead is what stands above the first heading; the
 * headed sections come after the cards. A body that opens on a heading, a
 * table or code has no lead, or is a page in its own right: its cards stay
 * above it, as the reader came for them.
 */
export function introBeforeCards(body: string | undefined, cards: number): boolean {
  const lead = (body ?? '').split(/^#{1,6} /m)[0]!
  return cards > 0 && Boolean(lead.trim()) && !/^(```|\|)/m.test(lead)
}

/**
 * A rendered body split at its first heading: the lead before it and the
 * sections from it. An anchor written just above the heading names that
 * heading, so it stays with it.
 */
export function splitAtFirstHeading(html: string): { lead: string; rest: string } {
  const heading = html.search(/<h[1-6]\b/)
  if (heading === -1) return { lead: html, rest: '' }
  const above = html.slice(0, heading)
  const anchors = /(?:\s*<a\b[^>]*><\/a>)+\s*$/.exec(above)
  const at = anchors ? anchors.index : heading
  return { lead: html.slice(0, at), rest: html.slice(at) }
}

/** Peers a reader chooses between get cards; past this many a directory is scanned, and gets a compact list. */
export const DIRECTORY_CARDS = 6

export const directoryPattern = (items: number): 'cards' | 'list' | 'none' => (items === 0 ? 'none' : items <= DIRECTORY_CARDS ? 'cards' : 'list')
