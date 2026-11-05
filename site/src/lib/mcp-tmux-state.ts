import { parseLayout } from './tmux-layout-string.ts'

/**
 * What a recording's own tmux server looked like at one moment, as
 * `scripts/gen-mcp-transcript.mjs` reads it from that server after each call:
 * every session, every window with the layout tmux reports for it, and every
 * pane with its command and rectangle.
 *
 * The recorder and the page both use this module's checks, so a state the
 * recorder would refuse to write is a state the page refuses to draw.
 */
export interface TmuxSession { id: string; name: string }
export interface TmuxWindow { session: string; id: string; index: number; name: string; active: boolean; layout: string }
export interface TmuxPane {
  window: string
  id: string
  /** `pane_current_command`: the program the pane runs. */
  command: string
  left: number
  top: number
  width: number
  height: number
  active: boolean
}
export interface TmuxState { sessions: TmuxSession[]; windows: TmuxWindow[]; panes: TmuxPane[] }

/** The tools that only read tmux. A recording's state after one of them equals the state before it. */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set(['list_sessions', 'list_windows', 'list_panes', 'tmux_snapshot', 'tmux_capabilities', 'get_tmux_variables', 'capture_pane'])

type Kind = 'string' | 'number' | 'boolean'
const FIELDS: Record<keyof TmuxState, { required: Record<string, Kind>; optional?: Record<string, Kind> }> = {
  sessions: { required: { id: 'string', name: 'string' } },
  windows: { required: { session: 'string', id: 'string', index: 'number', name: 'string', active: 'boolean', layout: 'string' } },
  panes: { required: { window: 'string', id: 'string', command: 'string', left: 'number', top: 'number', width: 'number', height: 'number', active: 'boolean' } },
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Whether `value` has the shape of a `TmuxState`: the three lists, and in them exactly the fields above with their types. */
function shapeProblems(value: unknown): string[] {
  if (!isRecord(value)) return ['is not an object']
  const problems: string[] = []
  for (const extra of Object.keys(value).filter((key) => !(key in FIELDS))) problems.push(`has an unknown field ${extra}`)
  for (const [list, { required, optional = {} }] of Object.entries(FIELDS)) {
    const items = value[list]
    if (!Array.isArray(items)) { problems.push(`${list} is not a list`); continue }
    items.forEach((item, position) => {
      const at = `${list}[${position}]`
      if (!isRecord(item)) { problems.push(`${at} is not an object`); return }
      for (const [field, kind] of Object.entries({ ...required, ...optional })) {
        if (field in item ? typeof item[field] !== kind : field in required) problems.push(`${at}.${field} is ${field in item ? `a ${typeof item[field]}` : 'missing'}, expected a ${kind}`)
      }
      for (const extra of Object.keys(item).filter((field) => !(field in required) && !(field in optional))) problems.push(`${at} has an unknown field ${extra}`)
    })
  }
  return problems
}

/**
 * Whether one state is something tmux can be in: its parts refer to each other
 * (a window to its session, a pane to its window), each session has a window
 * and each window a pane, one window and one pane are active, and a window's
 * layout names exactly its panes at the rectangles the panes report.
 *
 * @returns what is wrong, empty when nothing is
 */
export function stateProblems(state: unknown): string[] {
  const shape = shapeProblems(state)
  if (shape.length) return shape
  const { sessions, windows, panes } = state as TmuxState
  const problems: string[] = []
  const ids = [...sessions, ...windows, ...panes].map((item) => item.id)
  for (const id of new Set(ids.filter((id, position) => ids.indexOf(id) !== position))) problems.push(`${id} appears twice`)
  for (const window of windows) if (!sessions.some((session) => session.id === window.session)) problems.push(`window ${window.id} is in session ${window.session}, which the state lacks`)
  for (const pane of panes) if (!windows.some((window) => window.id === pane.window)) problems.push(`pane ${pane.id} is in window ${pane.window}, which the state lacks`)
  for (const session of sessions) {
    const own = windows.filter((window) => window.session === session.id)
    if (own.length === 0) problems.push(`session ${session.id} has no window`)
    else if (own.filter((window) => window.active).length !== 1) problems.push(`session ${session.id} must have exactly one active window`)
  }
  for (const window of windows) {
    const own = panes.filter((pane) => pane.window === window.id)
    if (own.length === 0) { problems.push(`window ${window.id} has no pane`); continue }
    if (own.filter((pane) => pane.active).length !== 1) problems.push(`window ${window.id} must have exactly one active pane`)
    const layout = parseLayout(window.layout)
    if (!layout) { problems.push(`window ${window.id}: its layout is not one tmux reports`); continue }
    if (layout.panes.map((pane) => pane.id).sort().join() !== own.map((pane) => pane.id).sort().join()) problems.push(`window ${window.id}: its layout names ${layout.panes.map((pane) => pane.id).join(', ')}, its panes are ${own.map((pane) => pane.id).join(', ')}`)
    for (const placed of layout.panes) {
      const pane = own.find((candidate) => candidate.id === placed.id)
      if (pane && (pane.left !== placed.x || pane.top !== placed.y || pane.width !== placed.w || pane.height !== placed.h)) problems.push(`pane ${pane.id} is ${pane.width}x${pane.height} at ${pane.left},${pane.top}, its window's layout puts it at ${placed.w}x${placed.h} at ${placed.x},${placed.y}`)
    }
  }
  return problems
}

const ID = /[$%@]\d+(?!\d)/g
/** The tmux ids (`$1`, `@2`, `%3`) a value names. */
const idsIn = (value: unknown): string[] => JSON.stringify(value ?? null).match(ID) ?? []
const idsOf = (state: TmuxState) => new Set([...state.sessions, ...state.windows, ...state.panes].map((item) => item.id))

/** The recorded fields of a step that the check reads. */
export interface StatedStep { tool: string; arguments: unknown; content: unknown; structuredContent?: unknown; tmux?: unknown }

/** Whether a recording carries tmux state at all: a recording made before the recorder read it carries none. */
export const hasState = (recording: { tmuxBefore?: unknown; steps: readonly StatedStep[] }): boolean => recording.tmuxBefore !== undefined || recording.steps.some((step) => step.tmux !== undefined)

/**
 * Whether a recording's states describe the session its calls made. Every step
 * and the start carry a state that `stateProblems` accepts. A call names only
 * ids the state before it had. A call that is not a removal returns only ids
 * its own state has, so a state read a step late, or from another server, is
 * caught. A tool that only reads leaves the state as it was.
 *
 * A recording with no state at all passes: it is drawn from its results.
 *
 * @returns what is wrong, empty when nothing is
 */
export function recordingStateProblems(recording: { tmuxBefore?: unknown; steps: readonly StatedStep[] }): string[] {
  if (!hasState(recording)) return []
  const problems: string[] = []
  const check = (where: string, state: unknown) => stateProblems(state).forEach((problem) => problems.push(`${where}: ${problem}`))
  if (recording.tmuxBefore === undefined) problems.push('the state before the first call is missing')
  else check('before the first call', recording.tmuxBefore)
  recording.steps.forEach((step, index) => {
    const where = `after step ${index + 1} (${step.tool})`
    if (step.tmux === undefined) { problems.push(`${where}: the state is missing`); return }
    check(where, step.tmux)
  })
  if (problems.length) return problems
  let before = recording.tmuxBefore as TmuxState
  recording.steps.forEach((step, index) => {
    const after = step.tmux as TmuxState
    const where = `after step ${index + 1} (${step.tool})`
    for (const id of new Set(idsIn(step.arguments))) if (!idsOf(before).has(id)) problems.push(`${where}: the call names ${id}, which tmux did not have before it`)
    if (!step.tool.startsWith('kill')) for (const id of new Set(idsIn([step.content, step.structuredContent]))) if (!idsOf(after).has(id)) problems.push(`${where}: the result returns ${id}, which tmux does not have after the call`)
    if (READ_ONLY_TOOLS.has(step.tool) && JSON.stringify(before) !== JSON.stringify(after)) problems.push(`${where}: ${step.tool} only reads, yet tmux changed`)
    before = after
  })
  return problems
}
