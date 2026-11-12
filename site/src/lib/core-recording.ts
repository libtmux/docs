import { createHash } from 'node:crypto'
import { statementLines, syntaxOf } from './core-statement.ts'
import { stateProblems, type TmuxState } from './mcp-tmux-state.ts'

/**
 * A port's landing-page program recorded call by call
 * (`scripts/gen-core-recording.mjs`, stored in `data/core-recordings/<port>.json`).
 *
 * Each step is one API call of the program: the lines that make it, what it
 * returned, the tmux commands the library sent for it with tmux's replies, and
 * the state of the recording's own tmux server once it had returned. The page
 * plays the steps over the program's source (`lib/core-player.ts`), and
 * `recordingProblems` is the check both the recorder and the page's tests
 * hold a recording to, so a recording the recorder would refuse is not drawn.
 */

/** One tmux invocation a call made. */
export interface CoreCommand {
  /**
   * A `command` is what the library asked tmux to do. A `probe` only asks
   * tmux who it is (a version query) before the library sends a command; its
   * reply names the daemon's process and start time, so none is kept.
   */
  role: 'command' | 'probe'
  /** The command as tmux reads it, without the library's own guard, or a probe's flags. */
  tmux: string
  /** Whether the command can change what the server holds, by its name. */
  mutates: boolean
  exit: number
  stdout: string
  stderr: string
  /** Set when `stdout` or `stderr` was cut; the recording keeps the start. */
  shortened?: true
}

export interface CoreStep {
  id: string
  /** The call as the page names it, such as `Server.NewSession`. */
  label: string
  /** The text of the call's first line in the program; the page finds its lines from it (`statementLines`). */
  anchor: string
  /** Which of the lines that hold the anchor, when the program makes the same call on several (one-based). */
  occurrence?: number
  /** Set on a call that ran more than once, such as one in a loop: this run of it (one-based). Every run is a step of its own, anchored on the same line. */
  iteration?: number
  /** The type of what the call returned. */
  type: string
  /** What it returned, as the recorder's marker encoded it as JSON. */
  returned: unknown
  commands: CoreCommand[]
  /** What tmux sent unasked while the call ran, as control-mode notification lines. */
  notifications?: string[]
  /** Windows tmux held while the call ran and no longer holds when it returned. */
  transient: { window: string; name: string }[]
  /** Set on a call that ended the server without sending a tmux command: whoever owns the daemon stopped it by its process id. */
  stopsServer?: true
  /** The recording's tmux server once the call had returned. */
  tmux: TmuxState
}

export interface CoreCapability {
  /** The program that was run, and the hash of the bytes the page displays for it. */
  program: { file: string; sha256: string }
  /** The revision of the library this program was built against, when it is not the recording's. */
  revision?: string
  /** `hand-written` when a person mapped the calls of the program to anchors and returned values. */
  stepMap: 'hand-written' | 'generated'
  /** What the displayed program printed. */
  printed: string[]
  tmuxBefore: TmuxState
  /** In the order the calls ran. */
  steps: CoreStep[]
}

export interface CoreRecording {
  generated: string
  port: string
  repo: string
  /** The revision of the library the program was built against. */
  revision: string
  sandbox: { tmux: string; go?: string; shell: string; rewritten: Record<string, string> }
  capabilities: Record<string, CoreCapability>
}

const ID = /[$%@]\d+(?!\d)/g
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const idsIn = (value: unknown) => new Set(JSON.stringify(value ?? null).match(ID) ?? [])
const stateKey = (state: TmuxState) => JSON.stringify(state)

/** SHA-256 of the program's text, as the recorder writes it. */
export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/**
 * What is wrong with a recording, empty when nothing is.
 *
 * Every state is one tmux can be in (`stateProblems`). Every step names a call
 * that is on exactly one line of the program, once, and has the commands that
 * call sent. A state that differs from the one before it needs a command that
 * can change tmux, or a step that says its owner stopped the daemon by its
 * process id, so a state read late or from another server is caught. The
 * ids a call returned are in tmux after it or in the commands it sent.
 *
 * With `programs` (the displayed program by capability), the recording must
 * be of that program: its hash is compared and every anchor is looked up in it.
 */
export function recordingProblems(recording: unknown, { programs }: { programs?: Record<string, string> } = {}): string[] {
  if (!isRecord(recording) || !isRecord(recording.capabilities)) return ['has no capabilities']
  const problems: string[] = []
  const syntax = syntaxOf(typeof recording.port === 'string' ? recording.port : undefined)
  for (const [id, value] of Object.entries(recording.capabilities)) {
    const at = (text: string) => `${id}: ${text}`
    const capability = value as Partial<CoreCapability>
    if (!capability.program?.file || !/^[0-9a-f]{64}$/.test(capability.program.sha256 ?? '')) problems.push(at('names no program or no hash of it'))
    if (capability.stepMap !== 'hand-written' && capability.stepMap !== 'generated') problems.push(at('does not say whether its step map was written by hand'))
    if (!Array.isArray(capability.printed) || capability.printed.some((line) => typeof line !== 'string')) problems.push(at('does not state what the program printed'))
    const program = programs?.[id]
    if (program !== undefined && capability.program?.sha256 !== sha256(program)) problems.push(at('is of a different program than the one displayed'))
    const steps = capability.steps
    if (!Array.isArray(steps) || steps.length === 0) { problems.push(at('has no steps')); continue }
    const before = stateProblems(capability.tmuxBefore)
    before.forEach((problem) => problems.push(at(`before the first call: ${problem}`)))
    let previous = capability.tmuxBefore as TmuxState
    const seen = new Set<string>()
    const runs = new Map<string, number>()
    steps.forEach((step, index) => {
      const here = (text: string) => at(`step ${index + 1} (${step.label ?? step.id}): ${text}`)
      if (!step.id || seen.has(step.id)) problems.push(here('has no unique id'))
      seen.add(step.id)
      if (!step.label || !step.type) problems.push(here('has no label or no type'))
      if (!('returned' in step)) problems.push(here('records no returned value'))
      if (program !== undefined) {
        if (!step.anchor || !statementLines(program, step.anchor, syntax, step.occurrence)) problems.push(here(`its anchor ${JSON.stringify(step.anchor)} is not on exactly one line of the program`))
      } else if (!step.anchor) problems.push(here('has no anchor'))
      // A call shares its line with its other runs only when it says it ran more than once, and the runs count up from one.
      const place = `${step.anchor}#${step.occurrence ?? ''}`
      const earlier = runs.get(place) ?? 0
      if (step.iteration === undefined ? earlier > 0 : step.iteration !== earlier + 1) problems.push(here(step.iteration === undefined ? 'shares its line with another step but does not say it is a repeated call' : `is run ${step.iteration} of its call, after ${earlier}`))
      runs.set(place, earlier + 1)
      if (!Array.isArray(step.commands)) { problems.push(here('lists no commands')); return }
      for (const command of step.commands) {
        const ok = (command.role === 'command' || command.role === 'probe') && typeof command.tmux === 'string' && command.tmux !== '' && typeof command.mutates === 'boolean'
          && Number.isInteger(command.exit) && typeof command.stdout === 'string' && typeof command.stderr === 'string'
        if (!ok) problems.push(here(`has a command that is not recorded whole: ${JSON.stringify(command)}`))
      }
      const state = stateProblems(step.tmux)
      state.forEach((problem) => problems.push(here(`its state: ${problem}`)))
      if (state.length > 0) return
      const changed = stateKey(step.tmux) !== stateKey(previous)
      // A call that stops the daemon by its process id sends no command; it must say so, and leave no session.
      const stopped = step.stopsServer === true && step.tmux.sessions.length === 0 && previous.sessions.length > 0
      if (step.stopsServer !== undefined && !stopped) problems.push(here('says it stopped the server, but the server was not running before it or still holds a session'))
      if (changed && !stopped && !step.commands.some((command) => command.role === 'command' && command.mutates)) problems.push(here('tmux changed, but no command the call sent can change it'))
      const named = new Set([...idsIn(step.tmux), ...idsIn(step.commands.map((command) => command.tmux))])
      for (const returned of idsIn(step.returned)) if (!named.has(returned)) problems.push(here(`it returned ${returned}, which tmux does not hold after the call and no command of the call names`))
      previous = step.tmux
    })
  }
  return problems
}
