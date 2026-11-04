const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const wholeWord = (word) => new RegExp(`(?<![\\w-])${escaped(word)}(?![\\w-])`)

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
 * wire name has to be written as a whole word in that registration.
 *
 * A registration reaches from its cited line to the first line that names its
 * tool. Another tool's registration is not this one's, so no two reaches in a
 * file may share a line: a tool that cites its neighbour's line, or a line
 * above the neighbour's name, or that names itself only after the next
 * registration begins, overlaps it. The reach is read from the file, not from
 * the neighbour's citation, so moving one citation cannot stretch it into the
 * next.
 *
 * A line in a neighbour's body, past the line that names it, cannot be told
 * from the start of this registration by text alone, and is not refused.
 *
 * @param {string} port
 * @param {{ name: string, wireName: string, source: { revision: string, file: string, line?: number } }[]} registrations
 * @param {(revision: string, file: string) => string | undefined} read The file's text at a revision, or undefined when the revision has no such file.
 * @returns {string[]}
 */
export function registrationLinkProblems(port, registrations, read) {
  const texts = new Map()
  const judged = registrations.map(({ name, wireName, source: { revision, file, line } }) => {
    const key = `${revision}:${file}`
    if (!texts.has(key)) texts.set(key, read(revision, file))
    const text = texts.get(key)
    const at = revision.slice(0, 9)
    const where = { name, key, file, line, at }
    if (text === undefined) return { ...where, problem: missing(port, name, file, revision) }
    const lines = text.split('\n')
    if (line === undefined) {
      // The generator keeps no line for a registration the revision does not hold.
      return { ...where, problem: `${port}: ${name} cites ${file} at ${at} with no line, where ${wireName} is not registered` }
    }
    if (!Number.isInteger(line) || line < 1 || line > lines.length) {
      return { ...where, problem: `${port}: ${name} cites line ${line} of ${file} at ${at}, which has ${lines.length} lines` }
    }
    const named = wholeWord(wireName)
    const offset = lines.slice(line - 1).findIndex((candidate) => named.test(candidate))
    if (offset < 0) return { ...where, problem: `${port}: ${name} cites ${file}#L${line} at ${at}, where ${wireName} is not registered` }
    return { ...where, last: line + offset }
  })
  const problems = judged.flatMap((entry) => entry.problem ? [entry.problem] : [])
  judged.forEach((first, index) => {
    if (first.last === undefined) return
    for (const second of judged.slice(index + 1)) {
      if (second.last === undefined || second.key !== first.key || first.line > second.last || second.line > first.last) continue
      problems.push(`${port}: ${first.name} (${first.file}#L${first.line} to L${first.last}) and ${second.name} (L${second.line} to L${second.last}) cite overlapping registrations at ${first.at}`)
    }
  })
  return problems
}
