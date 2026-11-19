/**
 * Result order for a query that names a member and its owner.
 *
 * Pagefind scores pages by the words they contain, so a type whose name holds
 * the whole query (`CapturePaneRequest` for "capture pane") and every
 * attribute under it outscore the one method a reader meant, `Pane.Capture`.
 * The panel reads the owner and the title from each result's metadata and
 * moves an exact `owner.member` match to the front.
 */

/** The fields of a result this order reads. */
export interface RankableResult {
  data: () => Promise<{ meta: Record<string, string | undefined> }>
}

/**
 * How many results, from the top of Pagefind's order, are read to find an exact
 * member. Each costs one fragment fetch, so the window is a few pages of
 * results, not the whole list.
 */
export const RANK_WINDOW = 48

/** The lowercase words of a name or a query, split at punctuation and at case changes: `CapturePaneRequest` is capture, pane, request. */
export function nameWords(text: string): string[] {
  return text
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

/** A page title with its owner's `Owner.` prefix removed, so `Pane.Capture` under owner `Pane` is `Capture`. */
export const leafOf = (title: string, owner: string) => (title.startsWith(`${owner}.`) ? title.slice(owner.length + 1) : title)

/**
 * Whether a member's owner and name together are exactly the words of the
 * query: "capture pane", "pane capture" and `Pane.Capture` all name
 * `Pane.Capture`, and none of them names a member of `CapturePaneRequest`,
 * whose owner brings a third word.
 */
export function namesMember(query: readonly string[], owner: string, leaf: string): boolean {
  const named = new Set([...nameWords(owner), ...nameWords(leaf)])
  return nameWords(leaf).length > 0 && named.size === new Set(query).size && query.every((word) => named.has(word))
}

/**
 * `results` with exact `owner.member` matches first, each group in the order
 * Pagefind gave. Only the first `window` results are read; the rest follow
 * unchanged. A query of one word names no owner and keeps Pagefind's order
 * without fetching anything.
 */
export async function boostExactMembers<T extends RankableResult>(query: string, results: T[], window = RANK_WINDOW): Promise<T[]> {
  const words = nameWords(query)
  if (words.length < 2) return results
  const head = results.slice(0, window).map((result) => {
    // One fetch per result: the panel reads the same data again to paint it.
    let data: ReturnType<T['data']> | undefined
    return { ...result, data: () => (data ??= result.data() as ReturnType<T['data']>) }
  })
  const reads = await Promise.all(head.map((result) => result.data().catch(() => undefined)))
  const exact: T[] = []
  const rest: T[] = []
  head.forEach((result, i) => {
    const meta = reads[i]?.meta
    const owner = meta?.owner
    const title = meta?.title
    ;(owner && title && namesMember(words, owner, leafOf(title, owner)) ? exact : rest).push(result)
  })
  return [...exact, ...rest, ...results.slice(window)]
}
