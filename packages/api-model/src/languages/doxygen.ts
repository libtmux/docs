import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ApiSymbol, Modifier, Param, Signature, SymbolKind } from '../model.ts'

/**
 * C++ from Doxygen XML, not from tree-sitter.
 *
 * The C++ grammar loses 0.34% of this project's headers, and what it loses is
 * the part a reference exists to show: `LIBTMUX_NAMESPACE_BEGIN` is a macro
 * that opens a namespace, so the unbalanced brace derails the file, and
 * `void f(std::string s = {})` yields a MISSING node that drops the default
 * argument. No parser without a preprocessor can do better.
 *
 * Doxygen has a preprocessor, already runs in this project's build (its XML is
 * what Breathe consumes), and emits a resolved model. This reads that model
 * into the same shape tree-sitter produces, so C++ renders through the same
 * components as everything else.
 *
 * A hand-written XML reader rather than a parser dependency: Doxygen's schema
 * is large but the slice needed here is small and regular, and the alternative
 * is an XML library in a package whose whole point is having few dependencies.
 */

/** Doxygen's `kind` attribute mapped onto the model's kinds. */
const COMPOUND_KIND: Record<string, SymbolKind> = {
  class: 'class',
  struct: 'struct',
  namespace: 'module',
  interface: 'interface',
}

const MEMBER_KIND: Record<string, SymbolKind> = {
  function: 'method',
  variable: 'attribute',
  enum: 'enum',
  typedef: 'typealias',
  define: 'constant',
}

/** Strip Doxygen's inline markup, keeping the text a reader would see. */
function textOf(xml: string): string {
  return xml
    .replace(/<ref[^>]*>/g, '')
    .replace(/<\/ref>/g, '')
    .replace(/<computeroutput>/g, '`')
    .replace(/<\/computeroutput>/g, '`')
    .replace(/<para>/g, '\n')
    .replace(/<\/para>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Doxygen's spelling of a template specialisation, normalised to C++'s.
 *
 * `std::hash< libtmux::Pane >` is how Doxygen writes it; the padding inside
 * the angle brackets is its formatting, not part of the name. Left as-is it
 * is four names containing spaces, which `objects.inv` cannot represent —
 * whitespace-delimited records mis-split and the entry is lost.
 */
function normalizeCppName(name: string): string {
  return name
    .replace(/<\s+/g, '<')
    .replace(/\s+>/g, '>')
    .replace(/\s*,\s*/g, ',')
    .replace(/\s+/g, '')
}

const tag = (xml: string, name: string): string | undefined => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml)
  return m ? m[1] : undefined
}

/**
 * The descriptions belonging to the compound itself, not to its first member.
 *
 * Doxygen writes a type's own `briefdescription` and `detaileddescription`
 * last, between the final `</sectiondef>` and `<location>`.
 */
const ownDescriptions = (xml: string): { brief: string; detail: string } => {
  const end = xml.lastIndexOf('<location ')
  const scope = end === -1 ? xml : xml.slice(0, end)
  const start = scope.lastIndexOf('</sectiondef>')
  const tail = start === -1 ? scope : scope.slice(start)
  return { brief: tag(tail, 'briefdescription') ?? '', detail: tag(tail, 'detaileddescription') ?? '' }
}

/** The part of an enum's `<memberdef>` that describes the enum, not its values. */
const afterEnumValues = (block: string): string => {
  const last = block.lastIndexOf('</enumvalue>')
  return last === -1 ? block : block.slice(last)
}

const attr = (xml: string, name: string): string | undefined =>
  new RegExp(`${name}="([^"]*)"`).exec(xml)?.[1]

/** `<param>` entries, with the `\param` docs Doxygen keeps separately. */
function paramsOf(block: string, docs: Map<string, string>): Param[] {
  const out: Param[] = []
  for (const m of block.matchAll(/<param>([\s\S]*?)<\/param>/g)) {
    const name = textOf(tag(m[1], 'declname') ?? '')
    const type = textOf(tag(m[1], 'type') ?? '')
    const def = tag(m[1], 'defval')
    if (!name && !type) continue
    out.push({
      name: name || type,
      type: name ? type : undefined,
      // The default argument, which is exactly what tree-sitter dropped.
      default: def ? textOf(def) : undefined,
      doc: docs.get(name),
    })
  }
  return out
}

/** `\param name description` entries, which live apart from `<param>`. */
function paramDocs(block: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of block.matchAll(/<parameteritem>([\s\S]*?)<\/parameteritem>/g)) {
    const name = textOf(tag(m[1], 'parametername') ?? '')
    const desc = textOf(tag(m[1], 'parameterdescription') ?? '')
    if (name) out.set(name, desc)
  }
  return out
}

function modifiersOf(block: string): Modifier[] {
  const out: Modifier[] = []
  if (attr(block, 'static') === 'yes') out.push('static')
  if (attr(block, 'virt') === 'pure-virtual') out.push('abstract')
  if (attr(block, 'const') === 'yes') out.push('readonly')
  if (/<detaileddescription>[\s\S]*deprecated/i.test(block)) out.push('deprecated')
  return out
}

/**
 * @param sourceRoot accepted and unused, so callers need not change.
 *
 * It used to point a scraper at the headers, because libtmux-cxx documented
 * itself with `//` and Doxygen reads only `///` and block comments — every
 * `briefdescription` in the XML was empty, so the prose had to come from
 * somewhere. That conversion has since landed upstream and Doxygen emits 261
 * briefs where it emitted none.
 *
 * The scraper is gone rather than kept as a fallback, and the measurement is
 * why. It documented 56 symbols the briefs do not, and 42 of those shared
 * their summary with another symbol: it took the comment above one
 * declaration and attributed it to the next as well, so `Buffer::name`,
 * `Buffer::size` and `Buffer::created` all claimed "Named by the caller, or
 * by tmux as `buffer0`". `size()` has no comment at all.
 *
 * 224 correctly attributed beats 280 of which 42 are wrong. A reader cannot
 * tell a borrowed sentence from a written one, which makes the borrowed kind
 * worse than an empty description.
 */
export function extractDoxygen(xmlDir: string, sourceRoot = ''): ApiSymbol[] {
  void sourceRoot
  const symbols: ApiSymbol[] = []
  const seen = new Map<string, ApiSymbol>()

  const files = readdirSync(xmlDir).filter(
    (f) => f.endsWith('.xml') && f !== 'index.xml' && f !== 'Doxyfile.xml',
  )

  for (const file of files.sort()) {
    const xml = readFileSync(join(xmlDir, file), 'utf8')
    const compound = /<compounddef[^>]*kind="(\w+)"[^>]*>/.exec(xml)
    if (!compound) continue
    const kind = COMPOUND_KIND[compound[1]]
    // `file` compounds hold free functions; their members are emitted at
    // namespace scope rather than under a type, which is where they belong.
    const owner = normalizeCppName(textOf(tag(xml, 'compoundname') ?? ''))
    if (!owner) continue

    if (kind && compound[1] !== 'namespace') {
      // A compound's own descriptions sit at the end of `<compounddef>`, after
      // every `<sectiondef>` and immediately before `<location>`. Taking the
      // first ones in the file took a *member's* instead, so `AttachCommand`
      // was documented with "Exec-order arguments; empty after this value is
      // moved from." — and where the first member had none, which is usual,
      // the type was reported as undocumented while its prose sat in the file.
      const own = ownDescriptions(xml)
      const brief = textOf(own.brief)
      const detail = textOf(own.detail)
      const location = /<location file="([^"]*)"[^>]*line="(\d+)"/.exec(xml)
      const bases = [...xml.matchAll(/<basecompoundref[^>]*>([\s\S]*?)<\/basecompoundref>/g)].map(
        (m) => textOf(m[1]),
      )
      if (!seen.has(owner)) {
        const sym: ApiSymbol = {
          id: owner,
          publicId: owner,
          name: owner.split('::').pop() ?? owner,
          kind,
          modifiers: [],
          signatures: [],
          doc:
            brief || detail
              ? { summary: brief, body: detail || undefined }
              : undefined,
          extends: bases.length ? bases : undefined,
          source: { file: location?.[1] ?? file, line: Number(location?.[2] ?? 1) },
        }
        seen.set(owner, sym)
        symbols.push(sym)
      }
    }

    for (const m of xml.matchAll(/<memberdef([\s\S]*?)<\/memberdef>/g)) {
      const block = m[1]
      // Doxygen records protected and private members too; a public reference
      // shows neither.
      if (attr(block, 'prot') !== 'public') continue
      const memberKind = MEMBER_KIND[attr(block, 'kind') ?? '']
      if (!memberKind) continue
      const name = textOf(tag(block, 'name') ?? '')
      if (!name || name.startsWith('operator')) continue

      const parent = kind && compound[1] !== 'namespace' ? owner : undefined
      const id = parent ? `${parent}::${name}` : `${owner}::${name}`
      // An enum's own descriptions come after its values', the same way a
      // compound's come after its members'. Reading the first ones documented
      // `StringOp` as "iequals" — the brief of its second enumerator.
      const scope = attr(block, 'kind') === 'enum' ? afterEnumValues(block) : block
      const brief = textOf(tag(scope, 'briefdescription') ?? '')
      const detail = textOf(tag(scope, 'detaileddescription') ?? '')
      const returnType = textOf(tag(block, 'type') ?? '')
      const returnDoc = textOf(tag(block, 'simplesect') ?? '')

      const signature: Signature | undefined =
        attr(block, 'kind') === 'function'
          ? {
              params: paramsOf(block, paramDocs(block)),
              returns: returnType || undefined,
              returnsDoc: returnDoc || undefined,
            }
          : undefined

      const existing = seen.get(id)
      if (existing && signature) {
        // C++ overload sets: same name, different parameters, one entry.
        existing.signatures.push(signature)
        if (!existing.modifiers.includes('overload')) existing.modifiers.push('overload')
        continue
      }
      if (existing) continue

      const location = /<location file="([^"]*)"[^>]*line="(\d+)"/.exec(block)
      const sym: ApiSymbol = {
        id,
        publicId: id,
        name,
        kind: memberKind === 'method' && !parent ? 'function' : memberKind,
        modifiers: modifiersOf(block),
        parent,
        signatures: signature ? [signature] : [],
        type: signature ? undefined : returnType || undefined,
        doc:
          brief || detail
            ? { summary: brief, body: detail || undefined }
            : undefined,
        source: { file: location?.[1] ?? file, line: Number(location?.[2] ?? 1) },
      }
      seen.set(id, sym)
      symbols.push(sym)

      // An enum's values are its API, and Doxygen nests them inside the
      // enum's own <memberdef> rather than emitting one each. Without this
      // every C++ enum reached the reference as a name with nothing under it:
      // 21 enums, 0 members. Each value carries its own descriptions, so they
      // are read here rather than inherited from the enum.
      if (attr(block, 'kind') === 'enum') {
        for (const v of block.matchAll(/<enumvalue([\s\S]*?)<\/enumvalue>/g)) {
          const value = v[1]
          if (attr(value, 'prot') !== 'public') continue
          const valueName = textOf(tag(value, 'name') ?? '')
          if (!valueName) continue
          const valueId = `${id}::${valueName}`
          if (seen.has(valueId)) continue
          const valueBrief = textOf(tag(value, 'briefdescription') ?? '')
          const valueDetail = textOf(tag(value, 'detaileddescription') ?? '')
          const valueSym: ApiSymbol = {
            id: valueId,
            publicId: valueId,
            name: valueName,
            // No `variant` kind exists, and a named member of an enum is
            // what a constant is — the same choice the tree-sitter specs make.
            kind: 'constant',
            modifiers: [],
            parent: id,
            signatures: [],
            doc:
              valueBrief || valueDetail
                ? { summary: valueBrief, body: valueDetail || undefined }
                : undefined,
            source: { file: location?.[1] ?? file, line: Number(location?.[2] ?? 1) },
          }
          seen.set(valueId, valueSym)
          symbols.push(valueSym)
        }
      }
    }
  }

  return symbols
}
