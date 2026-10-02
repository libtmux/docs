import type { ApiModel, ApiSymbol, Signature } from '@libtmux/api-model'
import { compareMembers, memberSignals, moduleOf } from '@libtmux/api-model'
import mentions from '../data/mentions.json'
import { PORT_NAME } from './api-models'
import { apiEntryFields, apiMemberGroups } from './api-sections'

/**
 * A symbol's page as Markdown.
 *
 * One generator, two consumers: the `.md` endpoint serves it and the copy
 * button on the page fetches that same URL. Rendering it twice — once for the
 * file and once into a data attribute — is how the two drift, and the
 * difference is invisible until someone pastes one and reads the other.
 *
 * Written from the model rather than from the rendered HTML. HTML-to-Markdown
 * would carry the page's furniture — nav, contents, badges — into a document
 * whose whole point is to be the symbol without them.
 */
export interface MarkdownContext {
  model: ApiModel
  symbol: ApiSymbol
  /** Absolute URL of the HTML page this describes. */
  canonical?: string
  /** Repository blob URL for the declaration, when there is one. */
  source?: string
  packageName?: string
}

function signatureLine(symbol: ApiSymbol, sig: Signature): string {
  const params = (sig.params ?? [])
    .map((p) => `${p.name}${p.type ? `: ${p.type}` : ''}${p.default ? ` = ${p.default}` : ''}`)
    .join(', ')
  const returns = sig.returns ? ` -> ${sig.returns}` : ''
  return `${symbol.publicId ?? symbol.id}(${params})${returns}`
}

function fencedCode(code: string, language = ''): string {
  const fence = '`'.repeat(Math.max(3, ...[...code.matchAll(/`+/g)].map((match) => match[0].length + 1)))
  return `${fence}${language}\n${code}${code.endsWith('\n') ? '' : '\n'}${fence}`
}

export function symbolMarkdown(ctx: MarkdownContext): string {
  const { model, symbol } = ctx
  const id = symbol.publicId ?? symbol.id
  const out: string[] = [`# ${id}`, '']

  // The definition block, in the same order the page shows it.
  const facts: string[] = []
  const parent = symbol.parent ? model.symbols.find((entry) => entry.id === symbol.parent) : undefined
  const mod = moduleOf(parent ?? symbol)
  if (mod) facts.push(`- **Module:** ${mod}`)
  if (ctx.packageName) facts.push(`- **Package:** ${ctx.packageName}`)
  facts.push(`- **Language:** ${PORT_NAME[model.port] ?? model.port}`)
  if (symbol.kind) facts.push(`- **Kind:** ${symbol.kind}`)
  if (ctx.source) facts.push(`- **Source:** ${ctx.source}`)
  if (symbol.exportedFrom) facts.push(`- **Exported from:** ${symbol.exportedFrom}`)
  if (symbol.inheritedFrom) facts.push(`- **Inherited from:** ${symbol.inheritedFrom}`)
  if (symbol.publicOwner && symbol.publicOwner !== symbol.id) facts.push(`- **Public owner:** ${symbol.publicOwner}`)
  if (symbol.extends?.length) facts.push(`- **Bases:** ${symbol.extends.join(', ')}`)
  if (ctx.canonical) facts.push(`- **Page:** ${ctx.canonical}`)
  if (facts.length) out.push(...facts, '')
  if (symbol.apiScope === 'supporting') {
    out.push('This type appears in public signatures. It is not a package entry point.', '')
  }

  const native = ['kotlin', 'scala', 'fsharp'].includes(model.port)
  const sig = symbol.signatures.map((entry) => native && entry.raw ? entry.raw : signatureLine(symbol, entry)).join('\n\n')
  if (sig) out.push(fencedCode(sig), '')

  if (symbol.doc?.summary) out.push(symbol.doc.summary, '')
  if (symbol.doc?.body) out.push(symbol.doc.body, '')

  if (symbol.doc?.examples?.length) {
    out.push('## Examples', '')
    for (const ex of symbol.doc.examples) {
      if (ex.intro) out.push(ex.intro, '')
      out.push(fencedCode(ex.code, ex.lang), '')
    }
  }

  if (symbol.doc?.references?.length) {
    out.push('## References', '')
    for (const reference of symbol.doc.references) out.push(`- [${reference.name}] ${reference.text}`)
    out.push('')
  }
  if (symbol.doc?.deprecated) out.push('## Deprecated', '', symbol.doc.deprecated, '')
  if (symbol.doc?.changed) out.push('## Changed', '', symbol.doc.changed, '')
  for (const note of symbol.doc?.admonitions ?? []) {
    out.push(`> **${note.kind}:** ${note.text.replaceAll('\n', '\n> ')}`, '')
  }

  const { params, returns, raises } = apiEntryFields(symbol, model.port)
  const overloads = (labels: string[]) => labels.length ? ` (for ${labels.map((label) => `\`${label}\``).join('; ')})` : ''
  if (params.length) {
    out.push('## Parameters', '')
    for (const p of params) {
      out.push(`- \`${p.name}\`${p.type ? ` (${p.type})` : ''}${p.doc ? `: ${p.doc}` : ''}${p.since ? ` (added ${p.since})` : ''}${p.deprecated ? ` (deprecated ${p.deprecated})` : ''}${overloads(p.overloads)}`)
    }
    out.push('')
  }

  if (returns.length) {
    out.push('## Returns', '')
    for (const entry of returns) out.push(`${entry.doc}${overloads(entry.overloads)}`, '')
  }

  if (raises.length) {
    out.push('## Raises', '')
    for (const r of raises) out.push(`- \`${r.type}\`${r.doc ? `: ${r.doc}` : ''}${overloads(r.overloads)}`)
    out.push('')
  }

  const signals = memberSignals(model.port, mentions.mentions)
  const members = model.symbols.filter((s) => s.parent === symbol.id).sort(compareMembers(signals))
  const declared = members.filter((member) => !member.inheritedFrom)
  const inherited = members.filter((member) => member.inheritedFrom)
  const appendMembers = (entries: ApiSymbol[]) => {
    for (const member of entries) {
      out.push(`- \`${member.name}\` (${member.kind})${member.doc?.summary ? `: ${member.doc.summary}` : ''}`)
    }
    out.push('')
  }
  if (declared.length) {
    out.push('## Members', '')
    for (const group of apiMemberGroups(declared, signals)) {
      out.push(`### ${group.label}`, '')
      appendMembers(group.members)
    }
  }
  if (inherited.length) {
    out.push('## Inherited members', '')
    appendMembers(inherited)
  }

  // One trailing newline, so the file ends the way a text file should.
  return `${out.join('\n').trimEnd()}\n`
}
