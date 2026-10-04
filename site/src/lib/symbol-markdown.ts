import type { ApiModel, ApiSymbol, Signature, SourceApiModel, SymbolIndex } from '@libtmux/api-model'
import { membersOf, memberSignals, memberTier, moduleOf, qualifiedNameOf } from '@libtmux/api-model'
import mentions from '../data/mentions.json'
import { PORT_NAME } from './api-models'
import { apiEntryFields, apiMemberGroups, anonymousDeclarationLabel } from './api-sections'
import { tmuxCommandsFor, tmuxManualUrl } from './tmux-manual-data'
import { productApiIndex } from './product-api'
import { defaultVersionFor } from './versions'
import { apiCallSource, apiRelationshipSections, type ApiRelationshipPath } from './api-relationships'

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
  model: ApiModel | SourceApiModel
  index?: SymbolIndex
  hrefFor?: (symbol: ApiSymbol) => string
  manualLinks?: { name: string; href: string }[]
  paths?: ApiRelationshipPath[]
  symbol: ApiSymbol
  /** Absolute URL of the HTML page this describes. */
  canonical?: string
  /** Repository blob URL for the declaration, when there is one. */
  source?: string
  packageName?: string
  version?: string
}

function signatureLine(symbol: ApiSymbol, sig: Signature): string {
  const params = (sig.params ?? [])
    .map((p) => `${p.name}${p.type ? `: ${p.type}` : ''}${p.default ? ` = ${p.default}` : ''}`)
    .join(', ')
  const returns = sig.returns ? ` -> ${sig.returns}` : ''
  return `${qualifiedNameOf(symbol)}(${params})${returns}`
}

function fencedCode(code: string, language = ''): string {
  const fence = '`'.repeat(Math.max(3, ...[...code.matchAll(/`+/g)].map((match) => match[0].length + 1)))
  return `${fence}${language}\n${code}${code.endsWith('\n') ? '' : '\n'}${fence}`
}

function inlineCode(code: string): string {
  const fence = '`'.repeat(Math.max(1, ...[...code.matchAll(/`+/g)].map((match) => match[0].length + 1)))
  const pad = /^`|`$|^ .* $/.test(code) ? ' ' : ''
  return `${fence}${pad}${code}${pad}${fence}`
}

export function symbolMarkdown(ctx: MarkdownContext): string {
  const { model, symbol } = ctx
  const port = 'port' in model ? model.port : undefined
  const language = 'language' in model ? model.language : port
  const index =
    ctx.index ?? (port && 'port' in model ? productApiIndex(model, ctx.version ?? defaultVersionFor(port)) : undefined)
  const id = qualifiedNameOf(symbol)
  const out: string[] = [`# ${id}`, '']

  // The definition block, in the same order the page shows it.
  const facts: string[] = []
  const parent = symbol.parent ? model.symbols.find((entry) => entry.id === symbol.parent) : undefined
  const mod = moduleOf(parent ?? symbol)
  if (mod) facts.push(`- **Module:** ${mod}`)
  if (ctx.packageName) facts.push(`- **Package:** ${ctx.packageName}`)
  facts.push(`- **Language:** ${port ? (PORT_NAME[port] ?? port) : language?.toUpperCase()}`)
  if (symbol.kind) facts.push(`- **Kind:** ${symbol.kind}`)
  if (ctx.source) facts.push(`- **Source:** ${ctx.source}`)
  if (symbol.exportedFrom) facts.push(`- **Exported from:** ${symbol.exportedFrom}`)
  if (symbol.inheritedFrom) facts.push(`- **Inherited from:** ${symbol.inheritedFrom}`)
  if (symbol.publicOwner && symbol.publicOwner !== symbol.id) facts.push(`- **Public owner:** ${symbol.publicOwner}`)
  if (symbol.extends?.length) {
    const bases = symbol.extends.map((base) => {
      const parts: string[] = []
      let plain = ''
      for (const part of index?.linkType(base, symbol) ?? [{ text: base }]) {
        if (!part.link) {
          plain += part.text
          continue
        }
        if (plain) {
          parts.push(inlineCode(plain))
          plain = ''
        }
        parts.push(`[${inlineCode(part.text)}](${part.link.href})`)
      }
      if (plain) parts.push(inlineCode(plain))
      return parts.join('')
    })
    facts.push(`- **Bases:** ${bases.join(', ')}`)
  }
  if (ctx.canonical) facts.push(`- **Page:** ${ctx.canonical}`)
  if (facts.length) out.push(...facts, '')
  const commands =
    ctx.manualLinks ??
    (port
      ? tmuxCommandsFor(port, symbol.publicId ?? symbol.id).map((command) => ({
          ...command,
          href: tmuxManualUrl('latest', command.name),
        }))
      : [])
  for (const command of commands) out.push(`tmux command: [\`${command.name}\`](${command.href})`, '')
  if (symbol.apiScope === 'supporting') {
    out.push('This type appears in public signatures. It is not a package entry point.', '')
  }

  const native = ['kotlin', 'scala', 'fsharp', 'c'].includes(language ?? '')
  const signatures = language === 'c' ? symbol.signatures.filter((signature) => signature.raw) : symbol.signatures
  const sig = signatures.map((entry) => (native && entry.raw ? entry.raw : signatureLine(symbol, entry))).join('\n\n')
  if (sig) out.push(fencedCode(sig, language === 'c' ? 'c' : ''), '')
  else if (language === 'c') out.push(`${anonymousDeclarationLabel(symbol)}.`, '')

  if (symbol.doc?.summary) out.push(symbol.doc.summary, '')
  if (symbol.doc?.body) out.push(symbol.doc.body, '')

  if (symbol.doc?.examples?.length) {
    out.push('## Examples', '')
    for (const ex of symbol.doc.examples) {
      if (ex.intro) out.push(ex.intro, '')
      if (ex.sourceUrl) out.push(`[Source example](${ex.sourceUrl}).`, '')
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

  const { params, returns, raises } = apiEntryFields(symbol, language)
  const overloads = (labels: string[]) => (labels.length ? ` (for ${labels.map(inlineCode).join('; ')})` : '')
  if (params.length) {
    out.push('## Parameters', '')
    for (const p of params) {
      out.push(
        `- ${inlineCode(p.name)}${p.type ? ` (${inlineCode(p.type)})` : ''}${p.doc ? `: ${p.doc}` : ''}${p.since ? ` (added ${p.since})` : ''}${p.deprecated ? ` (deprecated ${p.deprecated})` : ''}${overloads(p.overloads)}`,
      )
    }
    out.push('')
  }

  if (returns.length) {
    out.push('## Returns', '')
    for (const entry of returns) out.push(`${entry.doc}${overloads(entry.overloads)}`, '')
  }

  if (raises.length) {
    out.push('## Raises', '')
    for (const r of raises) {
      const href = index?.resolve(r.type, 'class', symbol)?.href
      const label = inlineCode(r.type)
      out.push(`- ${href ? `[${label}](${href})` : label}${r.doc ? `: ${r.doc}` : ''}${overloads(r.overloads)}`)
    }
    out.push('')
  }

  const signals = memberSignals(port ?? '', mentions.mentions)
  const members = membersOf(model, symbol, signals)
  const declared = members.filter((member) => !member.inheritedFrom || memberTier(member, signals) === 'parent')
  const inherited = members.filter((member) => member.inheritedFrom && memberTier(member, signals) !== 'parent')
  const appendMembers = (entries: ApiSymbol[]) => {
    for (const member of entries) {
      out.push(
        `- ${ctx.hrefFor ? `[${inlineCode(member.name)}](${ctx.hrefFor(member)})` : inlineCode(member.name)} (${member.kind})${member.inheritedFrom ? `, inherited from ${inlineCode(member.inheritedFrom)}` : ''}${member.doc?.summary ? `: ${member.doc.summary}` : ''}`,
      )
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

  const symbolLink = (target: ApiSymbol) => {
    const name = inlineCode(qualifiedNameOf(target))
    return ctx.hrefFor ? `[${name}](${ctx.hrefFor(target)})` : name
  }
  const paths = (ctx.paths ?? []).filter((path) => path.symbols.some((entry) => entry.id === symbol.id))
  if (paths.length) {
    out.push('## Paths through the source', '', 'Arrows name source relationships, not a runtime execution order.', '')
    for (const path of paths)
      out.push(
        `### ${path.title}`,
        '',
        path.symbols
          .map(
            (entry, i) =>
              `${i > 0 ? ` — ${path.edges[i - 1] === 'call' ? 'calls' : 'references'} → ` : ''}${symbolLink(entry)}`,
          )
          .join(''),
        '',
      )
  }
  for (const section of apiRelationshipSections(model, symbol)) {
    out.push(`## ${section.label}`, '')
    for (const target of section.items) {
      const callSource =
        section.id === 'api-calls'
          ? apiCallSource(model, symbol, target)
          : section.id === 'api-called-by'
            ? apiCallSource(model, target, symbol)
            : undefined
      out.push(`- ${symbolLink(target)} (${target.kind})${callSource ? ` [Call site](${callSource})` : ''}`)
    }
    out.push('')
  }

  // One trailing newline, so the file ends the way a text file should.
  return `${out.join('\n').trimEnd()}\n`
}
