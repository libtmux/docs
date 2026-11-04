import { hasState, recordingStateProblems } from '../../site/src/lib/mcp-tmux-state.ts'

const ID = /[$%@]\d+(?!\d)/g

/** The tmux ids (`$1`, `@2`, `%3`) in a value, as a set. */
export const idsIn = (value) => new Set(JSON.stringify(value).match(ID) ?? [])

/** What a recorded step answered, for searching: its text and its structured result. */
const answer = (step) => [step.content, step.structuredContent ?? null]

/**
 * A pane that a server described before its shell had started. tmux names the
 * forked child `tmux` and reports no path until the shell has replaced it, so
 * an answer built at that moment shows a command and a path no reader would
 * see a moment later. The recorder records again instead of keeping it.
 */
export class UnsettledPaneError extends Error {}

const PANE_ID = /^%\d+$/
const PANE_COMMAND = /^(?:command|currentCommand|pane_current_command)$/
const PANE_PATH = /^(?:path|cwd|currentPath|pane_current_path)$/

/** The objects in a structured answer that carry a pane id and the command that pane runs. */
function* panesIn(value) {
  if (!value || typeof value !== 'object') return
  if (!Array.isArray(value)) {
    const entries = Object.entries(value)
    const id = entries.find(([key, item]) => /^(?:id|pane_id|paneId)$/.test(key) && PANE_ID.test(String(item)))
    const command = entries.find(([key]) => PANE_COMMAND.test(key))
    if (id && command) yield { id: String(id[1]), command: command[1], path: entries.find(([key]) => PANE_PATH.test(key))?.[1] }
  }
  for (const item of Object.values(value)) yield* panesIn(item)
}

/**
 * Every pane a step described runs one of `commands` and, when it names a
 * path, names one.
 *
 * @param {{ tool: string, structuredContent?: unknown }[]} steps
 * @param {{ port: string, commands: string[] }} options
 * @throws {UnsettledPaneError}
 */
export function verifySettledPanes(steps, { port, commands }) {
  for (const step of steps) {
    for (const pane of panesIn(step.structuredContent)) {
      if (!commands.includes(pane.command) || pane.path === null || pane.path === '') {
        throw new UnsettledPaneError(`${port}: ${step.tool} described pane ${pane.id} with command ${JSON.stringify(pane.command)} and path ${pane.path === undefined ? 'none' : JSON.stringify(pane.path)}, before its shell had started (expected ${commands.join(' or ')} and a path)`)
      }
    }
  }
}

/**
 * The checks a recording must pass before it is written.
 *
 * Every step answered without an error. Every id a request names was returned,
 * as that exact id, by an earlier step. The step that ran the command printed
 * the expected text on its own word boundary and exited 0. With `commands`,
 * every pane an answer describes is also settled (see `verifySettledPanes`).
 * With `states`, every step and the start carry the tmux state the recorder
 * read, and those states describe the session the calls made (see
 * `recordingStateProblems`); without it a recording that carries states is
 * held to that, and one that carries none is not.
 *
 * @param {{ tool: string, arguments: unknown, isError: boolean, content: unknown[], structuredContent?: unknown, tmux?: unknown }[]} steps
 * @param {{ port: string, runTool: string, expected: string[], present?: string[], commands?: string[], before?: unknown, states?: boolean }} options
 */
export function verifyRecording(steps, { port, runTool, expected, present = [], commands, before, states = false }) {
  if (commands) verifySettledPanes(steps, { port, commands })
  const returned = new Set()
  for (const step of steps) {
    if (step.isError) throw new Error(`${port}: ${step.tool} returned an error: ${JSON.stringify(answer(step)).slice(0, 400)}`)
    for (const id of idsIn(step.arguments)) {
      if (!returned.has(id)) throw new Error(`${port}: ${step.tool} names ${id}, which no earlier result returned`)
    }
    for (const id of idsIn(answer(step))) returned.add(id)
  }
  if (states && !hasState({ tmuxBefore: before, steps })) throw new Error(`${port}: no tmux state was read`)
  const unstated = recordingStateProblems({ tmuxBefore: before, steps })
  if (unstated.length) throw new Error(`${port}: ${unstated.join('; ')}`)
  const lastAnswer = JSON.stringify(answer(steps.at(-1) ?? { content: [] }))
  for (const text of present) if (!lastAnswer.includes(text)) throw new Error(`${port}: the last answer lacks "${text}"`)
  const runs = steps.filter((step) => step.tool === runTool)
  if (runs.length !== expected.length) throw new Error(`${port}: expected ${expected.length} ${runTool} steps, found ${runs.length}`)
  runs.forEach((run, index) => {
    const result = run.structuredContent ?? {}
    // Servers name the pane's text `output` or `text`, and send a string, its lines, or an object with `lines`.
    const said = result.output ?? result.text
    const lines = Array.isArray(said) ? said : Array.isArray(said?.lines) ? said.lines : undefined
    const output = typeof said === 'string' ? said : lines ? lines.join('\n') : ''
    if (!new RegExp(`\\b${expected[index].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(output)) {
      throw new Error(`${port}: ${runTool} step ${index + 1} output lacks "${expected[index]}": ${output.slice(0, 300)}`)
    }
    const status = result.exitStatus ?? result.exit_status ?? result.exit_code
    if (status !== 0) throw new Error(`${port}: ${runTool} step ${index + 1} command exited ${status}`)
  })
}

/** A path as a server writes it inside JSON text when it escapes slashes, as Swift's does. */
const escapedSlashes = (text) => text.replaceAll('/', '\\/')

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A name as a token: not part of a longer word, path, option or file name. Short names such as `d` are matched too. */
const token = (name) => new RegExp(`(?<![\\w./-])${escapeRegExp(name)}(?![\\w./-])`, 'g')

/**
 * What a recording names that it must not: `places` (where it ran, found as
 * text anywhere, also with its slashes escaped as JSON text may have them) and `names` (who ran it, found as a token or a quoted value,
 * whatever their length, inside a string or inside JSON embedded in one).
 *
 * @param {string} text
 * @param {string[]} places
 * @param {string[]} [names]
 * @returns {string[]}
 */
export function leaks(text, places, names = []) {
  return [...places.filter((item) => item && (text.includes(item) || text.includes(escapedSlashes(item)))), ...names.filter((item) => item && token(item).test(text))]
}

/**
 * A recorded value with the host's marks replaced: each `[from, to]` of
 * `paths` wherever it occurs in a string, also with its slashes escaped, and each of `names` as a token,
 * inside embedded JSON too, becomes `alias`.
 *
 * @param {unknown} value
 * @param {{ paths?: [string, string][], names?: string[], alias?: string }} options
 * @returns {any}
 */
export function sanitize(value, { paths = [], names = [], alias = 'host' }) {
  if (typeof value === 'string') {
    const moved = paths.reduce((text, [from, to]) => text.replaceAll(from, to).replaceAll(escapedSlashes(from), escapedSlashes(to)), value)
    return names.filter(Boolean).reduce((text, name) => text.replace(token(name), alias), moved)
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item, { paths, names, alias }))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item, { paths, names, alias })]))
  return value
}

/** A transcript without `contracts`, which the host check skips: those schemas come from the committed `tools/list` snapshot and never carry session data. */
export const withoutContracts = (transcript) => Object.fromEntries(Object.entries(transcript).filter(([key]) => key !== 'contracts'))
