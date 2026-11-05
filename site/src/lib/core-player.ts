import { statementLines, type LineRange } from './core-statement.ts'
import type { CoreCapability, CoreCommand, CoreRecording, CoreStep } from './core-recording.ts'
import { recordingProblems } from './core-recording.ts'
import { replayFrames, type Frame, type ReplayStep } from './mcp-replay'
import type { TmuxState, TmuxWindow } from './mcp-tmux-state.ts'
import { parseLayout } from './tmux-layout-string'
import type { HomeExample } from './quickstarts'

/**
 * Playing a recorded program over its source (`components/core/CorePlayer.astro`).
 *
 * The page shows the program in the view the reader selected (Error handling
 * and Cleanup add lines and a call), and each view plays the steps whose call
 * it holds. A step's lines come from its anchor in that view, never from a
 * stored line number, so the recording does not change when the displayed
 * program is reformatted. The drawn tmux is `replayFrames`' own, the one the
 * MCP replay draws, fed the recording's states, with each pane's text as
 * the step's own `capture-pane` returned it.
 */

const RECORDINGS = import.meta.glob<CoreRecording>('../data/core-recordings/*.json', { import: 'default' })

/** The recording stored for a port, if any (vitest caches the transform by its text; a new file needs an edit to this line to be seen). */
export async function coreRecordingFor(port: string): Promise<CoreRecording | undefined> {
  return RECORDINGS[`../data/core-recordings/${port}.json`]?.()
}

/** One step as a view plays it: where it is in the recording, and its lines in that view's code. */
export interface PlayerStep {
  /** The step's place in the recording, which also numbers its frame (frame `index + 1`). */
  index: number
  lines: LineRange
}

/** The steps a view's code makes, in the order the program runs them. A step whose call the view does not hold is not played. */
export function viewSteps(capability: CoreCapability, code: string): PlayerStep[] {
  return capability.steps.flatMap((step, index): PlayerStep[] => {
    const lines = statementLines(code, step.anchor, '//', step.occurrence)
    return lines ? [{ index, lines }] : []
  })
}

/**
 * The recording a page may play: the one for `port` and `capability` if it is
 * sound and records the program the page displays. Anything else gives no
 * player, and the page keeps its plain example.
 */
export async function playableCapability(port: string, capability: string, program: string): Promise<{ recording: CoreRecording; capability: CoreCapability } | undefined> {
  const recording = await coreRecordingFor(port)
  const found = recording?.capabilities[capability]
  if (!recording || !found || recordingProblems({ ...recording, capabilities: { [capability]: found } }, { programs: { [capability]: program } }).length > 0) return undefined
  return { recording, capability: found }
}

/**
 * A capability's program as the example the player shows: one view, since
 * these programs have no Error handling or Cleanup to add, and no setup of
 * their own (the panel names the program's source and the command that runs it).
 */
export function capabilityExample(item: { code: string; lang: string; file: string; repository: string; revision: string }): HomeExample {
  const name = item.file.split('/').at(-1)!
  return {
    lang: item.lang, sourceRepository: item.repository, sourceRevision: item.revision, sourceTree: '', program: name,
    excerpt: { startLine: 1, endLine: item.code.split('\n').length, dedent: 0, importsEndLine: 0 },
    files: [{ name, lang: item.lang, code: item.code }], prerequisites: '', commands: [], expectedOutput: '',
    variants: { concise: item.code, errors: item.code, cleanup: item.code },
  }
}

/**
 * The frames of a recording, drawn by the MCP replay's own code: frame 0 is
 * tmux before the first call and frame `i` the state after step `i`. The
 * recording's calls are not tool calls, so no frame is a "reading" of tmux.
 */
export function coreFrames(capability: CoreCapability): Frame[] {
  const steps: ReplayStep[] = capability.steps.map((step) => ({ tool: step.label, arguments: {}, content: [], tmux: step.tmux }))
  const frames = replayFrames(steps, capability.tmuxBefore)
  // A pane shows the text tmux last returned for it, until a later capture of it returns other text.
  const texts = new Map<string, string>()
  capability.steps.forEach((step, index) => {
    for (const read of paneActivity(step).reads) if (read.text !== '') texts.set(read.pane, read.text)
    for (const window of frames[index + 1]!.sessions.flatMap((session) => session.windows)) {
      for (const pane of window.panes) if (pane.id && texts.has(pane.id)) pane.output = texts.get(pane.id)
    }
  })
  return frames
}

/** The pane a command names with `-t`, as tmux's `%N`, if its target names one. */
const paneTarget = (command: string): string | undefined => /(?:^|\s)-t\s+\S*?(%\d+)/.exec(command)?.[1]

/**
 * What a step's commands did to its panes' contents, which a tmux state does
 * not hold: the panes it sent keys to, pasted into or respawned, and the
 * panes it read, with the text tmux returned. A capture that starts below the
 * top of the screen (`-S` past 0) is part of a pane, not what it shows, so it
 * is not taken for the pane's text.
 */
export function paneActivity(step: CoreStep): { typed: string[]; ran: string[]; reads: { pane: string; text: string }[] } {
  const typed: string[] = []
  const ran: string[] = []
  const reads: { pane: string; text: string }[] = []
  for (const command of visibleCommands(step).commands) {
    // A command line can hold several commands joined by `;`, each with its own target. Its exit
    // status is the last one's, so a capture that returned text counts even when a later check failed.
    if (command.exit !== 0 && command.stdout === '') continue
    for (const part of command.tmux.split(/ ';' | \\; | ; /)) {
      const pane = paneTarget(part)
      if (!pane) continue
      const verb = /^\s*([a-z-]+)/.exec(part)?.[1]
      if (verb === 'send-keys' || verb === 'paste-buffer') typed.push(pane)
      else if (verb === 'respawn-pane') ran.push(pane)
      else if (verb === 'capture-pane') {
        const start = /(?:^|\s)-S\s+(\S+)/.exec(part)?.[1]
        if (start !== undefined && /^\d+$/.test(start) && Number(start) > 0) continue
        reads.push({ pane, text: command.stdout.replace(/\s+$/, '') })
      }
    }
  }
  return { typed: [...new Set(typed)], ran: [...new Set(ran)], reads }
}

/**
 * What a step changed, from its states and its commands: the structure
 * `tmuxChanges` reads from the states, then the panes whose contents the
 * commands touched. A pane the step removed again is not named.
 */
export function stepChanges(step: CoreStep, before: CoreStep['tmux']): { marks: TmuxMarks; phrases: string[] } {
  const { marks, phrases } = tmuxChanges(before, step.tmux)
  const present = new Set(step.tmux.panes.map((pane) => pane.id))
  const activity = paneActivity(step)
  const read = [...new Set(activity.reads.map((entry) => entry.pane))]
  for (const pane of activity.ran.filter((id) => present.has(id))) phrases.push(`ran a command in pane ${pane}`)
  for (const pane of activity.typed.filter((id) => present.has(id))) phrases.push(`sent keys to pane ${pane}`)
  for (const pane of read.filter((id) => present.has(id))) phrases.push(`read pane ${pane}`)
  marks.panes = [...new Set([...marks.panes, ...[...activity.ran, ...activity.typed, ...read].filter((id) => present.has(id))])]
  return { marks, phrases }
}

/** Where a window's panes are, from its layout: the layout string also marks the active pane, which is a selection, not a resize. */
const geometry = (layout: string): string => JSON.stringify(parseLayout(layout)?.panes.map(({ id, x, y, w, h }) => [id, x, y, w, h]) ?? layout)

/** What the drawing marks after a call: the windows it added, the panes it added or changed, the windows whose label changed, and the sessions it renamed. */
export interface TmuxMarks { windows: string[]; panes: string[]; labels: string[]; sessions: string[] }

/**
 * What a call changed in tmux, from the states before and after it: the
 * marks the drawing puts on what changed, and the changes as the note words
 * them: a pane or window made active is a selection, which is what an
 * attached client would see move. A window that arrives with its session, or a pane with its window,
 * is part of that addition rather than a change of its own.
 */
export function tmuxChanges(before: TmuxState, after: TmuxState): { marks: TmuxMarks; phrases: string[] } {
  const byId = <T extends { id: string }>(items: readonly T[]) => new Map(items.map((item) => [item.id, item]))
  const [sessionsBefore, windowsBefore, panesBefore] = [byId(before.sessions), byId(before.windows), byId(before.panes)]
  const [sessionsAfter, windowsAfter] = [byId(after.sessions), byId(after.windows)]
  const several = Math.max(before.sessions.length, after.sessions.length) > 1
  const label = (window: TmuxWindow) => `${several ? `${(sessionsAfter.get(window.session) ?? sessionsBefore.get(window.session))?.name}:` : ''}${window.index}:${window.name}`
  const marks: TmuxMarks = { windows: [], panes: [], labels: [], sessions: [] }
  const phrases: string[] = []
  for (const session of after.sessions) {
    const was = sessionsBefore.get(session.id)
    if (!was) phrases.push(`added session ${session.name}`)
    else if (was.name !== session.name) {
      phrases.push(`renamed session ${was.name} to ${session.name}`)
      marks.sessions.push(session.id)
    }
  }
  for (const session of before.sessions) if (!sessionsAfter.has(session.id)) phrases.push(`closed session ${session.name}`)
  for (const window of after.windows) {
    const was = windowsBefore.get(window.id)
    marks.windows.push(...(was ? [] : [window.id]))
    if (!was) { if (sessionsBefore.has(window.session)) phrases.push(`added window ${label(window)}`); continue }
    if (was.name !== window.name || was.index !== window.index) { phrases.push(`renamed window ${was.index}:${was.name} to ${label(window)}`); marks.labels.push(window.id) }
    if (window.active && !was.active) { phrases.push(`selected window ${label(window)}`); marks.labels.push(window.id) }
    const panes = after.panes.filter((pane) => pane.window === window.id)
    const added = panes.filter((pane) => !panesBefore.has(pane.id))
    for (const pane of added) phrases.push(`added pane ${pane.id} to window ${label(window)}`)
    for (const pane of panes) {
      const old = panesBefore.get(pane.id)
      if (old && old.command !== pane.command) phrases.push(`pane ${pane.id} now runs ${pane.command}`)
      if (old && pane.active && !old.active) phrases.push(`selected pane ${pane.id} in window ${label(window)}`)
    }
    const resized = added.length === 0 && geometry(was.layout) !== geometry(window.layout)
    if (resized) phrases.push(`changed the layout of window ${label(window)}`)
    marks.panes.push(...panes.filter((pane) => {
      const old = panesBefore.get(pane.id)
      return !old || old.command !== pane.command || (pane.active && !old.active) || resized
    }).map((pane) => pane.id))
  }
  for (const window of before.windows) if (!windowsAfter.has(window.id) && sessionsAfter.has(window.session)) phrases.push(`closed window ${label(window)}`)
  const panesAfter = byId(after.panes)
  for (const pane of before.panes) if (!panesAfter.has(pane.id) && windowsAfter.has(pane.window)) phrases.push(`closed pane ${pane.id}`)
  marks.labels = [...new Set(marks.labels)]
  return { marks, phrases }
}

/** What a step returned, as the page prints it. */
export const returnedText = (step: CoreStep): string => JSON.stringify(step.returned, null, 2)

/** The commands of a step a reader should see, and how many identity checks the library made before them. */
export function visibleCommands(step: CoreStep): { commands: CoreCommand[]; probes: number } {
  return { commands: step.commands.filter((command) => command.role === 'command'), probes: step.commands.filter((command) => command.role === 'probe').length }
}

/** A command as one line of the page: what was sent, and tmux's reply, or its refusal. */
export function replyText(command: CoreCommand): string {
  const text = (command.stdout || command.stderr).trimEnd()
  return text === '' ? (command.exit === 0 ? 'no output' : `exit ${command.exit}`) : text
}

/**
 * What the drawn tmux says about the call. A call that sent no command left
 * tmux as it was, and the note says so; otherwise it names what the call
 * added, closed, renamed or selected, which the drawing marks. A window tmux
 * held only while the call ran is named, since the picture after it does not
 * show one. Without a
 * session the picture is empty, so the note says whether the server has not
 * started or has exited.
 */
export function stepNote(step: CoreStep, before: CoreStep['tmux']): string {
  const { commands } = visibleCommands(step)
  const unchanged = JSON.stringify(step.tmux) === JSON.stringify(before)
  const running = step.tmux.sessions.length > 0
  const during = step.transient.length > 0
    ? ` tmux held ${step.transient.map((window) => `window ${window.window}`).join(' and ')} while the call ran and removed ${step.transient.length === 1 ? 'it' : 'them'} before it returned.`
    : ''
  if (!running) return `tmux after ${step.label}: ${before.sessions.length > 0 ? 'the server has exited' : 'no server is running'}${commands.length === 0 ? '; the call sent no command' : ''}.`
  if (commands.length === 0) return `tmux after ${step.label}: unchanged, the call sent no command.`
  const { phrases } = stepChanges(step, before)
  return `tmux after ${step.label}${phrases.length > 0 ? `: ${phrases.join('; ')}.` : unchanged ? ': unchanged.' : '.'}${during}`
}
