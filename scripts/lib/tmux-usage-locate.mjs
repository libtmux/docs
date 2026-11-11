/**
 * Find a cited line by what it says.
 *
 * A reviewed rule cites `file`, or `file:line`, with the text the cited line holds. The text is the
 * citation and the line is where it happens to sit in one revision, so a port change that adds a line
 * above it must not break the rule. The line is looked up in the source being built, and the line
 * found is what the generated data records and the pages link.
 *
 * A stored `:line` is kept only to choose between several lines that all hold the text; it is not
 * read when the text is on exactly one line. `has[0]` must be on the cited line and the others within
 * its next `span` lines, as a claim has always said. A citation whose text is on several lines names
 * the function around it with `within`, and a claim names its symbol with `in`; either limits the
 * search to that body, and the text must then be on exactly one line of it.
 */

/** The file and the stored line of a citation, which has no line when it names the file alone. */
export const splitCitation = (at) => {
  const colon = at.lastIndexOf(':')
  return colon > 0 && /^\d+$/.test(at.slice(colon + 1)) ? { file: at.slice(0, colon), line: Number(at.slice(colon + 1)) } : { file: at, line: undefined }
}

/**
 * The lines a citation must be on: the body of the function it names with `within`, inside `ranges` when
 * those are given, or `ranges` alone, or anywhere.
 *
 * @param {{ at: string, within?: string }} item
 * @param {{ file: string, name: string, start: number, end: number }[]} functions
 * @param {{ start: number, end: number }[] | undefined} ranges
 */
export function rangesOf(item, functions, ranges) {
  if (item.within === undefined) return ranges
  const { file } = splitCitation(item.at)
  const named = functions.filter((fn) => fn.file === file && fn.name === item.within)
  if (!ranges) return named
  return named.flatMap((fn) => ranges.flatMap((range) => (Math.max(fn.start, range.start) <= Math.min(fn.end, range.end) ? [{ start: Math.max(fn.start, range.start), end: Math.min(fn.end, range.end) }] : [])))
}

/**
 * @param {{ at: string, has?: string[], span?: number }} item
 * @param {string | undefined} text the file at the revision being built
 * @param {{ start: number, end: number }[]} [ranges] the lines the citation must be in, or anywhere when absent
 * @param {string} [scope] what the ranges are the body of, for the message
 * @returns {{ at: string } | { problem: string }}
 */
export function locate(item, text, ranges, scope) {
  const { file, line: stored } = splitCitation(item.at)
  if (text === undefined) return { problem: `${file} is not a file of the pinned source` }
  const lines = text.split('\n')
  const needles = item.has ?? []
  const holds = (number) => {
    const first = lines[number - 1]
    if (first === undefined) return false
    if (!needles.length) return true
    const statement = lines.slice(number - 1, number - 1 + (item.span ?? 1)).join('\n')
    return needles.every((needle, position) => (position === 0 ? first : statement).includes(needle))
  }
  let all
  if (needles.length) all = lines.flatMap((_, index) => (holds(index + 1) ? [index + 1] : []))
  else if (stored === undefined) return { problem: `${item.at} cites no line and no text to find it by` }
  else all = lines[stored - 1] === undefined ? [] : [stored]
  const inside = ranges ? all.filter((number) => ranges.some((range) => range.start <= number && number <= range.end)) : all
  if (!inside.length) {
    if (!all.length) {
      if (!needles.length) return { problem: `${item.at} is not a line of the pinned source` }
      // The first text may be on lines that do not hold the rest; the text that is missing there is the one to name.
      const start = lines.findIndex((entry) => entry.includes(needles[0]))
      const statement = lines.slice(start, start + (item.span ?? 1)).join('\n')
      const missing = start < 0 ? needles[0] : needles.find((needle, position) => position > 0 && !statement.includes(needle)) ?? needles[0]
      return { problem: `${item.at} does not contain ${JSON.stringify(missing)}` }
    }
    return { problem: `${item.at} is outside the body of ${scope ?? `${item.within}`}: its text is on ${all.map((number) => `${file}:${number}`).join(', ')}` }
  }
  const chosen = inside.length === 1 ? inside[0] : inside.find((number) => number === stored)
  if (chosen === undefined) {
    return { problem: `${item.at} matches ${inside.length} lines (${inside.slice(0, 5).map((number) => number).join(', ')}${inside.length > 5 ? ', ...' : ''}) and its stored line is none of them; cite more text, or name the function around it with "within"` }
  }
  return { at: `${file}:${chosen}`, moved: stored === undefined ? undefined : chosen - stored }
}

/**
 * The rules with every citation in them located in the source at hand. A rule with a citation that
 * cannot be located is left out and reported once, under the label of the rule.
 *
 * @param {object[]} rules
 * @param {{ readSource: (path: string) => string | undefined, label: (rule: object) => string, functions?: { file: string, name: string, start: number, end: number }[] }} input
 * @returns {{ rules: object[], problems: string[] }}
 */
export function locateRules(rules, { readSource, label, functions = [] }) {
  const problems = []
  const resolve = (node, fail) => {
    if (Array.isArray(node)) return node.map((entry) => resolve(entry, fail))
    if (!node || typeof node !== 'object') return node
    const copy = { ...node }
    if (typeof node.at === 'string') {
      const result = locate(node, readSource(splitCitation(node.at).file), node.within === undefined ? undefined : rangesOf(node, functions), node.within)
      if ('problem' in result) fail(result.problem)
      else {
        copy.at = result.at
        // A line the condition reads through follows its start, for a function that kept its length.
        if (typeof node.through === 'number' && result.moved) copy.through = node.through + result.moved
      }
    }
    for (const key of Object.keys(node)) if (key !== 'at' && Array.isArray(node[key])) copy[key] = resolve(node[key], fail)
    return copy
  }
  const kept = []
  for (const rule of rules) {
    let broken = false
    const located = resolve(rule, (problem) => { broken = true; problems.push(`${label(rule)}: ${problem}`) })
    if (!broken) kept.push(located)
  }
  return { rules: kept, problems }
}
