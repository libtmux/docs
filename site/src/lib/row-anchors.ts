/** A row's identity follows its section and label, independent of its position. */
export function rowAnchor(section: string, item: string): string {
  const slug = (text: string) => text.normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-').replace(/^-|-$/g, '')
  return `${slug(section) || 'overview'}-${slug(item) || 'entry'}`
}
