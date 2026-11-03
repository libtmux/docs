const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const missing = (port, name, file, revision) => `${port}: ${name} cites ${file} at ${revision.slice(0, 9)}, which does not exist`

/**
 * Problems with the files one port's MCP registrations cite, judged against the
 * file list its API model committed for a revision. This needs no checkout, so
 * it runs wherever the tests do. A registration at another revision than the
 * list's cannot be judged from it; `registrationLinkProblems` reads those from
 * a checkout.
 *
 * @param {string} port
 * @param {{ name: string, source: { revision: string, file: string } }[]} registrations
 * @param {{ revision: string, paths: ReadonlySet<string> }} tree
 * @returns {string[]}
 */
export function registrationFileProblems(port, registrations, tree) {
  return registrations
    .filter(({ source }) => source.revision === tree.revision && !tree.paths.has(source.file))
    .map(({ name, source }) => missing(port, name, source.file, source.revision))
}

/**
 * Problems with the source links of one port's MCP registrations, each read at
 * the revision it cites. A tool page links `file#Lline` at that revision, so
 * the file has to exist there, the line has to be inside it, and the tool's
 * wire name has to be written as a whole word in that registration: from the
 * cited line up to the line the file's next registration cites. Another
 * tool's registration is not this one's.
 *
 * @param {string} port
 * @param {{ name: string, wireName: string, source: { revision: string, file: string, line?: number } }[]} registrations
 * @param {(revision: string, file: string) => string | undefined} read The file's text at a revision, or undefined when the revision has no such file.
 * @returns {string[]}
 */
export function registrationLinkProblems(port, registrations, read) {
  const problems = []
  const texts = new Map()
  const starts = new Map()
  for (const { source: { revision, file, line } } of registrations) {
    const key = `${revision}:${file}`
    if (Number.isInteger(line)) starts.set(key, [...(starts.get(key) ?? []), line])
  }
  for (const { name, wireName, source: { revision, file, line } } of registrations) {
    const key = `${revision}:${file}`
    if (!texts.has(key)) texts.set(key, read(revision, file))
    const text = texts.get(key)
    const at = revision.slice(0, 9)
    if (text === undefined) {
      problems.push(missing(port, name, file, revision))
      continue
    }
    const lines = text.split('\n')
    if (line === undefined) {
      // The generator keeps no line for a registration the revision does not hold.
      problems.push(`${port}: ${name} cites ${file} at ${at} with no line, where ${wireName} is not registered`)
      continue
    }
    if (!Number.isInteger(line) || line < 1 || line > lines.length) {
      problems.push(`${port}: ${name} cites line ${line} of ${file} at ${at}, which has ${lines.length} lines`)
      continue
    }
    const next = Math.min(lines.length + 1, ...(starts.get(key) ?? []).filter((start) => start > line))
    const named = new RegExp(`(?<![\\w-])${escaped(wireName)}(?![\\w-])`)
    if (!named.test(lines.slice(line - 1, next - 1).join('\n'))) {
      problems.push(`${port}: ${name} cites ${file}#L${line} at ${at}, where ${wireName} is not registered`)
    }
  }
  return problems
}
