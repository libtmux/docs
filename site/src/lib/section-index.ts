/**
 * Where a section index puts its intro.
 *
 * A section index says what the section is and where its neighbours live, so
 * the intro comes first at the prose measure and the cards follow
 * (15-typesetting.md). A body with headings, tables or code is a page in its
 * own right: its cards stay above it, as the reader came for them.
 */
export function introBeforeCards(body: string | undefined, cards: number): boolean {
  return cards > 0 && Boolean(body?.trim()) && !/^(#{1,6} |```|\|)/m.test(body ?? '')
}

/** Peers a reader chooses between get cards; past this many a directory is scanned, and gets a compact list. */
export const DIRECTORY_CARDS = 6

export const directoryPattern = (items: number): 'cards' | 'list' | 'none' => (items === 0 ? 'none' : items <= DIRECTORY_CARDS ? 'cards' : 'list')
