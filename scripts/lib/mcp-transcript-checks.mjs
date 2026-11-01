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
 * @param {{ port: string, runTool: string, expected: string }} options
 */
export function verifyRecording(steps, { port, runTool, expected }) {
  const returned = new Set()
  for (const step of steps) {
    if (step.isError) throw new Error(`${port}: ${step.tool} returned an error: ${JSON.stringify(answer(step)).slice(0, 400)}`)
    for (const id of idsIn(step.arguments)) {
      if (!returned.has(id)) throw new Error(`${port}: ${step.tool} names ${id}, which no earlier result returned`)
    }
    for (const id of idsIn(answer(step))) returned.add(id)
  }
  const run = steps.filter((step) => step.tool === runTool)
  if (run.length !== 1) throw new Error(`${port}: expected one ${runTool} step, found ${run.length}`)
  const result = run[0].structuredContent ?? {}
  const output = typeof result.output === 'string' ? result.output : ''
  if (!new RegExp(`\\b${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(output)) {
    throw new Error(`${port}: the ${runTool} output lacks "${expected}": ${output.slice(0, 300)}`)
  }
  const status = result.exitStatus ?? result.exit_status
  if (status !== 0) throw new Error(`${port}: the ${runTool} command exited ${status}`)
}

/** Text that must not appear in a recording: where it ran, or who ran it. */
export function leaks(text, forbidden) {
  // A name of under four characters would match ordinary text, so only the longer ones are searched for.
  return forbidden.filter((item) => item && item.length >= 4 && text.includes(item))
}
