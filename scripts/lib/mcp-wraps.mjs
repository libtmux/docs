const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const wholeWord = (word) => new RegExp(`(?<![\\w])${escaped(word)}(?![\\w])`)

/** A call as it is written at a call site: the symbol's name without a signature's argument labels, as Swift's carry. */
export const callName = (symbol) => symbol.name.replace(/\(.*$/s, '')

/**
 * Problems with the library calls one port's MCP tools are recorded as making
 * (`site/src/data/mcp-wraps.json`), each judged at the revision it cites.
 *
 * A Wraps row says a tool makes a library call and links the line that makes
 * it, so the link has to land: the file exists at that revision, the line is
 * inside it, and the line names the call. The call is a library symbol of the
 * port's API model, not one of the server's own.
 *
 * Naming the call is the least a line can do, so this cannot tell a call from a
 * comment that mentions it. The entries are read from the source when they are
 * written; this catches the line that moves, or is wrong.
 *
 * @param {string} port
 * @param {{ revision: string, tools: Record<string, { call: string, source: string }> }} entry
 * @param {{ id: string, publicId?: string, name: string, product?: string }[]} symbols The port's API model symbols.
 * @param {(revision: string, file: string) => string | undefined} read The file's text at a revision, or undefined when the revision has no such file.
 * @returns {string[]}
 */
export function wrapsProblems(port, entry, symbols, read) {
  const library = new Map(symbols.filter((symbol) => (symbol.product ?? 'core') === 'core').map((symbol) => [symbol.publicId ?? symbol.id, symbol]))
  const at = entry.revision.slice(0, 9)
  return Object.entries(entry.tools).flatMap(([tool, { call, source }]) => {
    const cited = /^(.+):(\d+)$/.exec(source)
    if (!cited) return [`${port}: ${tool} cites "${source}", which is not path:line`]
    const [, file, number] = cited
    const line = Number(number)
    const symbol = library.get(call)
    if (!symbol) return [`${port}: ${tool} wraps ${call}, which is not a library symbol in the port's API model`]
    const text = read(entry.revision, file)
    if (text === undefined) return [`${port}: ${tool} cites ${file} at ${at}, which does not exist`]
    const lines = text.split('\n')
    if (line < 1 || line > lines.length) return [`${port}: ${tool} cites line ${line} of ${file} at ${at}, which has ${lines.length} lines`]
    return wholeWord(callName(symbol)).test(lines[line - 1]) ? [] : [`${port}: ${tool} cites ${file}#L${line} at ${at}, where ${callName(symbol)} is not called`]
  })
}
