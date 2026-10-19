/** A row's identity follows its section and label, independent of its position. */
export function rowAnchor(section: string, item: string): string {
  const slug = (text: string) => text.normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-').replace(/^-|-$/g, '')
  return `${slug(section) || 'overview'}-${slug(item) || 'entry'}`
}

/**
 * Assigns table-row anchors from the headings above each row, in document
 * order. The rendered page and the scripts that index its rows share it, so
 * both name a row the same way.
 */
export function createRowAnchors(taken: Iterable<string> = []) {
  const used = new Set(taken)
  const sections: string[] = []
  let section = 'overview'
  return {
    /** Enter a heading at `depth`; `id` is its anchor, or its text without one. */
    heading(depth: number, id: string): void {
      sections.length = depth
      sections[depth - 1] = id
      section = sections.filter(Boolean).reduce((path, part) =>
        !path || part.startsWith(`${path}-`) ? part : `${path}-${part}`, '')
    },
    /** The anchor of the next row: an explicit id is kept, any other avoids every id taken. */
    row(label: string, explicit?: string): string {
      const stem = rowAnchor(section, label)
      let id = explicit || stem
      if (!explicit) {
        let suffix = 2
        while (used.has(id)) id = `${stem}-${suffix++}`
      }
      used.add(id)
      return id
    },
  }
}
