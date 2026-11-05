import { statementLines, type LineRange } from './core-statement.ts'
import type { CoreCapability, CoreCommand, CoreRecording, CoreStep } from './core-recording.ts'
import { recordingProblems } from './core-recording.ts'
import { replayFrames, type Frame, type ReplayStep } from './mcp-replay'

/**
 * Playing a recorded program over its source (`components/core/CorePlayer.astro`).
 *
 * The page shows the program in the view the reader selected (Error handling
 * and Cleanup add lines and a call), and each view plays the steps whose call
 * it holds. A step's lines come from its anchor in that view, never from a
 * stored line number, so the recording does not change when the displayed
 * program is reformatted. The drawn tmux is `replayFrames`' own, the one the
 * MCP replay draws, fed the recording's states.
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
    const lines = statementLines(code, step.anchor)
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
  if (!recording || !found || recordingProblems(recording, { programs: { [capability]: program } }).length > 0) return undefined
  return { recording, capability: found }
}

/**
 * The frames of a recording, drawn by the MCP replay's own code: frame 0 is
 * tmux before the first call and frame `i` the state after step `i`. The
 * recording's calls are not tool calls, so no frame is a "reading" of tmux.
 */
export function coreFrames(capability: CoreCapability): Frame[] {
  const steps: ReplayStep[] = capability.steps.map((step) => ({ tool: step.label, arguments: {}, content: [], tmux: step.tmux }))
  return replayFrames(steps, capability.tmuxBefore)
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
 * tmux as it was, and the note says so; a window tmux held only while the call
 * ran is named, since the picture after it does not show one. Without a
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
  return `tmux after ${step.label}${unchanged ? ': unchanged.' : '.'}${during}`
}
