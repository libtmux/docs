import data from '../data/workspace-showcase.json'
import { LAYOUTS, renderLayout, type TmuxLayout } from './tmux-layout'

/**
 * Workspace configurations a port's own tests load, with a drawing of the panes
 * each builds.
 *
 * `scripts/gen-workspace-showcase.mjs` reads each configuration at the revision
 * the port's API model records and confirms the tests that load it, so a port
 * with no such configuration has no entry and shows nothing.
 */

export type TopicId =
  | 'shorthand' | 'two-pane' | 'three-pane' | 'four-pane' | 'tiled'
  | 'main-horizontal' | 'shell-command-before' | 'environment' | 'start-directory'

/** The tmuxp classics, in page order. */
export const TOPICS: readonly { id: TopicId; title: string; summary: string }[] = [
  { id: 'shorthand', title: 'Short-hand panes', summary: 'A pane can be one command written as a string, and a command list can be one string.' },
  { id: 'two-pane', title: 'Two panes', summary: 'A window of two panes.' },
  { id: 'three-pane', title: 'Three panes', summary: 'A window of three panes.' },
  { id: 'four-pane', title: 'Four panes', summary: 'A window of four panes.' },
  { id: 'tiled', title: 'Tiled layout', summary: 'The tiled layout arranges the panes in a grid.' },
  { id: 'main-horizontal', title: 'Main-horizontal layout', summary: 'The main-horizontal layout gives the first pane the top of the window and splits the rest below it.' },
  { id: 'shell-command-before', title: 'Setup before each pane', summary: 'shell_command_before runs ahead of a pane\'s own commands, at the session, window or pane level.' },
  { id: 'environment', title: 'Environment', summary: 'environment sets variables for a session, a window or a pane.' },
  { id: 'start-directory', title: 'Start directory', summary: 'start_directory chooses where a session, a window or a pane starts.' },
]

/** How a test reaches the file: the command itself, or the code the command is built on. */
export type TestVia = 'cli' | 'loader' | 'builder' | 'library'

export interface ShowcaseTest {
  path: string
  name: string
  line: number
  via: TestVia
  checks: string
}

export interface ShowcaseExample {
  topic: TopicId
  /** Other classics the same document shows. */
  also: TopicId[]
  source: { path: string; lines?: [number, number] }
  note?: string
  yaml: string
  sha256: string
  json: string
  tests: ShowcaseTest[]
}

export interface WorkspaceShowcase {
  port: string
  /** `owner/name` of the repository the examples were read from. */
  repo: string
  revision: string
  examples: ShowcaseExample[]
}

// The generator guarantees the topics and test routes the JSON types as plain strings.
const PORTS = (data as unknown as { ports: Record<string, Omit<WorkspaceShowcase, 'port'>> }).ports

/** The showcase for a port, or nothing for a port with no tested configuration. */
export function workspaceShowcase(port: string): WorkspaceShowcase | undefined {
  const block = PORTS[port]
  return block?.examples.length ? { port, ...block } : undefined
}

/** A GitHub link pinned to the revision the example was read at. */
export function revisionUrl(showcase: Pick<WorkspaceShowcase, 'repo' | 'revision'>, path: string, lines?: number | [number, number]): string {
  const anchor = lines === undefined ? '' : typeof lines === 'number' ? `#L${lines}` : `#L${lines[0]}-L${lines[1]}`
  return `https://github.com/${showcase.repo}/blob/${showcase.revision}/${path}${anchor}`
}

type Config = Record<string, unknown>
interface WindowConfig extends Config { window_name?: unknown; layout?: unknown; panes?: unknown }

const windowsOf = (config: Config): WindowConfig[] =>
  (Array.isArray(config.windows) ? config.windows : []).filter((window): window is WindowConfig => Boolean(window) && typeof window === 'object')
const panesOf = (window: WindowConfig): unknown[] => (Array.isArray(window.panes) ? window.panes : [])

/** Whether `key` appears at any level of the document. */
function hasKey(value: unknown, keys: readonly string[]): boolean {
  if (Array.isArray(value)) return value.some((item) => hasKey(item, keys))
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(([key, item]) => keys.includes(key) || hasKey(item, keys))
}

/** Whether a document shows what its topic claims. */
export function showsTopic(config: Config, topic: TopicId): boolean {
  const windows = windowsOf(config)
  const counts = windows.map((window) => panesOf(window).length)
  switch (topic) {
    case 'shorthand':
      return windows.some((window) => panesOf(window).some((pane) => typeof pane === 'string' || Array.isArray(pane)
        || (typeof pane === 'object' && pane !== null && typeof (pane as Config).shell_command === 'string')))
    case 'two-pane': return counts.includes(2)
    case 'three-pane': return counts.includes(3)
    case 'four-pane': return counts.includes(4)
    case 'tiled': return windows.some((window) => window.layout === 'tiled')
    case 'main-horizontal': return windows.some((window) => window.layout === 'main-horizontal')
    case 'shell-command-before': return hasKey(config, ['shell_command_before'])
    case 'environment': return hasKey(config, ['environment'])
    case 'start-directory': return hasKey(config, ['start_directory', 'root'])
  }
}

const BLANK = new Set(['pane', 'blank', ''])

/** The command lines a pane types, as the layout drawing shows them. */
export function paneCommands(pane: unknown): string[] {
  if (pane === null || pane === undefined) return []
  if (typeof pane === 'string') return BLANK.has(pane) ? [] : [pane]
  if (Array.isArray(pane)) return pane.flatMap((item) => (typeof item === 'string' ? paneCommands(item)
    : item && typeof item === 'object' && typeof (item as Config).cmd === 'string' ? paneCommands((item as Config).cmd) : []))
  if (typeof pane === 'object') return paneCommands((pane as Config).shell_command)
  return []
}

export interface LayoutPreview {
  svg: string
  /** The window drawn: the first with more than one pane, else the first with a pane. */
  window?: string
  layout?: string
  windows: number
  panes: number
}

/** A screen big enough for the panes' text; main layouts and grids need height for the split. */
export function previewSize(layout: TmuxLayout, panes: number): [number, number] {
  if (layout === 'even-vertical') return [44, Math.max(8, 3 + 3 * panes)]
  if (layout === 'even-horizontal') return [Math.max(44, 18 * panes), 8]
  return [44, panes > 4 ? 16 : 12]
}

/**
 * Draw the window of a document that shows its layout best.
 *
 * A window with no `layout` is drawn as `even-vertical`, which is how tmux
 * stacks the panes of two splits; a saved layout string cannot be drawn, so
 * the document gets no preview.
 */
export function previewLayout(config: Config, id: string): LayoutPreview | undefined {
  const windows = windowsOf(config)
  const window = windows.find((candidate) => panesOf(candidate).length > 1) ?? windows.find((candidate) => panesOf(candidate).length > 0)
  if (!window) return undefined
  const layout = typeof window.layout === 'string' ? window.layout : undefined
  if (layout !== undefined && !(LAYOUTS as readonly string[]).includes(layout)) return undefined
  const panes = panesOf(window).map(paneCommands)
  const name = typeof window.window_name === 'string' ? window.window_name : undefined
  return {
    svg: renderLayout(panes, layout ?? 'even-vertical', previewSize((layout ?? 'even-vertical') as TmuxLayout, panes.length), { id }),
    ...(name ? { window: name } : {}),
    ...(layout ? { layout } : {}),
    windows: windows.length,
    panes: panes.length,
  }
}

/** The headings the showcase adds to a page's table of contents. */
export function showcaseHeadings(showcase: WorkspaceShowcase): { depth: number; slug: string; text: string }[] {
  const order = TOPICS.map((topic) => topic.id)
  return [
    { depth: 2, slug: 'example-workspaces', text: 'Example workspaces' },
    ...[...showcase.examples].sort((a, b) => order.indexOf(a.topic) - order.indexOf(b.topic))
      .map((example) => ({ depth: 3, slug: `example-${example.topic}`, text: TOPICS[order.indexOf(example.topic)]!.title })),
  ]
}
