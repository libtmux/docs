import data from '../data/workspace-showcase.json'
import { LAYOUTS, renderLayout, type TmuxLayout } from './tmux-layout'
import { layoutIcon } from './tmux-layout-icon'

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
  | '2-pane-synchronized' | 'blank-panes' | 'env-variables' | 'focus-window-and-panes'
  | 'main-pane-height-percentage' | 'minimal' | 'options' | 'pane-shell' | 'skip-send'
  | 'skip-send-pane-level' | 'sleep' | 'sleep-pane-level' | 'sleep-virtualenv'
  | 'suppress-history' | 'window-index'

/**
 * The presets, in page order: the tmuxp classics, then the rest of tmuxp's
 * examples under their file names.
 */
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
  { id: '2-pane-synchronized', title: 'Synchronized panes', summary: 'options_after sets synchronize-panes once the panes exist, so typing in one pane reaches the others.' },
  { id: 'blank-panes', title: 'Blank panes', summary: 'An empty entry, null, pane or blank opens a pane with no command.' },
  { id: 'env-variables', title: 'Variables in values', summary: 'A ${VAR} in a name, a path or an option expands from the environment of the loading process.' },
  { id: 'focus-window-and-panes', title: 'Focus', summary: 'focus: true selects a window or a pane when the session is built.' },
  { id: 'main-pane-height-percentage', title: 'Main pane height as a percentage', summary: 'main-pane-height takes a percentage of the window as well as a row count.' },
  { id: 'minimal', title: 'Minimal workspace', summary: 'A session name and one window with one blank pane.' },
  { id: 'options', title: 'tmux options', summary: 'global_options, options and a window\'s options set tmux options.' },
  { id: 'pane-shell', title: 'Shell per pane', summary: 'A pane can start its own shell or program, and window_shell sets the default for a window.' },
  { id: 'skip-send', title: 'Skip Enter for a command', summary: 'enter: false types a command without running it.' },
  { id: 'skip-send-pane-level', title: 'Skip Enter for a pane', summary: 'enter: false on a pane types its commands without running them.' },
  { id: 'sleep', title: 'Pause around a command', summary: 'sleep_before and sleep_after delay a command or the one after it.' },
  { id: 'sleep-pane-level', title: 'Pause before a pane', summary: 'sleep_before on a pane waits before it sends any of its commands.' },
  { id: 'sleep-virtualenv', title: 'Wait for a virtualenv', summary: 'A setup command with sleep_before and sleep_after gives a virtualenv time to activate before the commands run.' },
  { id: 'suppress-history', title: 'Keep commands out of history', summary: 'suppress_history chooses whether commands reach the shell history, per session, window, pane or command.' },
  { id: 'window-index', title: 'Window index', summary: 'window_index places a window at an index; a window without one takes the lowest free index.' },
]

/**
 * How the file is reached: a test that runs the command, a test that calls the
 * code the command is built on, or a scheduled run that is no gate on a pull
 * request.
 */
export type TestVia = 'cli' | 'loader' | 'builder' | 'library' | 'scheduled'

export interface ShowcaseTest {
  path: string
  name: string
  line: number
  via: TestVia
  checks: string
}

export interface ShowcaseExample {
  topic: TopicId
  /** Other presets the same document shows. */
  also: TopicId[]
  /** The tmuxp example this file is byte-identical to. */
  tmuxp?: string
  source: { path: string; lines?: [number, number] }
  note?: string
  yaml: string
  sha256: string
  json: string
  tests: ShowcaseTest[]
}

export type Support = 'yes' | 'caveat' | 'no'
export type Tested = 'identical' | 'other' | 'library-only' | 'missing'

/** A string on a line of the port's source that shows why a preset is, or is not, supported. */
export interface SupportCite {
  path: string
  find: string
  line: number
  /** The port whose repository holds the file, when it is not this one. */
  from?: string
}

export interface SupportRow {
  supported: Support
  reason?: string
  cite?: SupportCite
  tested: Tested
}

export interface WorkspaceShowcase {
  port: string
  /** `owner/name` of the repository the examples were read from. */
  repo: string
  revision: string
  /** What the port's loader does with each of tmuxp's examples. */
  support: { presets: Record<string, SupportRow>; defaultLayout?: { layout: TmuxLayout; cite: SupportCite } }
  examples: ShowcaseExample[]
}

// The generator guarantees the topics and test routes the JSON types as plain strings.
const PORTS = (data as unknown as { ports: Record<string, Omit<WorkspaceShowcase, 'port'>> }).ports

/** tmuxp's examples at the revision the Python port's API model records. */
export const TMUXP = (data as unknown as { tmuxp: { revision: string; examples: Record<string, string> } }).tmuxp

/** A link to tmuxp's example, pinned to that revision. */
export const tmuxpExampleUrl = (name: string) => `https://github.com/tmux-python/tmuxp/blob/${TMUXP.revision}/examples/${name}.yaml`

/** The ports the data describes, with or without examples to show. */
export const supportedPorts = () => Object.keys(PORTS)

/** What a port's loader does with each of tmuxp's examples, whether or not the port shows any. */
export const portSupport = (port: string) => PORTS[port]?.support

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

/** The mappings that are a command: items of a `shell_command` list, or of a `shell_command_before` one. */
function commandObjects(config: Config): Config[] {
  const found: Config[] = []
  const lists = (value: unknown) => {
    for (const item of Array.isArray(value) ? value : []) if (item && typeof item === 'object' && !Array.isArray(item)) found.push(item as Config)
  }
  lists(config.shell_command_before)
  for (const window of windowsOf(config)) {
    lists(window.shell_command_before)
    for (const pane of panesOf(window)) {
      if (!pane || typeof pane !== 'object' || Array.isArray(pane)) continue
      lists((pane as Config).shell_command)
      lists((pane as Config).shell_command_before)
    }
  }
  return found
}

/** The mappings that are a pane. */
const paneObjects = (config: Config): Config[] =>
  windowsOf(config).flatMap((window) => panesOf(window).filter((pane): pane is Config => Boolean(pane) && typeof pane === 'object' && !Array.isArray(pane)))

/** Whether a document shows what its preset claims. */
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
    case '2-pane-synchronized': return hasKey(config, ['options_after'])
    case 'blank-panes': return windows.some((window) => panesOf(window).some((pane) => pane === null || (typeof pane === 'string' && BLANK.has(pane))))
    case 'env-variables': return JSON.stringify(config).includes('${')
    case 'focus-window-and-panes': return hasKey(config, ['focus'])
    case 'main-pane-height-percentage':
      return windows.some((window) => {
        const height = ((window.options ?? {}) as Config)['main-pane-height']
        return typeof height === 'string' && /^\d+%$/.test(height)
      })
    case 'minimal': return windows.length === 1 && counts[0]! <= 1 && !windows[0]!.window_name
    case 'options': return hasKey(config, ['global_options', 'options'])
    case 'pane-shell': return hasKey(config, ['shell', 'window_shell'])
    case 'skip-send': return commandObjects(config).some((command) => command.enter === false)
    case 'skip-send-pane-level': return paneObjects(config).some((pane) => pane.enter === false)
    case 'sleep': return commandObjects(config).some((command) => 'sleep_before' in command || 'sleep_after' in command)
    case 'sleep-pane-level': return paneObjects(config).some((pane) => 'sleep_before' in pane)
    case 'sleep-virtualenv': return commandObjects({ shell_command_before: config.shell_command_before }).some((command) => 'sleep_before' in command || 'sleep_after' in command)
    case 'suppress-history': return hasKey(config, ['suppress_history'])
    case 'window-index': return hasKey(config, ['window_index'])
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

/** A screen big enough for the panes' text; main layouts and grids need height for the split. */
export function previewSize(layout: TmuxLayout, panes: number): [number, number] {
  if (layout === 'even-vertical') return [44, Math.max(8, 3 + 3 * panes)]
  if (layout === 'even-horizontal') return [Math.max(44, 18 * panes), 8]
  return [44, panes > 4 ? 16 : 12]
}

/**
 * One window drawn: its tmux index and name, the layout, and the drawing.
 *
 * A window with no `layout` is drawn with the layout the port documents for
 * it, else as `even-vertical`, which is how tmux stacks the panes of two
 * splits.
 */
export interface WindowPreview {
  svg: string
  /** The index tmux gives the window: its `window_index`, else the lowest free one. */
  index: number
  name?: string
  layout?: string
  /** The layout drawn for a window that names none, when the port documents one. */
  defaulted?: string
  /** How many panes the file lists; a window that lists none is drawn with the one pane tmux opens. */
  panes: number
  /** Under the drawing: the layout the window has. */
  caption: string
  /** What the drawing shows, for a reader who cannot see it. */
  label: string
}

/** The text under a window's drawing. */
function layoutCaption(layout: string | undefined, defaulted: string | undefined, panes: number): string {
  if (!panes) return 'no panes listed, so tmux opens one'
  if (layout) return `layout ${layout}`
  return defaulted ? 'no layout set, so the port tiles the panes' : 'no layout set'
}

function drawWindow(window: WindowConfig, index: number, id: string, defaultLayout?: TmuxLayout): WindowPreview | undefined {
  const layout = typeof window.layout === 'string' ? window.layout : undefined
  if (layout !== undefined && !(LAYOUTS as readonly string[]).includes(layout)) return undefined
  const listed = panesOf(window).map(paneCommands)
  // tmux opens a window with one pane, so a window that lists none is that one, empty.
  const panes = listed.length ? listed : [[]]
  const name = typeof window.window_name === 'string' ? window.window_name : undefined
  const drawn = (layout ?? defaultLayout ?? 'even-vertical') as TmuxLayout
  const defaulted = !layout && defaultLayout ? defaultLayout : undefined
  const count = listed.length ? `${listed.length} pane${listed.length === 1 ? '' : 's'}` : 'no panes listed, one empty pane'
  const label = `Window ${index}${name ? `, ${name}` : ''}: ${count}, ${drawn}`
  return {
    svg: renderLayout(panes, drawn, previewSize(drawn, panes.length), { id, label }),
    index,
    ...(name ? { name } : {}),
    ...(layout ? { layout } : {}),
    ...(defaulted ? { defaulted } : {}),
    panes: listed.length,
    caption: layoutCaption(layout, defaulted, listed.length),
    label,
  }
}

/**
 * The index each window gets: its `window_index`, else the lowest index no
 * window names, as tmuxp assigns them.
 */
export function windowIndexes(windows: readonly WindowConfig[]): number[] {
  const taken = new Set(windows.flatMap((window) => (typeof window.window_index === 'number' ? [window.window_index] : [])))
  return windows.map((window) => {
    if (typeof window.window_index === 'number') return window.window_index
    let index = 0
    while (taken.has(index)) index += 1
    taken.add(index)
    return index
  })
}

/**
 * Every window of a document, drawn and in tmux's order, each under the index
 * it will have. A window whose layout is a saved layout string cannot be drawn
 * and is left out.
 */
export function previewWindows(config: Config, idPrefix: string, defaultLayout?: TmuxLayout): WindowPreview[] {
  const windows = windowsOf(config)
  const indexes = windowIndexes(windows)
  return windows.flatMap((window, position) => {
    const drawing = drawWindow(window, indexes[position]!, `${idPrefix}-w${indexes[position]}`, defaultLayout)
    return drawing ? [drawing] : []
  }).sort((a, b) => a.index - b.index)
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

export interface PresetOption {
  id: string
  title: string
  /** One line for a menu row. */
  summary: string
  yaml: string
  json: string
  /** Every window of the preset, drawn; empty when none can be. */
  windows: WindowPreview[]
  /** The workspace keys the file uses, which a search by key finds. */
  keys: string[]
  /** The first window's panes as a small tile, with a hint when more windows follow. */
  icon: string
  /** What a menu search matches: the title, the summary, the id and the keys. */
  match: string
}

/** Keys whose children are names the author chose, not workspace keys. */
const NAMED_CHILDREN = new Set(['environment', 'options', 'options_after', 'global_options'])

/**
 * The keys a document uses, in the order they first appear. The names inside
 * an environment or an options table belong to the author, so only the table's
 * own key counts.
 */
export function configKeys(config: unknown, found: Set<string> = new Set()): string[] {
  if (Array.isArray(config)) {
    for (const item of config) configKeys(item, found)
  } else if (config && typeof config === 'object') {
    for (const [key, value] of Object.entries(config)) {
      found.add(key)
      if (!NAMED_CHILDREN.has(key)) configKeys(value, found)
    }
  }
  return [...found]
}

/** Whether a showcase has more than one preset to choose between. */
export const offersPicker = (showcase: Pick<WorkspaceShowcase, 'examples'>) => showcase.examples.length > 1

/**
 * The presets a picker offers: each example, in the order of the classics, with
 * its YAML, its JSON and every window drawn. The first is what a reader sees
 * before choosing.
 */
export function presetOptions(showcase: WorkspaceShowcase): PresetOption[] {
  const order = TOPICS.map((topic) => topic.id)
  return [...showcase.examples].sort((a, b) => order.indexOf(a.topic) - order.indexOf(b.topic)).map((example) => {
    const topic = TOPICS[order.indexOf(example.topic)]!
    const config = JSON.parse(example.json) as Config
    const windows = previewWindows(config, `ws-pick-${showcase.port}-${example.topic}`, showcase.support.defaultLayout?.layout)
    const first = windows[0]
    const keys = configKeys(config)
    return {
      id: example.topic,
      title: topic.title,
      summary: topic.summary,
      yaml: example.yaml,
      json: example.json,
      windows,
      keys,
      icon: layoutIcon((first?.layout ?? first?.defaulted ?? 'even-vertical') as TmuxLayout, first?.panes ?? 1, windows.length > 1),
      match: [topic.title, topic.summary, example.topic, ...keys].join(' '),
    }
  })
}

/**
 * How each way of reaching a file reads in the page, so a reader sees whether
 * a test runs the command on it or only the code the command is built on.
 */
export const VIA: Readonly<Record<TestVia, string>> = {
  cli: 'a test runs the command',
  loader: 'loaded by the library in a test; the command is not run',
  builder: 'built by the library in a test; the command is not run',
  library: 'parsed by the library in a test; the command is not run',
  scheduled: 'a scheduled parity run loads it, and no pull request runs it',
}

/**
 * The example a port's landing page shows: the first, in preset order, that a
 * test runs the load command on, else the first in preset order.
 */
export function landingExample(showcase: Pick<WorkspaceShowcase, 'examples'>): ShowcaseExample {
  const order = TOPICS.map((topic) => topic.id)
  const sorted = [...showcase.examples].sort((a, b) => order.indexOf(a.topic) - order.indexOf(b.topic))
  return sorted.find((example) => example.tests.some((test) => test.via === 'cli')) ?? sorted[0]!
}
