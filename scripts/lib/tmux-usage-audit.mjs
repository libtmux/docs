/**
 * Read back every line a usage entry cites, at the revision the entry says it cites it at.
 *
 * Generation builds the lines from one scan, so a mistake in that scan comes out looking consistent: a wrapper
 * that stands on a core library read at another revision cites core lines that read differently where the
 * wrapper is pinned, and regenerating reproduces them. This audit starts from the entries as committed and asks
 * the source instead. Each cited line must exist at the revision named for it, and must say what the entry
 * claims of it:
 *
 * - a scanned entry cites a line that spells the command, and each later line calls the function around the
 *   line before it;
 * - a reviewed entry cites the lines its claim names, holding the text the claim says they hold;
 * - a forwarded entry cites a line that calls the core method, and its `via` is audited at the revision it
 *   names, as an entry of the core library;
 * - no entry's first line reports a failure: a `throw`, an error constructor or a `failed(...)` call spells a
 *   command to describe what went wrong with it, and sends nothing. A reviewed entry's first line is not a
 *   builder that only binds the command to a name either, because a claim is read for the line that sends.
 */
import { bareName } from './tmux-usage-derive.mjs'

const split = (cite) => {
  const colon = cite.lastIndexOf(':')
  return { file: cite.slice(0, colon), line: Number(cite.slice(colon + 1)) }
}

/** A line that throws or builds an error names a command to say it failed. */
export const REPORTS_FAILURE = /\b(?:throw|raise|panic!)\b|\bThrowIf\w*\(|\bErr\(|\w[Ee]rror\s*\(|\bfail(?:ed)?\s*\(|\b[Ff]ailure\s*\(|\bException\s*\(/

/**
 * A statement that keeps a command in a variable, or a continuation that applies a scope to one, runs nothing. It
 * is the line to cite when the function only builds the command for its caller to send, and the wrong one when the
 * same function goes on to send it: `run(...)` or `execute(...)` a few lines later is the line that sends.
 */
export const BINDS_ONLY = /^(?:let|var|val|const)\b[^=]*=\s*(?:[\w.]+\()?\s*Command::new\(|^\.apply\(Command::new\(/
const DISPATCHERS = new Set(['run', 'mutate', 'cmd', 'execute', 'send', 'dispatch', 'dispatch_without_deadline'])

/**
 * @typedef {{ symbol: string, command: string, scope: string | null, evidence: string[], reviewed?: boolean,
 *   via?: { port: string, symbol: string, revision: string, evidence: string[], reviewed?: boolean } }} Use
 * @typedef {{ read: (path: string) => string | undefined, functions: { file: string, name: string, start: number, end: number, calls: Map<string, number> }[] }} Sources
 *
 * @param {{
 *   port: string,
 *   revision: string,
 *   uses: Use[],
 *   claimFor: (port: string, symbol: string, command: string, scope: string | null, revision: string) => { evidence: { at: string, has?: string[], span?: number }[] } | undefined,
 *   sourcesAt: (port: string, revision: string) => Sources | undefined,
 *   spellings: (command: string) => string[],
 *   generated?: { evidence: string[] },
 * }} input `generated` is the evidence a generated wrapper's entries open with, which names the generator and not a call.
 * @returns {string[]}
 */
export function auditEvidence({ port, revision, uses, claimFor, sourcesAt, spellings, generated }) {
  const problems = []
  const enclosing = (sources, file, line) => sources.functions
    .filter((fn) => fn.file === file && fn.start <= line && line <= fn.end)
    .sort((a, b) => b.start - a.start)[0]

  /** Audit one chain of cited lines as an entry of `at`; `label` names what is being audited. */
  const chain = ({ label, at, atRevision, use, ownGenerated }) => {
    const sources = sourcesAt(at, atRevision)
    if (!sources) { problems.push(`${label}: no scan of ${at} at ${atRevision.slice(0, 8)} to read the cited lines from`); return }
    const texts = []
    for (const cite of use.evidence) {
      const { file, line } = split(cite)
      const text = sources.read(file)?.split('\n')[line - 1]
      if (text === undefined || !text.trim()) problems.push(`${label}: ${cite} is not a line of ${at} at ${atRevision.slice(0, 8)}`)
      texts.push(text)
    }
    if (texts.some((text) => text === undefined || !text.trim())) return
    if (ownGenerated) {
      // A generated wrapper opens with the generator's own lines and ends at the annotation that makes it forward.
      if (!/@Operation\b/.test(texts.at(-1))) problems.push(`${label}: ${use.evidence.at(-1)} is not the @Operation annotation of the core method: ${texts.at(-1).trim().slice(0, 90)}`)
      return
    }

    if (REPORTS_FAILURE.test(texts[0]) && !use.reviewed) {
      problems.push(`${label}: ${use.evidence[0]} reports a failure and sends nothing: ${texts[0].trim().slice(0, 90)}`)
    }
    if (use.reviewed) {
      const claim = claimFor(at, use.symbol, use.command, use.scope, atRevision)
      if (!claim) problems.push(`${label}: reviewed, but no claim of ${at} holds it at ${atRevision.slice(0, 8)}`)
      else {
        claim.evidence.forEach((item, index) => {
          const { line } = split(item.at)
          if (item.at !== use.evidence[index]) { problems.push(`${label}: cites ${use.evidence[index]} where its claim cites ${item.at}`); return }
          const lines = sources.read(split(item.at).file).split('\n')
          const statement = lines.slice(line - 1, line - 1 + (item.span ?? 1)).join('\n')
          for (const [position, needle] of (item.has ?? []).entries()) {
            if (!(position === 0 ? lines[line - 1] : statement).includes(needle)) problems.push(`${label}: ${item.at} does not contain ${JSON.stringify(needle)}`)
          }
        })
      }
      const { file: firstFile, line: firstLine } = split(use.evidence[0])
      const builder = enclosing(sources, firstFile, firstLine)
      if (BINDS_ONLY.test(texts[0].trim()) && builder && [...builder.calls.keys()].some((name) => DISPATCHERS.has(name))) {
        problems.push(`${label}: ${use.evidence[0]} only binds the command to a name in ${builder.name}, which goes on to send it; cite the line that sends it: ${texts[0].trim().slice(0, 90)}`)
      }
      if (REPORTS_FAILURE.test(texts[0])) problems.push(`${label}: ${use.evidence[0]} reports a failure and sends nothing: ${texts[0].trim().slice(0, 90)}`)
    } else if (use.via) {
      // A wrapper's own line calls the core method by name.
      if (!texts.at(-1).includes(bareName(use.via.symbol))) {
        problems.push(`${label}: ${use.evidence.at(-1)} does not call ${bareName(use.via.symbol)}: ${texts.at(-1).trim().slice(0, 90)}`)
      }
    } else {
      const spelled = spellings(use.command)
      const dollar = at === 'julia' && /\$\w+/.test(texts[0])
      if (!dollar && !spelled.some((spelling) => texts[0].includes(spelling))) {
        problems.push(`${label}: ${use.evidence[0]} does not spell ${use.command}: ${texts[0].trim().slice(0, 90)}`)
      }
      for (let index = 1; index < texts.length; index++) {
        const { file, line } = split(use.evidence[index - 1])
        const fn = enclosing(sources, file, line)
        if (!fn) problems.push(`${label}: ${use.evidence[index - 1]} is in no function, so ${use.evidence[index]} calls nothing`)
        else if (!texts[index].includes(bareName(fn.name))) {
          problems.push(`${label}: ${use.evidence[index]} does not call ${fn.name}, the function around ${use.evidence[index - 1]}: ${texts[index].trim().slice(0, 90)}`)
        }
      }
    }
  }

  for (const use of uses) {
    const label = `${port}: ${use.symbol} ${use.command}${use.scope ? ` ${use.scope}` : ''}`
    const ownGenerated = Boolean(generated && use.via && generated.evidence.every((cite, index) => use.evidence[index] === cite))
    chain({ label, at: port, atRevision: revision, use, ownGenerated })
    if (use.via) {
      if (!use.via.revision) problems.push(`${label}: its via names no revision`)
      else {
        chain({
          label: `${label} (via ${use.via.port} ${use.via.symbol})`, at: use.via.port, atRevision: use.via.revision,
          use: { symbol: use.via.symbol, command: use.command, scope: use.scope, evidence: use.via.evidence, reviewed: use.via.reviewed },
        })
      }
    }
  }
  return problems
}
