import { parseLayout } from './tmux-layout-string'

/**
 * The tmux state a recorded MCP session leaves after each call.
 *
 * The replay's preview draws these frames. Every value in one is read from the
 * recording: a name, an id, a command or some output a result or a request
 * carried. A fact the recording never states stays absent, so the preview draws
 * a window without an index rather than guessing `0`. `site/test/mcp-replay.test.ts`
 * checks that each string and number in a frame occurs in the recording.
 */

/** One recorded call and what the server answered, as `gen-mcp-transcript.mjs` writes it. */
export interface ReplayStep {
  tool: string
  arguments: Record<string, unknown>
  structuredContent?: unknown
  content: { type: string; text?: string }[]
}

export interface PaneState {
  id?: string
  /** The program the pane runs, from a pane listing. */
  command?: string
  path?: string
  /** What a run call typed into the pane. */
  typed?: string
  /** What the run call read back from the pane. */
  output?: string
  /** The pane's rectangle in cells, when a pane listing states one. */
  left?: number
  top?: number
  width?: number
  height?: number
}

export interface WindowState {
  id?: string
  index?: number
  name?: string
  active?: boolean
  /** The layout a result reported, in the spelling it used; `parseLayout` reads it. */
  layout?: string
  panes: PaneState[]
}

export interface SessionState {
  id?: string
  name?: string
  windows: WindowState[]
}

/** What a list call read: it changes nothing, and the preview marks the part it read. */
export type Reading = 'sessions' | 'windows' | 'panes'

export interface Frame {
  /** Calls made so far; frame 0 is before the first. */
  done: number
  /** The call that produced this frame. */
  tool?: string
  sessions: SessionState[]
  reading?: Reading
}

type Record_ = Record<string, unknown>
const isRecord = (value: unknown): value is Record_ => value !== null && typeof value === 'object' && !Array.isArray(value)
const str = (value: unknown) => (typeof value === 'string' ? value : undefined)
const num = (value: unknown) => (typeof value === 'number' ? value : undefined)
/** A count or index a server sent as digits in a string. */
const numeric = (value: unknown) => (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : num(value))

/** A server's structured answer, else its text parsed as JSON, else nothing. */
function answerOf(step: ReplayStep): Record_ {
  if (isRecord(step.structuredContent)) return step.structuredContent
  const text = step.content.map((part) => part.text ?? '').join('')
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

const clone = <T,>(value: T): T => structuredClone(value)
/**
 * Placeholders for panes no result describes. Every tmux window has at least one
 * pane, so a window the recording names is drawn with that many empty boxes;
 * the test checks that each recorded window holds one, so the layout drawn
 * (which no result states) never decides anything.
 */
const blank = (count: number): PaneState[] => Array.from({ length: Math.max(count, 1) }, () => ({}))

/** The pane a request names, by the argument spelling the port uses. */
const paneOf = (args: Record_) => str(args.paneId) ?? str(args.pane) ?? str(args.pane_id) ?? str(args.target)

function findPane(sessions: SessionState[], id: string | undefined): PaneState | undefined {
  if (!id) return undefined
  return sessions.flatMap((session) => session.windows.flatMap((window) => window.panes)).find((pane) => pane.id === id)
}

/** A command's output as text: a server may send one string or its lines. */
const textOf = (value: unknown): string | undefined => (Array.isArray(value) && value.every((line) => typeof line === 'string') ? value.join('\n') : str(value))

const entries = (value: unknown): Record_[] => (Array.isArray(value) ? value.filter(isRecord) : [])

function applyCreate(sessions: SessionState[], answer: Record_) {
  const session = isRecord(answer.session) ? answer.session : answer
  const windowCount = num(session.windows) ?? numeric(session.window_count) ?? 1
  const windows: WindowState[] = Array.from({ length: Math.max(windowCount, 1) }, () => ({ panes: blank(1) }))
  // The first window's id and first pane, when the answer names them.
  const windowId = str(answer.windowId)
  if (windowId) windows[0]!.id = windowId
  const paneId = str(answer.paneId) ?? str(answer.active_pane_id)
  if (paneId) windows[0]!.panes[0]!.id = paneId
  const sessionId = str(session.id) ?? str(session.sessionId) ?? str(session.session_id)
  const sessionName = str(session.name) ?? str(session.sessionName) ?? str(session.session_name)
  sessions.push({ ...(sessionId ? { id: sessionId } : {}), ...(sessionName ? { name: sessionName } : {}), windows })
}

function applyWindows(sessions: SessionState[], answer: Record_) {
  for (const item of [...entries(answer.windows), ...entries(answer.result)]) {
    const owner = sessions.find((session) => session.id === str(item.session_id)) ?? sessions[0]
    if (!owner) continue
    const itemId = str(item.id) ?? str(item.window_id)
    const known = owner.windows.find((window) => window.id === itemId)
      ?? owner.windows.find((window) => window.id === undefined && window.index === undefined)
    const target: WindowState = known ?? { panes: [] }
    if (!known) owner.windows.push(target)
    if (itemId) target.id = itemId
    const index = numeric(item.index) ?? numeric(item.window_index)
    if (index !== undefined) target.index = index
    const name = str(item.name) ?? str(item.window_name)
    if (name) target.name = name
    if (typeof item.active === 'boolean') target.active = item.active
    const layout = str(item.layout) ?? str(item.window_layout)
    if (layout) target.layout = layout
    if (target.panes.length === 0) target.panes = blank(num(item.panes) ?? numeric(item.pane_count) ?? 1)
  }
}

function applyPanes(sessions: SessionState[], answer: Record_) {
  for (const item of entries(answer.panes)) {
    const windows = sessions.flatMap((session) => session.windows)
    const window = windows.find((candidate) => candidate.id !== undefined && candidate.id === str(item.window_id)) ?? windows[0]
    if (!window) continue
    const pane = window.panes.find((candidate) => candidate.id === str(item.id)) ?? window.panes.find((candidate) => candidate.id === undefined) ?? (window.panes.push({}), window.panes.at(-1)!)
    if (str(item.id)) pane.id = str(item.id)!
    if (str(item.command)) pane.command = str(item.command)!
    if (str(item.path)) pane.path = str(item.path)!
    const command = str(item.currentCommand)
    if (command && !pane.command) pane.command = command
    const box = isRecord(item.geometry) ? item.geometry : item
    for (const key of ['left', 'top', 'width', 'height'] as const) if (num(box[key]) !== undefined) pane[key] = num(box[key])!
    // A listing that names the window says which window these panes are in.
    const windowId = str(item.windowId)
    if (windowId && window.id === undefined) window.id = windowId
  }
}

function windowOfPane(sessions: SessionState[], id: string | undefined): WindowState | undefined {
  const windows = sessions.flatMap((session) => session.windows)
  return windows.find((window) => id !== undefined && window.panes.some((pane) => pane.id === id))
}

function applySplit(sessions: SessionState[], step: ReplayStep, answer: Record_) {
  const pane = isRecord(answer.pane) ? answer.pane : answer
  const id = str(pane.id) ?? str(pane.paneId) ?? str(pane.pane_id)
  const windowId = str(pane.window_id) ?? str(pane.windowId)
  const windows = sessions.flatMap((session) => session.windows)
  const window = windows.find((candidate) => windowId !== undefined && candidate.id === windowId) ?? windowOfPane(sessions, paneOf(step.arguments))
  if (!window || !id) return
  // The split result names the window the new pane is in, which is the window of the pane that was split.
  if (windowId && window.id === undefined) window.id = windowId
  const added: PaneState = { id }
  const command = str(pane.command) ?? str(pane.pane_current_command)
  if (command) added.command = command
  const path = str(pane.path) ?? str(pane.cwd) ?? str(pane.pane_current_path)
  if (path) added.path = path
  window.panes.push(added)
  // A layout read before the split no longer describes the window.
  delete window.layout
}

function applyLayoutRead(sessions: SessionState[], step: ReplayStep, answer: Record_) {
  const values = isRecord(answer.values) ? answer.values : {}
  const reported = isRecord(answer.window) ? answer.window : answer
  const layout = str(values.window_layout) ?? str(reported.layout)
  // select_layout can answer with a layout's name, which has no geometry to draw.
  if (!layout || !parseLayout(layout)) return
  const windowId = str(reported.id) ?? str(reported.windowId) ?? (typeof answer.window === 'string' ? answer.window : undefined)
  const windows = sessions.flatMap((session) => session.windows)
  const window = windows.find((candidate) => windowId !== undefined && candidate.id === windowId) ?? windowOfPane(sessions, paneOf(step.arguments))
  if (window) window.layout = layout
}

function applyRun(sessions: SessionState[], step: ReplayStep, answer: Record_) {
  const id = paneOf(step.arguments) ?? str(answer.paneId) ?? str(answer.pane)
  const pane = findPane(sessions, id) ?? sessions[0]?.windows[0]?.panes[0]
  if (!pane) return
  const typed = str(step.arguments.command)
  if (typed !== undefined) pane.typed = typed
  const output = textOf(answer.output)
  if (output !== undefined) pane.output = output
}

function applyKill(sessions: SessionState[], answer: Record_, args: Record_): SessionState[] {
  // What was killed may be said as an id or as a name, by the answer or by the request.
  const said = [str(answer.killed), str(answer.id), str(args.session_id), str(args.session), str(args.session_name), str(args.name)].filter((item): item is string => item !== undefined)
  const first = said[0]
  if (first === undefined) return sessions
  return sessions.filter((session) => session.id !== first && session.name !== first)
}

const READS: Record<string, Reading> = { list_sessions: 'sessions', list_windows: 'windows', list_panes: 'panes' }

/** The frames of a recording: the state before the first call, then the state after each. */
export function replayFrames(steps: readonly ReplayStep[]): Frame[] {
  let sessions: SessionState[] = []
  const frames: Frame[] = [{ done: 0, sessions: [] }]
  steps.forEach((step, index) => {
    const answer = answerOf(step)
    const reading = READS[step.tool]
    if (step.tool === 'create_session' || step.tool === 'new_session') applyCreate(sessions, answer)
    else if (step.tool === 'list_windows') applyWindows(sessions, answer)
    else if (step.tool === 'list_panes') applyPanes(sessions, answer)
    else if (step.tool === 'split_window') applySplit(sessions, step, answer)
    else if (step.tool === 'get_tmux_variables' || step.tool === 'select_layout') applyLayoutRead(sessions, step, answer)
    else if (step.tool === 'run_shell_command' || step.tool === 'run_command') applyRun(sessions, step, answer)
    else if (step.tool === 'kill_session') sessions = applyKill(sessions, answer, step.arguments)
    frames.push({ done: index + 1, tool: step.tool, sessions: clone(sessions), ...(reading ? { reading } : {}) })
  })
  return frames
}

/** A window's label in the status line: `index:name` when both were recorded, else what was. */
export function windowLabel(window: WindowState): string {
  if (window.index !== undefined && window.name !== undefined) return `${window.index}:${window.name}`
  if (window.index !== undefined) return String(window.index)
  return window.name ?? window.id ?? ''
}

/** The last line of a pane's output that has text on it, for the agent's answer. */
export function lastOutputLine(output: string | undefined): string | undefined {
  // A bare shell prompt left after the command is not what it printed.
  return output?.split('\n').map((line) => line.trimEnd()).filter((line) => line && !/^[$#>%]$/.test(line)).at(-1)
}

/** What each command run left in its pane, as the last line with text, for the agent's answer. */
export function runAnswers(steps: readonly ReplayStep[]): { pane?: string; line: string }[] {
  return steps.flatMap((step) => {
    if (step.tool !== 'run_shell_command' && step.tool !== 'run_command') return []
    const line = lastOutputLine(textOf(answerOf(step).output))
    const pane = paneOf(step.arguments) ?? str(answerOf(step).paneId) ?? str(answerOf(step).pane)
    return line ? [{ ...(pane ? { pane } : {}), line }] : []
  })
}
