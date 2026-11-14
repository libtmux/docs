/**
 * What one column shows of its level: the rows that match the filter, the
 * page of them, and the rows a virtual list keeps in the document.
 *
 * Group headings (member tiers, tool groups) repeat at the top of a page
 * whose first row belongs to a group that began on an earlier page.
 */
import { ROW_HEIGHT, type ColumnNode } from './types'

export type Row<T extends ListItem = ColumnNode> =
  | { group: string; node?: undefined; pos?: undefined }
  | { node: T; pos: number; group?: undefined }

export interface ListItem { label: string; group?: string }

/** The filtered items, in order, each with its position among the matches. */
export function matching<T extends ListItem>(items: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  return q ? items.filter((item) => item.label.toLowerCase().includes(q)) : [...items]
}

/** Items with a heading row wherever the group changes. */
export function withHeadings<T extends ListItem>(items: readonly T[]): Row<T>[] {
  const rows: Row<T>[] = []
  let group = ''
  items.forEach((node, pos) => {
    if (node.group && node.group !== group) { rows.push({ group: node.group }); group = node.group }
    rows.push({ node, pos })
  })
  return rows
}

export function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / size))
}

/** The page that holds the item at `index`. */
export function pageOf(index: number, size: number): number {
  return index < 0 ? 0 : Math.floor(index / size)
}

export function clampPage(page: number, total: number, size: number): number {
  return Math.max(0, Math.min(pageCount(total, size) - 1, page))
}

/** One page of the matches, headed by its first row's group even when the group began earlier. */
export function pageRows<T extends ListItem>(items: readonly T[], page: number, size: number): Row<T>[] {
  const start = clampPage(page, items.length, size) * size
  const rows: Row<T>[] = []
  let group = ''
  items.slice(start, start + size).forEach((node, i) => {
    if (node.group && node.group !== group) { rows.push({ group: node.group }); group = node.group }
    rows.push({ node, pos: start + i })
  })
  return rows
}

/** `‹ 1–50 of 175 ›`: the span of matches the page shows. */
export function pageSpan(total: number, page: number, size: number): { from: number; to: number; total: number } {
  const at = clampPage(page, total, size)
  return { from: total ? at * size + 1 : 0, to: Math.min(total, (at + 1) * size), total }
}

/** The rows a virtual list renders, and the spacer heights that keep the scroll height whole. */
export function virtualWindow(rowCount: number, scrollTop: number, height: number, rowHeight = ROW_HEIGHT, overscan = 6) {
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(rowCount, Math.ceil((scrollTop + height) / rowHeight) + overscan)
  return { start, end, before: start * rowHeight, after: Math.max(0, rowCount - end) * rowHeight }
}

/** The scroll offset that puts the row at `index` near the top third, or the top for the first rows. */
export function scrollToReveal(index: number, rowHeight = ROW_HEIGHT): number {
  return index > 4 ? index * rowHeight - 160 : 0
}

/** Where a key lands in a sibling list: the index of the row to select, or the same one at an edge. */
export type Move = 'prev' | 'next' | 'first' | 'last' | 'page-prev' | 'page-next'
export function moveIndex(index: number, length: number, move: Move, pageSize: number): number {
  if (length <= 0) return -1
  const last = length - 1
  if (index < 0) return move === 'last' ? last : 0
  const from = index
  switch (move) {
    case 'next': return Math.min(last, from + 1)
    case 'prev': return Math.max(0, from - 1)
    case 'first': return 0
    case 'last': return last
    case 'page-next': return Math.min(last, from + pageSize)
    case 'page-prev': return Math.max(0, from - pageSize)
  }
}
