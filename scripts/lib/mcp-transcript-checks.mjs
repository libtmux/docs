import { basename } from 'node:path'
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
 * Each way of undoing one layer of encoding. JSON escapes stop at `\\`, `\/`,
 * `\"` and `\uXXXX`: `\n` and the like stay, because a command line holds
 * them and reading them as line breaks would turn `\nd` into a name.
 */
const DECODERS = [
  (text) => text.replace(/\\(?:u([0-9a-fA-F]{4})|(["\\/]))/g, (_match, hex, char) => (hex ? String.fromCharCode(Number.parseInt(hex, 16)) : char)),
  (text) => text.replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => { try { return decodeURIComponent(run) } catch { return run } }),
  // However many layers of JSON text put backslashes before a slash, it is one slash.
  (text) => text.replace(/\\+\//g, '/'),
]
const LAYERS = 6

/**
 * A text and what it reads as once layers of JSON escaping and percent-encoding
 * are removed, in any order and up to `LAYERS` deep: a server may write a path
 * as `\/tmp\/x`, a tool may carry it as `%2Ftmp%2Fx`, and a result that holds
 * JSON text holds it escaped once more.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function readings(text) {
  const seen = new Set([text])
  let frontier = [text]
  for (let layer = 0; layer < LAYERS && frontier.length > 0; layer++) {
    const next = []
    for (const value of frontier) {
      for (const decode of DECODERS) {
        const decoded = decode(value)
        if (!seen.has(decoded)) { seen.add(decoded); next.push(decoded) }
      }
    }
    frontier = next
  }
  return [...seen]
}

/**
 * What a text names that a recording must not: `places` (where it ran, found
 * as text anywhere), `components` (a name unique to the run, such as the
 * random directory of the sandbox, found as text anywhere) and `names` (who
 * ran it, found as a token or a quoted value, whatever their length). Each is
 * looked for in the text and in every reading of it (see `readings`), so a
 * path with escaped slashes or percent-encoded is found too.
 *
 * @param {string} text
 * @param {string[]} places
 * @param {string[]} [names]
 * @param {string[]} [components]
 * @returns {string[]}
 */
export function leaks(text, places, names = [], components = []) {
  const all = readings(text)
  return [
    ...places.filter((item) => item && all.some((reading) => reading.includes(item))),
    ...components.filter((item) => item && all.some((reading) => reading.includes(item))),
    ...names.filter((item) => item && all.some((reading) => token(item).test(reading))),
  ]
}

/** Strings read as JSON and the strings in them, how many layers deep a scan goes. */
const EMBEDDED_JSON = 4
/** An object with more string values than this is not paired up for `joinedPaths`. */
const JOINED_VALUES = 32

/** `directory` and `name` as one path. */
const joinPath = (directory, name) => `${directory.replace(/\/+$/, '')}/${name.replace(/^\/+/, '')}`

const jsonOf = (text) => {
  const start = text.trimStart()[0]
  if (start !== '{' && start !== '[') return undefined
  try { return JSON.parse(text) } catch { return undefined }
}

/**
 * What a recording names that it must not, found in its parsed values: every
 * string, key included, with the encodings `leaks` undoes, and the strings of
 * any JSON text held in a string, however many strings deep. Two sibling
 * string values (a directory and a name in one object, or two neighbouring
 * entries of a list) are also read as one path, so `{"dir":"/tmp","name":"x"}`
 * names `/tmp/x`.
 *
 * Limits: a path split over three or more values or over different objects,
 * and one written in another encoding (base64, HTML entities), is not found.
 * A `components` name is unique to the run, so it is found wherever it appears
 * in a string, which finds the sandbox in a split path.
 *
 * @param {unknown} value
 * @param {{ places: string[], names?: string[], components?: string[] }} options
 * @returns {string[]} each leaked item with where it was found
 */
export function recordingLeaks(value, { places, names = [], components = [] }) {
  const found = new Set()
  const check = (text, at) => { for (const item of leaks(text, places, names, components)) found.add(`${item} (${at})`) }
  const visit = (node, at, depth) => {
    if (typeof node === 'string') {
      check(node, at)
      if (depth < EMBEDDED_JSON) {
        for (const reading of readings(node)) {
          const parsed = jsonOf(reading)
          if (parsed !== undefined) visit(parsed, `${at} as JSON`, depth + 1)
        }
      }
      return
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${at}[${index}]`, depth))
      for (let index = 1; index < node.length; index++) {
        if (typeof node[index - 1] === 'string' && typeof node[index] === 'string' && node[index - 1] && node[index]) check(joinPath(node[index - 1], node[index]), `${at}[${index - 1}] and [${index}] as one path`)
      }
    } else if (node && typeof node === 'object') {
      const entries = Object.entries(node)
      for (const [key, item] of entries) {
        check(key, `${at}, key ${JSON.stringify(key)}`)
        visit(item, `${at}.${key}`, depth)
      }
      const strings = entries.filter(([, item]) => typeof item === 'string' && item)
      if (strings.length <= JOINED_VALUES) {
        for (const [first, directory] of strings) for (const [second, name] of strings) if (first !== second) check(joinPath(directory, name), `${at}.${first} and .${second} as one path`)
      }
    }
  }
  visit(value, '$', 0)
  return [...found]
}

/**
 * What a transcript names of the machine that recorded it. This is the one call
 * the recorder makes before it writes a file. The `contracts` are left out,
 * since those schemas come from the committed `tools/list` snapshot and never
 * carry session data, and their patterns hold backslashes that read as names.
 * The parsed values are scanned first, with every encoding undone
 * (`recordingLeaks`); the serialized text is scanned as well, with the same
 * readings, as a second layer for anything the walk does not reach.
 *
 * The sandbox is both named and recognised by its unique directory name, so a
 * path split into fields still names it.
 *
 * @param {Record<string, unknown>} transcript
 * @param {{ sandbox: string, sandboxReal?: string, home?: string, checkout?: string, listed?: string, user?: string, machine?: string }} host
 * @returns {string[]}
 */
export function hostLeaks(transcript, { sandbox, sandboxReal = sandbox, home, checkout, listed, user, machine }) {
  const places = [...new Set([sandbox, sandboxReal, home, checkout, listed].filter(Boolean))]
  const components = [...new Set([sandbox, sandboxReal].map((path) => basename(path)).filter(Boolean))]
  const names = [user, machine].filter(Boolean)
  const recorded = withoutContracts(transcript)
  return [
    ...recordingLeaks(recorded, { places, names, components }),
    ...leaks(JSON.stringify(recorded, null, 2), places, names, components).map((item) => `${item} (in the serialized text)`),
  ]
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
