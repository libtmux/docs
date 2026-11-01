const ID = /[$%@]\d+(?!\d)/g

/** The tmux ids (`$1`, `@2`, `%3`) in a value, as a set. */
export const idsIn = (value) => new Set(JSON.stringify(value).match(ID) ?? [])

/** What a recorded step answered, for searching: its text and its structured result. */
const answer = (step) => [step.content, step.structuredContent ?? null]

/**
 * The checks a recording must pass before it is written.
 *
 * Every step answered without an error. Every id a request names was returned,
 * as that exact id, by an earlier step. The step that ran the command printed
 * the expected text on its own word boundary and exited 0.
 *
 * @param {{ tool: string, arguments: unknown, isError: boolean, content: unknown[], structuredContent?: unknown }[]} steps
 * @param {{ port: string, runTool: string, expected: string[], present?: string[] }} options
 */
export function verifyRecording(steps, { port, runTool, expected, present = [] }) {
  const returned = new Set()
  for (const step of steps) {
    if (step.isError) throw new Error(`${port}: ${step.tool} returned an error: ${JSON.stringify(answer(step)).slice(0, 400)}`)
    for (const id of idsIn(step.arguments)) {
      if (!returned.has(id)) throw new Error(`${port}: ${step.tool} names ${id}, which no earlier result returned`)
    }
    for (const id of idsIn(answer(step))) returned.add(id)
  }
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

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A name as a token: not part of a longer word, path, option or file name. Short names such as `d` are matched too. */
const token = (name) => new RegExp(`(?<![\\w./-])${escapeRegExp(name)}(?![\\w./-])`, 'g')

/**
 * What a recording names that it must not: `places` (where it ran, found as
 * text anywhere) and `names` (who ran it, found as a token or a quoted value,
 * whatever their length, inside a string or inside JSON embedded in one).
 *
 * @param {string} text
 * @param {string[]} places
 * @param {string[]} [names]
 * @returns {string[]}
 */
export function leaks(text, places, names = []) {
  return [...places.filter((item) => item && text.includes(item)), ...names.filter((item) => item && token(item).test(text))]
}

/**
 * A recorded value with the host's marks replaced: each `[from, to]` of
 * `paths` wherever it occurs in a string, and each of `names` as a token,
 * inside embedded JSON too, becomes `alias`.
 *
 * @param {unknown} value
 * @param {{ paths?: [string, string][], names?: string[], alias?: string }} options
 * @returns {any}
 */
export function sanitize(value, { paths = [], names = [], alias = 'host' }) {
  if (typeof value === 'string') {
    const moved = paths.reduce((text, [from, to]) => text.replaceAll(from, to), value)
    return names.filter(Boolean).reduce((text, name) => text.replace(token(name), alias), moved)
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item, { paths, names, alias }))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item, { paths, names, alias })]))
  return value
}
