/**
 * Pinned source files and the on-site pages that show them.
 *
 * `scripts/gen-api-sources.mjs` caches every file an API model cites, at the
 * revision the model records, in `data/api-sources/<port>.json`. This module
 * reads that cache and builds the URL of a file's source page, so a reference
 * entry, a behaviour fact and the source pane all link to one place and none
 * of them reads a branch head.
 */
import { PORT_BY_SLUG, referenceUrl } from './ports'
import { linkedVersionFor } from './versions'

/** A file of a port's library at the revision its API model documents. */
export interface PinnedSource {
  repo: string
  revision: string
  file: string
  content: string
  sha256: string
}

interface SourceData {
  port: string
  /** Paths the model embeds itself, because the build generates them. */
  generated?: string[]
  files: Record<string, Omit<PinnedSource, 'file'>>
}

/** Raw text, parsed per port on first use: a build or a test reads one or two ports, not all. */
const RAW = import.meta.glob<string>('../data/api-sources/*.json', { eager: true, query: '?raw', import: 'default' })

const parsed = new Map<string, SourceData | undefined>()

function dataFor(port: string): SourceData | undefined {
  if (!parsed.has(port)) {
    const raw = RAW[`../data/api-sources/${port}.json`]
    parsed.set(port, raw === undefined ? undefined : JSON.parse(raw) as SourceData)
  }
  return parsed.get(port)
}

/** The pinned copy of a file, or undefined when the port has none. */
export function pinnedSource(port: string, file: string): PinnedSource | undefined {
  const entry = dataFor(port)?.files[file]
  return entry && { ...entry, file }
}

/** Every file the port has a source page for: its pinned copies and the files its model embeds. */
export function sourceFilesFor(port: string): string[] {
  const data = dataFor(port)
  return data ? [...new Set([...Object.keys(data.files), ...(data.generated ?? [])])].sort() : []
}

/** A file the model embeds rather than a repository holds. */
export const isGeneratedSource = (port: string, file: string): boolean => dataFor(port)?.generated?.includes(file) ?? false

export type SourceLines = number | readonly [from: number, to: number]

/** The `#L112` or `#L112-L129` fragment of a line or range. */
export function lineFragment(lines?: SourceLines): string {
  if (lines === undefined) return ''
  const [from, to] = typeof lines === 'number' ? [lines, lines] : lines
  if (!Number.isInteger(from) || from < 1) return ''
  return to > from ? `#L${from}-L${to}` : `#L${from}`
}

/**
 * The on-site URL of a file's source page: `<reference>/sources/<file>/`,
 * with the line or range as a fragment and `from` (the page the reader came
 * from, by its symbol slug) as a query so the page can link back.
 * Undefined when the port has no copy, so a caller never links to a page
 * that was not built.
 */
export function sourcePageHref(port: string, file: string, line?: SourceLines, from?: string): string | undefined {
  const target = PORT_BY_SLUG[port]
  if (!target || (!pinnedSource(port, file) && !isGeneratedSource(port, file))) return undefined
  const base = referenceUrl(target, linkedVersionFor(port))
  return `${base}sources/${file}/${from ? `?from=${encodeURIComponent(from)}` : ''}${lineFragment(line)}`
}
