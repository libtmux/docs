/**
 * reST cross-reference roles, which are most of the interlinking.
 *
 * libtmux's docstrings carry 524 of them — `` :meth:`Pane.send_keys` ``,
 * `` :class:`~libtmux.Server` ``, `` :attr:`.panes` ``. gp-sphinx resolves
 * every one to a link; a doc parser that leaves them as literal text produces
 * a reference that reads like source code and links nowhere.
 *
 * This tokenizes them into spans. Resolution against the symbol table happens
 * in `link.ts`, because the same span shape is produced by the signature
 * tokenizer and both want one resolver.
 */

/** Roles worth resolving. Anything else stays literal, deliberately. */
const ROLES = new Set([
  'class',
  'meth',
  'attr',
  'func',
  'exc',
  'obj',
  'mod',
  'data',
  'const',
  'py:class',
  'py:meth',
  'py:attr',
  'py:func',
])

export type DocSpan =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  /** `[server_manual]_` — points at a citation the References section defines. */
  | { kind: 'citation'; target: string; label: string }
  | {
      kind: 'ref'
      /** `meth`, `class`, … — drives which symbol kinds may match. */
      role: string
      /** What to search for: `Pane.send_keys`. */
      target: string
      /** What to show. `~` means "last segment only"; explicit titles win. */
      label: string
    }

/**
 * `:role:`target`` with reST's two label forms.
 *
 * - `` :meth:`~libtmux.Pane.send_keys` `` shows `send_keys`.
 * - `` :meth:`send keys <Pane.send_keys>` `` shows `send keys`.
 * - `` :attr:`.panes` `` is a relative reference; the leading dot means
 *   "search upward", and the label drops it.
 */
const ROLE_RE = /:([a-z:]+):`([^`]+)`/g

/**
 * A citation reference: `[server_manual]_`.
 *
 * reST's trailing underscore is the reference marker, not part of the name,
 * and leaving it in place rendered "[server_manual]_." mid-sentence. The
 * citation itself is parsed out of the References section, so this points at
 * the anchor that section renders.
 */
const CITATION_RE = /\[([A-Za-z][\w-]*)\]_/g

/**
 * A Rust intra-doc link: `[Error::UnsupportedCapability]`.
 *
 * Rust writes cross-references in brackets with no role, which is
 * indistinguishable from ordinary brackets except by content. Requiring a
 * `::` is what makes it safe: `[see below]` and `[0]` are not references, and
 * a path with a scope operator in it is not prose.
 *
 * Both spellings occur — libtmux-rs has 419 of `` [`Path`] `` and 304 of
 * `[Path]` — and the backticked form has to be matched *with* its backticks,
 * or the inline-literal pass claims the inside and leaves the brackets
 * printed around it.
 */
const INTRA_DOC_RE = /\[`?([A-Za-z_][\w]*(?:::[\w]+)+)`?\](?!\()/g

/**
 * A Go doc link: `[Name]`, `[Name.Method]`, `[pkg.Name]`.
 *
 * Go 1.19 gave doc comments their own link syntax and libtmux-go uses it
 * 2,021 times. It is the same bracket shape as Rust's, separated by a dot
 * instead of `::` — which is why the Rust matcher's `::` guard, there to keep
 * `[see below]` and `[0]` from being read as references, excluded every Go
 * link in the estate.
 *
 * Safety comes from the identifier shape instead: no spaces, starts with a
 * letter, and not followed by `(` so a Markdown link is left alone. A bare
 * `[Name]` is ambiguous with an ordinary bracketed word, and the resolver is
 * what settles it — an unresolved one renders as plain text, which is what it
 * was already doing.
 */
const GO_DOC_LINK_RE = /\[\*?([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)\](?![(_])/g

/**
 * Javadoc and TSDoc inline tags: `{@link Target}`, `{@link Target label}`.
 *
 * `{@code x}` and `{@literal x}` are inline literals rather than references —
 * the same thing reST spells with double backticks.
 */
const JSDOC_LINK_RE = /\{@link(?:plain|code)?\s+([^}\s]+)(?:\s+([^}]+))?\}/g
const JSDOC_CODE_RE = /\{@(?:code|literal)\s+([^}]+)\}/g

/**
 * C# documentation XML, which is markup rather than prose.
 *
 * `<see cref="T:LibTmux.Server"/>` carries a one-letter kind prefix — `T:` for
 * a type, `M:` a method, `P:` a property — that is addressing metadata, not
 * part of the name.
 */
const XML_SEE_RE = /<see(?:also)?\s+cref="(?:[A-Z]:)?([^"]+)"\s*\/?>(?:<\/see(?:also)?>)?/g
const XML_PARAMREF_RE = /<(?:paramref|typeparamref)\s+name="([^"]+)"\s*\/?>/g
const XML_CODE_RE = /<c>([^<]+)<\/c>/g
/** A bare double-backtick literal, which is never a link. */
const LITERAL_RE = /``([^`]+)``/g
/** A single-backtick reference, which napoleon also resolves. */
const BACKTICK_RE = /`([^`<>]+)`/g

function labelFor(raw: string): { target: string; label: string } {
  const titled = /^(.*?)\s*<([^>]+)>$/.exec(raw.trim())
  if (titled) return { target: titled[2].trim(), label: titled[1].trim() }
  const t = raw.trim()
  if (t.startsWith('~')) {
    const target = t.slice(1)
    return { target, label: target.split('.').pop() ?? target }
  }
  // The leading dot is kept on the target so the resolver knows this is a
  // relative reference and must not fall through to a global match; the label
  // drops it, which is what Sphinx renders.
  if (t.startsWith('.')) return { target: t, label: t.slice(1) }
  return { target: t, label: t }
}

/**
 * Split doc text into spans.
 *
 * Order matters: double-backtick literals are consumed before single-backtick
 * references, or ``like this`` is read as two adjacent references to nothing.
 */
/**
 * How each language spells a cross-reference in a doc comment.
 *
 * This dispatch is the thing that was missing. Block parsing has always been
 * per-language — NumPy sections for Python, Markdown for the five that write
 * it, Doxygen XML for C++ — but inline parsing was one reST-shaped function
 * for all eight, so Go, Java, .NET, Swift and TypeScript reached the page
 * with every reference rendered as literal text. Measured across the built
 * reference: Python 8.3 links per thousand characters of description, Go and
 * Java and .NET exactly 0.
 *
 * `undefined` means "no language declared", which gets the reST set. That is
 * the historical behaviour and the Python corpus depends on it; a caller who
 * forgets loses the new syntaxes rather than the old ones.
 */
const SYNTAX: Record<string, ReadonlySet<string>> = {
  py: new Set(['rest', 'citation']),
  rs: new Set(['intra-doc']),
  go: new Set(['go-link']),
  java: new Set(['jsdoc']),
  ts: new Set(['jsdoc']),
  dotnet: new Set(['xml-doc']),
  // DocC gives double backticks a meaning reST reserves for a literal: in a
  // Swift doc comment ``Server`` is a symbol link, not code.
  swift: new Set(['docc']),
  cxx: new Set([]),
}

export function tokenizeDoc(text: string, lang?: string): DocSpan[] {
  const spans: DocSpan[] = []
  let index = 0
  const syntax = lang ? (SYNTAX[lang] ?? new Set<string>()) : SYNTAX.py

  type Hit = { start: number; end: number; span: DocSpan }
  const hits: Hit[] = []

  if (syntax.has('intra-doc')) {
    for (const m of text.matchAll(INTRA_DOC_RE)) {
      hits.push({
        start: m.index,
        end: m.index + m[0].length,
        span: { kind: 'ref', role: 'any', target: m[1].replace(/::/g, '.'), label: m[1] },
      })
    }
  }

  if (syntax.has('go-link')) {
    for (const m of text.matchAll(GO_DOC_LINK_RE)) {
      hits.push({
        start: m.index,
        end: m.index + m[0].length,
        span: { kind: 'ref', role: 'any', target: m[1], label: m[1] },
      })
    }
  }

  if (syntax.has('jsdoc')) {
    for (const m of text.matchAll(JSDOC_CODE_RE)) {
      hits.push({ start: m.index, end: m.index + m[0].length, span: { kind: 'code', text: m[1] } })
    }
    for (const m of text.matchAll(JSDOC_LINK_RE)) {
      // `#member` is javadoc for "in this type"; the resolver reads a leading
      // dot the same way, which is reST's spelling of the same idea.
      const target = m[1].replace(/^#/, '.').replace(/#/g, '.')
      hits.push({
        start: m.index,
        end: m.index + m[0].length,
        span: { kind: 'ref', role: 'any', target, label: m[2]?.trim() || m[1] },
      })
    }
  }

  if (syntax.has('xml-doc')) {
    for (const m of text.matchAll(XML_CODE_RE)) {
      hits.push({ start: m.index, end: m.index + m[0].length, span: { kind: 'code', text: m[1] } })
    }
    for (const m of text.matchAll(XML_PARAMREF_RE)) {
      hits.push({ start: m.index, end: m.index + m[0].length, span: { kind: 'code', text: m[1] } })
    }
    for (const m of text.matchAll(XML_SEE_RE)) {
      const target = m[1].replace(/\(.*$/, '')
      hits.push({
        start: m.index,
        end: m.index + m[0].length,
        span: { kind: 'ref', role: 'any', target, label: target.split('.').pop() ?? target },
      })
    }
  }

  if (syntax.has('citation')) {
    for (const m of text.matchAll(CITATION_RE)) {
      hits.push({
        start: m.index,
        end: m.index + m[0].length,
        span: { kind: 'citation', target: m[1], label: `[${m[1]}]` },
      })
    }
  }

  if (syntax.has('rest')) for (const m of text.matchAll(ROLE_RE)) {
    const role = m[1].replace(/^py:/, '')
    const { target, label } = labelFor(m[2])
    if (!ROLES.has(m[1])) {
      // A role this resolver does not handle — `:term:`, `:ref:`, `:doc:` —
      // still has to claim its range. Skipping it outright leaves its
      // backticks visible to the single-backtick fallback below, which then
      // invents a symbol reference out of a glossary term: `:term:`winlinks
      // <winlink>`` was being reported as an unresolved symbol named
      // `winlinks`. Emitting the label as literal text is both correct
      // rendering and correct masking.
      hits.push({ start: m.index, end: m.index + m[0].length, span: { kind: 'text', text: label } })
      continue
    }
    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      span: { kind: 'ref', role, target, label },
    })
  }
  for (const m of text.matchAll(LITERAL_RE)) {
    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      // DocC's ``Symbol`` is a link where reST's ``literal`` is code.
      span: syntax.has('docc')
        ? { kind: 'ref', role: 'any', target: m[1].replace(/\(.*$/, ''), label: m[1] }
        : { kind: 'code', text: m[1] },
    })
  }
  // Single-backtick references are scanned over a *masked* copy, with every
  // range already claimed by a role or a literal blanked out. Filtering
  // matches afterwards is not equivalent and quietly loses references: the
  // pairing is greedy and left-to-right, so an unclaimed backtick can pair
  // with one inside a role and swallow everything between them. In
  // ``:meth:`send keys <Pane.send_keys>` plus `Window`.`` that consumed the
  // `Window` reference entirely.
  const masked = [...text]
  for (const hit of hits) {
    for (let i = hit.start; i < hit.end; i++) masked[i] = ' '
  }
  for (const m of masked.join('').matchAll(BACKTICK_RE)) {
    const { target, label } = labelFor(m[1])
    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      span: { kind: 'ref', role: 'any', target, label },
    })
  }

  hits.sort((a, b) => a.start - b.start)
  for (const hit of hits) {
    if (hit.start < index) continue
    if (hit.start > index) spans.push({ kind: 'text', text: text.slice(index, hit.start) })
    spans.push(hit.span)
    index = hit.end
  }
  if (index < text.length) spans.push({ kind: 'text', text: text.slice(index) })
  return spans
}

/** Every reference target in a block of doc text, for index building. */
export function referencesIn(text: string): { role: string; target: string }[] {
  return tokenizeDoc(text)
    .filter((s): s is Extract<DocSpan, { kind: 'ref' }> => s.kind === 'ref')
    .map(({ role, target }) => ({ role, target }))
}
