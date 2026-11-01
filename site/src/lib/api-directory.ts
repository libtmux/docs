import type { ProseBlock } from './api-prose'

/** The names one row lists, under an optional label such as `Buffers`. */
export interface DirectoryGroup { label?: string; refs: string[] }

/** A bold-led paragraph that says what a group of members is for, then the members. */
export interface DirectoryRow { title: string; guidance: string; groups: DirectoryGroup[] }

export type DirectoryBlock = ProseBlock | { kind: 'directory'; rows: DirectoryRow[] }

const RUSTDOC_LINK = /\[`[^`\]]+`\](?:\([^)\s]*\))?/
const XML_SEE = /<see\s+cref="[^"]+"\s*\/>/
const JAVADOC_LINK = /\{@link(?:code|plain)?\s+[^}]+\}/
/** A Go doc link [Name] or [Type.Method], which is also KDoc's [name]. */
const GO_LINK = /\[[A-Za-z_][\w.]*\](?![([])/

/**
 * A doc comment's own spelling of a reference in the first five ports: rustdoc's [`name`] or [`name`](target), an
 * XML doc `<see cref="…" />`, Javadoc and TSDoc's {@link …}, and a Go doc link. A port with no list of its own below,
 * and a caller who names no port, read all four.
 */
const SHARED = [RUSTDOC_LINK, XML_SEE, JAVADOC_LINK, GO_LINK]

/**
 * A name in a code span, which is how a C++ or Lua reference reaches the shell. The Doxygen extractor drops the
 * tag of `\ref` and `@ref` and keeps a bare word that prose cannot be told from, and it flattens lists, so a C++
 * row is a paragraph. LuaLS has no link syntax of its own.
 */
const CODE_NAME = /`[A-Za-z_]\w*(?:(?:::|\.|:)~?[A-Za-z_]\w*)*(?:\([^`()\n]*\))?`/

/** A PowerShell cmdlet, `Verb-Noun`, with its module when it has one, or a `LibTmux` type. */
const POWERSHELL_NAME = String.raw`(?:[A-Za-z_]\w*\\)?[A-Z][a-z]+(?:[A-Z][a-z]+)*-[A-Z][A-Za-z0-9]*|(?:LibTmux|System)(?:\.[A-Za-z_]\w*)+`

/**
 * The spellings of a port that writes its own, in the form its extractor hands over. Each pattern accepts what the
 * tokenizer in `@libtmux/api-model` reads as one reference for that port, so a chip links the way prose does, and
 * a port reads nothing its tokenizer would leave as text.
 */
const BY_PORT: Record<string, RegExp[]> = {
  // Sphinx roles reach the shell as written, `:meth:`~libtmux.Server.kill``. The tokenizer resolves exactly these
  // roles, and only the first four with a `py:` prefix.
  py: [/:(?:py:(?:class|meth|attr|func)|(?:class|meth|attr|func|exc|obj|mod|data|const)):`[^`\n]+`/],
  // DocC's symbol link is a double backtick: ``Server/kill(_:)``.
  swift: [/``[^`\n]+``/],
  // ExDoc: `fun/arity`, `Module.fun/arity`, a module, `t:type/0`, and [text](`Module.fun/1`).
  elixir: [
    /\[[^\]\n]+\]\(`[^`)\n]+`\)/,
    /`(?:[tc]:)?(?:[A-Z]\w*\.)*[A-Za-z_]\w*[?!]?\/\d+`/,
    /`(?:[A-Z]\w*\.)*[A-Z]\w*`/,
  ],
  // KDoc: [label][target], [name] (the Go form) and the {@link} that Java's docs write.
  kotlin: [/\[[^\]\n]+\]\[[\w.]+\]/, JAVADOC_LINK, GO_LINK],
  // Scaladoc: [[Server.open]] and [[io.github.libtmux.ServerConfig ServerConfig]], and {@link}.
  scala: [/\[\[[\w.#]+(?:\s+[^\]\n]+)?\]\]/, JAVADOC_LINK],
  cxx: [CODE_NAME],
  lua: [CODE_NAME],
  // YARD: {#session}, {Server.open}, {Selection#where?} and {#initialize Server.new}. A label holds no code span.
  ruby: [/\{(?:#[A-Za-z_]\w*[?!=]?|(?:::)?[A-Z]\w*(?:::[A-Z]\w*)*(?:[#.][A-Za-z_]\w*[?!=]?)?)(?:[ \t]+(?=[\w"'([])[^}\n`]*[^}\s`])?\}/],
  // Documenter: [`name`](@ref), [`name`](@ref Module.name) and [text](@ref).
  julia: [/\[[^\]\n]+\]\(@ref(?:\s[^)\n]*)?\)/],
  // Native help names a cmdlet as a bare word or in a code span.
  powershell: [new RegExp(`\`(?:${POWERSHELL_NAME})\``), new RegExp(`(?<![\\w$-])(?:${POWERSHELL_NAME})(?![\\w-])`)],
}

const patterns = new Map<string | undefined, RegExp>()

/** Every reference syntax the port writes, the most specific first so a longer form is not cut short by a shorter. */
function referenceFor(lang: string | undefined): RegExp {
  let pattern = patterns.get(lang)
  if (!pattern) {
    const own = lang !== undefined && Object.hasOwn(BY_PORT, lang) ? BY_PORT[lang] : SHARED
    pattern = new RegExp(own.map((part) => part.source).join('|'), 'g')
    patterns.set(lang, pattern)
  }
  return pattern
}

const LEAD = /^\*\*([^*]+?)\*\*\s*(.*)$/
const LABEL = /^([^:[`]{1,40}):\s+(.*)$/
/** Fewer rows than this read as ordinary prose. */
const MIN_ROWS = 3

/** The references of a text made of nothing else, or undefined when it holds prose. */
function referencesOnly(text: string, lang?: string): string[] | undefined {
  const reference = referenceFor(lang)
  const refs = text.match(reference) ?? []
  if (!refs.length) return undefined
  return text.replace(reference, '').replace(/\band\b/g, '').replace(/[\s,;.·]/g, '') ? undefined : refs
}

function groupsOf(block: ProseBlock | undefined, lang?: string): DirectoryGroup[] | undefined {
  if (block?.kind === 'p') {
    const refs = referencesOnly(block.text, lang)
    return refs && [{ refs }]
  }
  if (block?.kind !== 'ul') return undefined
  const groups: DirectoryGroup[] = []
  for (const item of block.items) {
    const label = LABEL.exec(item.text)
    const refs = label && !item.children.length ? referencesOnly(label[2], lang) : undefined
    if (!label || !refs) return undefined
    groups.push({ label: label[1].replace(/^[*_]{1,2}(.*?)[*_]{1,2}$/, '$1').trim(), refs })
  }
  return groups
}

/**
 * Fold a capability directory into rows: three or more bold-led paragraphs, each followed by a paragraph or a
 * labelled list that holds only references. The source stays ordinary Markdown, so rustdoc reads it as prose and
 * links; this shell draws the guidance beside the names it covers. `lang` is the port whose doc comment this is.
 */
export function groupDirectory(blocks: ProseBlock[], lang?: string): DirectoryBlock[] {
  const out: DirectoryBlock[] = []
  let rows: DirectoryRow[] = []
  let pending: ProseBlock[] = []
  const flush = () => {
    if (rows.length >= MIN_ROWS) out.push({ kind: 'directory', rows })
    else out.push(...pending)
    rows = []
    pending = []
  }
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const lead = block.kind === 'p' ? LEAD.exec(block.text) : null
    const groups = lead ? groupsOf(blocks[i + 1], lang) : undefined
    if (lead && groups) {
      rows.push({ title: lead[1].trim().replace(/[.:]$/, ''), guidance: lead[2].trim(), groups })
      pending.push(block, blocks[i + 1])
      i++
      continue
    }
    // Go doc comments have no bold: a row there is a `# Heading`, its guidance, then the names.
    const guidance = block.kind === 'rubric' ? blocks[i + 1] : undefined
    const headed = guidance?.kind === 'p' && !referencesOnly(guidance.text, lang) ? groupsOf(blocks[i + 2], lang) : undefined
    if (block.kind === 'rubric' && guidance?.kind === 'p' && headed) {
      rows.push({ title: block.text.replace(/[.:]$/, ''), guidance: guidance.text, groups: headed })
      pending.push(block, guidance, blocks[i + 2])
      i += 2
      continue
    }
    flush()
    out.push(block)
  }
  flush()
  return out
}
