import type { DocBlock, Param, Signature } from '../model.ts'

/**
 * Parse a Python docstring into the model's doc fields.
 *
 * libtmux-python writes NumPy-style docstrings, which is what `napoleon`
 * converts to reST field lists before autodoc renders them. Supporting the
 * NumPy form plus reST's own `:param x:` covers this project; Google style is
 * deliberately not implemented rather than half-implemented, because a parser
 * that recognises a heading it cannot fill produces an empty field list, which
 * renders as a heading with nothing under it.
 */

/** Strip the quotes and the common indentation, PEP 257 style. */
export function dedentDocstring(raw: string): string {
  let s = raw.replace(/^[rbuRBU]*("""|'''|"|')/, '')
  s = s.replace(/("""|'''|"|')\s*$/, '')
  const lines = s.split('\n')
  const rest = lines.slice(1).filter((l) => l.trim())
  const indent = rest.length
    ? Math.min(...rest.map((l) => l.length - l.trimStart().length))
    : 0
  return [lines[0]?.trim() ?? '', ...lines.slice(1).map((l) => l.slice(indent))]
    .join('\n')
    .trim()
}

const SECTION =
  /^(Parameters|Returns|Yields|Raises|Examples|See Also|Notes|Warnings|References|Attributes|Other Parameters|Warns)\s*$/

/**
 * Split a NumPy docstring into its underlined sections.
 *
 * A heading only counts when the next line underlines it with dashes — the
 * word "Returns" appears in prose often enough that matching the word alone
 * silently truncates a summary.
 */
function sections(text: string): { intro: string; named: Map<string, string[]> } {
  const lines = text.split('\n')
  const named = new Map<string, string[]>()
  const intro: string[] = []
  let current: string[] | undefined
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    const underlined = SECTION.test(line) && /^-{3,}\s*$/.test((lines[i + 1] ?? '').trim())
    if (underlined) {
      current = []
      named.set(line, current)
      i++
      continue
    }
    ;(current ?? intro).push(lines[i])
  }
  return { intro: intro.join('\n').trim(), named }
}

/** reST literal blocks and doctests become Markdown without moving their prose. */
export function pythonDocBody(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  const fence = (code: string[], lang: string, indent = '') => {
    const body = code.join('\n').replace(/\n+$/, '')
    const ticks = '`'.repeat(Math.max(3, ...[...body.matchAll(/`+/g)].map((m) => m[0].length + 1)))
    out.push('', `${indent}${ticks}${lang}`, body.split('\n').map((line) => `${indent}${line}`).join('\n'), `${indent}${ticks}`, '')
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Already-normalized fences can contain directive and prompt spellings.
    const existing = /^\s*(`{3,}|~{3,})/.exec(line)
    if (existing) {
      out.push(line)
      while (++i < lines.length) {
        out.push(lines[i])
        if (new RegExp(`^\\s*${existing[1][0]}{${existing[1].length},}\\s*$`).test(lines[i])) break
      }
      continue
    }
    if (/^\s*>>>/.test(line)) {
      const code = [line]
      while (i + 1 < lines.length && lines[i + 1].trim()) code.push(lines[++i])
      const indent = line.length - line.trimStart().length
      fence(code.map((entry) => entry.slice(indent)), 'python', ' '.repeat(indent))
      continue
    }
    const directive = /^(\s*)\.\.\s+(?:code-block|sourcecode|code)::\s*(\S*)\s*$/.exec(line)
    const literal = !/^\s*\.\.\s+[a-z-]+::/.test(line) && /::\s*$/.test(line)
    if (directive || literal) {
      const indent = line.length - line.trimStart().length
      let start = i + 1
      while (start < lines.length && !lines[start].trim()) start++
      if (directive) {
        // These are directive options, not source code (e.g. :linenos:).
        while (/^\s+:[\w-]+:/.test(lines[start] ?? '')) start++
        while (start < lines.length && !lines[start].trim()) start++
      }
      if (start < lines.length && lines[start].length - lines[start].trimStart().length > indent) {
        let end = start
        while (end < lines.length && (!lines[end].trim() || lines[end].length - lines[end].trimStart().length > indent)) end++
        const code = lines.slice(start, end)
        const margin = Math.min(...code.filter((entry) => entry.trim()).map((entry) => entry.length - entry.trimStart().length))
        if (literal && line.trim() !== '::') out.push(line.replace(/::\s*$/, ':'))
        fence(code.map((entry) => entry.slice(margin)), directive?.[2] || 'text', ' '.repeat(indent))
        i = end - 1
        continue
      }
    }
    out.push(line)
  }
  return out.filter((entry, i) => entry !== '' || out[i - 1] !== '').join('\n').trim()
}

/**
 * `Raises` entries, which this corpus writes as Sphinx roles.
 *
 * Two shapes appear, and neither is the numpydoc field list `parseFieldList`
 * reads. One exception per line with prose indented beneath — numpydoc's own
 * shape wearing a role — and a comma-separated run of roles wrapped over
 * several lines with no prose at all:
 *
 *     Raises
 *     ------
 *     :exc:`exc.OptionError`, :exc:`exc.UnknownOption`,
 *     :exc:`exc.InvalidOption`, :exc:`exc.AmbiguousOption`
 *
 * A role is `name : type` shaped, so the field-list parser read the first as an
 * exception literally named `:exc` and the second as one such entry per line.
 * Every raised exception in the Python reference rendered as the text `:exc`
 * with the real name discarded.
 *
 * Sphinx's leading `~` means "show only the last component", so a target
 * carrying one is shortened the way Sphinx shortens it. Prose indented under a
 * line belongs to every exception named on that line.
 */
const ROLE = /:(?:[a-z]+:)+`(~?)([^`]+)`/g

function parseRaises(body: string[]): { type: string; doc?: string }[] {
  const out: { type: string; doc?: string }[] = []
  let current: { type: string; doc?: string }[] = []
  for (const line of body) {
    if (!line.trim()) continue
    if (/^\s/.test(line) && current.length) {
      const text = line.trim()
      for (const e of current) e.doc = `${e.doc ?? ''}\n${text}`.trim()
      continue
    }
    const roles = [...line.matchAll(ROLE)].map(([, tilde, target]) =>
      tilde ? (target.split('.').at(-1) ?? target) : target,
    )
    if (roles.length) current = roles.map((type) => ({ type }))
    else {
      const head = line.match(/^(\S[^:]*?)(?:\s*:\s*.+)?$/)
      if (!head) continue
      current = [{ type: head[1].trim() }]
    }
    out.push(...current)
  }
  return out
}

/**
 * NumPy parameter entries: `name : type` on one line, indented prose beneath.
 * The type half is optional and the separator's spacing is not enforced by any
 * tool, so both are matched loosely.
 */
function parseFieldList(body: string[]): { name: string; type?: string; doc: string }[] {
  const out: { name: string; type?: string; doc: string }[] = []
  let entry: { name: string; type?: string; doc: string } | undefined
  for (const line of body) {
    const head = line.match(/^(\S[^:]*?)(?:\s*:\s*(.+))?$/)
    const indented = /^\s/.test(line)
    if (!indented && head && line.trim()) {
      entry = { name: head[1].trim(), type: head[2]?.trim(), doc: '' }
      out.push(entry)
    } else if (entry) {
      entry.doc = `${entry.doc}\n${line.trim()}`.trim()
    }
  }
  return out
}

/** Fenced or doctest examples, kept whole so the site can run them. */
/**
 * Split an Examples section into one entry per doctest block.
 *
 * A doctest block is a run of `>>>` and `...` lines plus the output that
 * follows them; anything else is prose introducing the next block. Filtering
 * the section down to its doctest lines and joining them, which is what this
 * did, produced one block containing six examples with the sentences between
 * them rendered as if they were code.
 */
function exampleBlocks(text: string): { lang: string; code: string; intro?: string }[] {
  const out: { lang: string; code: string; intro?: string }[] = []
  const lines = text.split('\n')
  let prose: string[] = []
  let code: string[] = []

  const flush = () => {
    if (!code.length) return
    out.push({
      lang: 'python',
      code: code.join('\n').replace(/\s+$/, ''),
      intro: prose.join(' ').replace(/\s+/g, ' ').trim() || undefined,
    })
    prose = []
    code = []
  }

  for (const line of lines) {
    if (!line.trim()) {
      // A blank line ends a doctest block. That is doctest's own rule, and it
      // is what separates the six examples in `Server`'s docstring — an
      // indentation test instead read each block's expected output as prose
      // introducing the next one.
      flush()
      continue
    }
    if (/^\s*(>>>|\.\.\.)/.test(line) || code.length) {
      // A prompt opens a block; once open, every non-blank line belongs to it,
      // because expected output sits at the prompt's own indentation and is
      // indistinguishable from prose by shape alone.
      code.push(line)
      continue
    }
    prose.push(line.trim())
  }
  flush()
  return out
}

/** `.. [name] text` — a citation the prose refers to as `[name]_`. */
function parseReferences(body: string[]): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = []
  let current: { name: string; text: string[] } | undefined
  const flush = () => {
    if (current) out.push({ name: current.name, text: current.text.join(' ').replace(/\s+/g, ' ').trim() })
    current = undefined
  }
  for (const line of body) {
    const start = /^\s*\.\.\s+\[([^\]]+)\]\s*(.*)$/.exec(line)
    if (start) {
      flush()
      current = { name: start[1], text: start[2] ? [start[2]] : [] }
      continue
    }
    if (current && line.trim()) current.text.push(line.trim())
  }
  flush()
  return out
}

export interface ParsedDoc {
  doc: DocBlock
  /** Parameter docs, to be merged onto the signature the extractor built. */
  params: Map<string, string>
  /** Per-parameter `versionadded` / `deprecated`, merged the same way. */
  paramMeta: Map<string, { since?: string; deprecated?: string }>
  returnsDoc?: string
  raises: { type: string; doc?: string }[]
}

/**
 * A reST directive block: `.. name:: argument` plus its indented body.
 *
 * Returns the text with every directive removed and the directives it found.
 * Extracting `deprecated` with a regex while leaving the line in place is why
 * pages showed the raw `.. deprecated:: 0.17` beside the notice built from
 * it — the value was read twice and removed never.
 */
function directives(text: string): {
  rest: string
  found: { kind: string; arg: string; body: string }[]
} {
  const lines = text.split('\n')
  const keep: string[] = []
  const found: { kind: string; arg: string; body: string }[] = []
  let open: { kind: string; arg: string; body: string[]; indent: number } | undefined

  const close = () => {
    if (open) {
      const margin = Math.min(...open.body.filter((line) => line.trim()).map((line) => line.length - line.trimStart().length))
      found.push({ kind: open.kind, arg: open.arg, body: open.body.map((line) => line.slice(margin)).join('\n').trim() })
    }
    open = undefined
  }

  let literalFence: string | undefined
  for (const line of lines) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
    if (literalFence || marker) {
      if (!literalFence && open && line.length - line.trimStart().length <= open.indent) close()
      if (open) open.body.push(line)
      else keep.push(line)
      if (!literalFence) literalFence = marker
      else if (new RegExp(`^\\s*${literalFence[0]}{${literalFence.length},}\\s*$`).test(line)) literalFence = undefined
      continue
    }
    const start = /^(\s*)\.\.\s+([a-z-]+)::\s*(.*)$/.exec(line)
    if (start) {
      close()
      open = { kind: start[2], arg: start[3].trim(), body: [], indent: start[1].length }
      continue
    }
    if (open) {
      // A directive owns everything indented past its own marker; the first
      // line back at or left of that column ends it.
      const indent = line.length - line.trimStart().length
      if (!line.trim() || indent > open.indent) {
        open.body.push(line)
        continue
      }
      close()
    }
    keep.push(line)
  }
  close()
  return { rest: keep.join('\n'), found }
}

export function parsePythonDoc(raw: string): ParsedDoc {
  const text = dedentDocstring(raw)
  const { intro, named } = sections(text)
  const { rest: introText, found: dirs } = directives(pythonDocBody(intro))
  const notes = ['Notes', 'Warnings'].flatMap((name) => {
    const section = directives(pythonDocBody(named.get(name)?.join('\n') ?? ''))
    dirs.push(...section.found)
    return section.rest.trim() ? [`### ${name}\n\n${section.rest.trim()}`] : []
  })
  const [summary, ...restIntro] = introText.split('\n\n')

  /**
   * Parameter descriptions, with their own directives lifted out.
   *
   * `parseFieldList` returns the field's prose verbatim, and a parameter's
   * prose can carry `.. versionadded::` like any other. Left in place it
   * rendered as literal reST at the end of 135 descriptions.
   */
  const params = new Map<string, string>()
  const paramMeta = new Map<string, { since?: string; deprecated?: string }>()
  for (const entry of parseFieldList(named.get('Parameters') ?? [])) {
    if (!entry.doc) continue
    const { rest, found } = directives(entry.doc)
    const text = rest.trim()
    if (text) params.set(entry.name, text)
    const pick = (kind: string) => {
      const d = found.find((x) => x.kind === kind)
      return d ? [d.arg, d.body].filter(Boolean).join(' ').trim() || undefined : undefined
    }
    const meta = { since: pick('versionadded'), deprecated: pick('deprecated') }
    if (meta.since || meta.deprecated) paramMeta.set(entry.name, meta)
    // A directive with no field of its own — `note`, `warning` — is appended
    // to the description rather than dropped; a parameter has nowhere else to
    // put it and losing the sentence is worse than losing its box.
    const other = found
      .filter((x) => !['versionadded', 'deprecated'].includes(x.kind))
      .map((x) => `${x.kind[0].toUpperCase()}${x.kind.slice(1)}: ${[x.arg, x.body].filter(Boolean).join(' ')}`.trim())
    if (other.length) params.set(entry.name, [text, ...other].filter(Boolean).join(' '))
  }

  const returnsBody = (named.get('Returns') ?? named.get('Yields') ?? []).join('\n').trim()
  const raises = parseRaises(named.get('Raises') ?? []).map((r) => ({
    type: r.type,
    doc: r.doc || undefined,
  }))

  const examplesText = (named.get('Examples') ?? []).join('\n')
  const value = (kind: string) => dirs.filter((d) => d.kind === kind)
    .map((d) => [d.arg, d.body].filter(Boolean).join(' — ').trim()).filter(Boolean).join('\n\n') || undefined
  const deprecated = value('deprecated')
  const since = value('versionadded')
  const changed = value('versionchanged')
  const admonitions = dirs
    .filter((d) => !['deprecated', 'versionadded', 'versionchanged'].includes(d.kind))
    .map((d) => ({ kind: d.kind, text: [d.arg, d.body].filter(Boolean).join('\n\n').trim() }))
    .filter((a) => a.text)

  return {
    doc: {
      summary: (summary ?? '').replace(/\s+/g, ' ').trim(),
      body: [restIntro.join('\n\n').trim(), ...notes].filter(Boolean).join('\n\n') || undefined,
      changed,
      admonitions: admonitions.length ? admonitions : undefined,
      examples: examplesText ? exampleBlocks(examplesText) : undefined,
      references: parseReferences(named.get('References') ?? []).length
        ? parseReferences(named.get('References') ?? [])
        : undefined,
      deprecated,
      since,
      seeAlso: (named.get('See Also') ?? [])
        .join(' ')
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    },
    params,
    paramMeta,
    returnsDoc: returnsBody || undefined,
    raises,
  }
}

/** Merge parsed doc fields onto a signature the syntax pass built. */
export function applyDoc(sig: Signature, parsed: ParsedDoc): Signature {
  return {
    ...sig,
    params: sig.params.map((p: Param) => ({
      ...p,
      doc: parsed.params.get(p.name) ?? p.doc,
      ...parsed.paramMeta.get(p.name),
    })),
    returnsDoc: parsed.returnsDoc ?? sig.returnsDoc,
    raises: parsed.raises.length ? parsed.raises : sig.raises,
  }
}
