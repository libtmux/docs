import type { ApiModel, ApiSymbol, Signature, SourceApiModel, SymbolIndex } from '@libtmux/api-model'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { toMarkdown } from 'mdast-util-to-markdown'
import { boundLabel, membersOf, memberSignals, memberTier, moduleOf, qualifiedNameOf, typeParameterList, type TypeParameter } from '@libtmux/api-model'
import mentions from '../data/mentions.json'
import { PORT_NAME } from './api-models'
import { apiTmuxSections, type ApiTmuxSection } from './api-tmux-sections'
import { apiCommandFacts, apiCommandRelatedLinks, apiEntryFields, apiMemberGroups, apiMethodDetails, anonymousDeclarationLabel, hasScalarMembers, nativeSignatureText, parameterBindingText, signatureMultiline, signatureParameterText, usesNativeSignatures } from './api-sections'
import type { ResolvedUsage } from './tmux-reference'
import { tmuxCommandMentions, tmuxMentionMarkdown } from './tmux-links'
import { productApiIndex } from './product-api'
import { defaultVersionFor } from './versions'
import { apiSignatureLayouts, swiftBaseName, type CodeLayout } from './code-layout'
import { apiCallSource, apiRelationshipSections, type ApiRelationshipPath } from './api-relationships'
import { PORT_BY_SLUG, productConceptNotice } from './ports'

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
  /** The library methods that send the command a C declaration implements. */
  usage?: ResolvedUsage[]
  catalogLinks?: { name: string; href: string }[]
  paths?: ApiRelationshipPath[]
  symbol: ApiSymbol
  /** Absolute URL of the HTML page this describes. */
  canonical?: string
  /** Repository blob URL for the declaration, when there is one. */
  source?: string
  packageName?: string
  version?: string
  signatureLayouts?: ReadonlyMap<Signature, CodeLayout>
}

function signatureLine(symbol: ApiSymbol, sig: Signature, port?: string): string {
  const multiline = signatureMultiline(symbol, sig, port)
  const params = (sig.params ?? []).map((param) => {
    const text = signatureParameterText(param, port)
    return multiline ? `  ${text.replaceAll('\n', '\n  ')}` : text
  }).join(multiline ? ',\n' : ', ')
  const returns = sig.returns ? `${port === 'ts' ? ':' : ' ->'} ${sig.returns}` : ''
  // A Swift id ends in its selector, which the parameter list spells again.
  const name = port === 'swift' ? swiftBaseName(qualifiedNameOf(symbol)) : qualifiedNameOf(symbol)
  return `${name}(${multiline ? '\n' : ''}${params}${multiline ? '\n' : ''})${returns}`
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

/** A reference as Markdown, linked as the page links it: whole when it resolves, by the names in its literal when it does not. */
function referenceMarkdown(span: { label: string; link?: { href: string }; parts?: { text: string; link?: { href: string } }[] }): string | undefined {
  if (span.link) return `[${inlineCode(span.label)}](${span.link.href})`
  if (!span.parts?.some((part) => part.link)) return undefined
  let plain = ''
  let linked = ''
  for (const part of span.parts) {
    if (!part.link) { plain += part.text; continue }
    if (plain) { linked += inlineCode(plain); plain = '' }
    linked += `[${inlineCode(part.text)}](${part.link.href})`
  }
  if (plain) linked += inlineCode(plain)
  return linked
}

function proseMarkdown(markdown: string, index: SymbolIndex, symbol: ApiSymbol, linkApi: boolean): string {
  if (!linkApi && !/\btmux\s|[-_]/.test(markdown)) return markdown
  // Use the HTML resolver for prose exports too. Never rewrite runnable code
  // blocks or the contents of an author-supplied link.
  const edits: { start: number; end: number; text: string }[] = []
  const unclaimed: typeof edits = []
  let htmlDepth = 0
  const visit = (node: ReturnType<typeof fromMarkdown> | ReturnType<typeof fromMarkdown>['children'][number]) => {
    if (node.type === 'link' || node.type === 'linkReference' || node.type === 'code') return
    if (node.type === 'html') {
      for (const tag of node.value.matchAll(/<(\/?)(?:a|code|pre)\b[^>]*>/gi)) htmlDepth = Math.max(0, htmlDepth + (tag[1] ? -1 : 1))
      return
    }
    if (node.type === 'inlineCode' || node.type === 'text') {
      if (htmlDepth) return
      const start = node.position!.start.offset!
      const end = node.position!.end.offset!
      const tmux = tmuxMentionMarkdown(node.value, node.type === 'inlineCode', undefined,
        { before: markdown.slice(Math.max(0, start - 48), start), after: markdown.slice(end, end + 48) })
      if (tmux && (node.type === 'inlineCode' || markdown.slice(start, end) === node.value)) {
        // A command claims its span; a library symbol outranks an option, hook or format variable.
        if (linkApi && node.type === 'inlineCode' && !tmuxCommandMentions(node.value, { code: true }).length) {
          unclaimed.push({ start, end, text: tmux })
        } else {
          edits.push({ start, end, text: tmux })
          return
        }
      }
      if (!linkApi) return
      if (node.type === 'inlineCode') {
        // The span the page links: `docSpans` is what `ApiDoc` renders, so a name the page leaves plain stays plain here.
        const reference = index.docSpans(markdown.slice(start, end), symbol).find((span) => span.kind === 'ref')
        const linked = reference?.kind === 'ref' ? referenceMarkdown(reference) : undefined
        if (linked) edits.push({ start, end, text: linked })
      } else if (markdown.slice(start, end) === node.value) {
        const spans = index.docSpans(node.value, symbol)
        const linked = spans.map((span) => (span.kind === 'ref' ? referenceMarkdown(span) : undefined))
        if (linked.some(Boolean)) edits.push({ start, end,
          text: spans.map((span, i) => linked[i] ?? ('text' in span ? span.text : span.label)).join('') })
      }
    } else if ('children' in node) for (const child of node.children) visit(child as Parameters<typeof visit>[0])
  }
  visit(fromMarkdown(markdown))
  for (const edit of unclaimed) if (!edits.some((claimed) => claimed.start === edit.start)) edits.push(edit)
  for (const edit of edits.sort((a, b) => b.start - a.start)) markdown = markdown.slice(0, edit.start) + edit.text + markdown.slice(edit.end)
  return markdown
}

/** Production export prepares the same native layouts used by ApiEntry. */
export async function symbolMarkdownWithLayout(ctx: MarkdownContext): Promise<string> {
  const language = 'language' in ctx.model ? ctx.model.language : ctx.model.port
  return symbolMarkdown({ ...ctx, signatureLayouts: await apiSignatureLayouts(ctx.symbol, language) })
}

/** The methods that send a command, one line per scope. */
function usageMarkdown(usage: ResolvedUsage): string[] {
  const lines = [`These methods send [\`${usage.command}\`](${usage.manualHref}):`, '']
  for (const group of usage.groups) {
    const flag = group.scope && (group.scope.flag || group.scope.target) ? ` \`-${group.scope.flag || group.scope.target}\`` : ''
    const target = group.function ? ` ([\`${group.function.name}\`](${group.function.href}))` : ''
    const ports = group.ports.map((entry) => `${entry.name}: ${entry.links.map((link) => `[\`${link.label}\`](${link.href})`).join(', ')}`)
    lines.push(`- ${group.scope?.label ?? 'Any scope'}${flag}${target}: ${ports.join('; ')}`)
  }
  return lines
}

/** The sections the page shows between its relationships and its related types, in the same order and with the same rows. */
function tmuxSectionMarkdown(section: ApiTmuxSection): string[] {
  const out = [`## ${section.label}`, '', section.intro, '']
  const link = (name: string, href: string) => `[${inlineCode(name)}](${href})`
  if (section.type === 'commands') {
    for (const item of section.items) {
      const scope = item.scope ? ` ${item.scope.flag || item.scope.target ? inlineCode(`-${item.scope.flag || item.scope.target}`) : item.scope.label}` : ''
      out.push(`- ${link(item.command, item.href)}${scope}${item.when ? ` (${item.when})` : ''}`)
    }
  } else if (section.type === 'c-api') {
    for (const item of section.direct) out.push(`- ${link(item.name, item.href)} (${item.kind})`)
    if (section.note) out.push('', section.note)
    for (const path of section.paths) {
      out.push('', `### ${path.title}`, '')
      for (const item of path.items) out.push(`${item.degree}. ${item.degree > 1 ? 'calls → ' : ''}${link(item.name, item.href)} (${item.kind})`)
    }
  } else if (section.type === 'catalog') {
    for (const item of section.items) out.push(`- [${item.name}](${item.href}) (${section.catalog})`)
  } else if (section.type === 'guides') {
    for (const group of section.groups) {
      if (section.groups.length > 1) out.push(`### ${group.label}`, '')
      for (const item of group.items) out.push(`- [${item.title}](${item.href})`)
      out.push('')
    }
  } else {
    out.length = 2
    const cell = (text: string) => text.replaceAll('|', '\\|').replaceAll('\n', ' ')
    for (const group of section.groups) {
      out.push(group.label, '', `| Language | ${group.table.groups[0].heading} |`, '| --- | --- |')
      for (const row of group.table.groups[0].ports) {
        const links = row.links.map((entry) => `${link(entry.label, entry.href)}${entry.kind ? ` (${entry.kind})` : ''}`)
        out.push(`| ${row.name} | ${cell([...links, row.note].filter(Boolean).join(row.links.length && row.note ? '. ' : ''))} |`)
      }
      out.push('', ...(group.table.absent ? [group.table.absent, ''] : []))
    }
  }
  while (out.at(-1) === '') out.pop()
  return out
}

export function symbolMarkdown(ctx: MarkdownContext): string {
  const { model, symbol } = ctx
  const port = 'port' in model ? model.port : undefined
  const language = 'language' in model ? model.language : port
  const index = ctx.index ?? (port && 'port' in model ? productApiIndex(model, ctx.version ?? defaultVersionFor(port)) : undefined)
  const prose = (text: string) => index ? proseMarkdown(text, index, symbol, ['powershell', 'scala', 'ts'].includes(language ?? '')) : text
  const id = qualifiedNameOf(symbol)
  const out: string[] = [`# ${id}`, '']
  const info = port ? PORT_BY_SLUG[port] : undefined
  const notice = info && (symbol.product === 'mcp' || symbol.product === 'workspace')
    ? productConceptNotice(info, symbol.product) : undefined
  if (notice) out.push(`**${notice.title}** ${notice.body}`, '')

  // The definition block, in the same order the page shows it.
  const facts: string[] = []
  const parent = symbol.parent ? model.symbols.find((entry) => entry.id === symbol.parent) : undefined
  const mod = moduleOf(parent ?? symbol)
  if (mod) facts.push(`- **Module:** ${mod}`)
  if (ctx.packageName) facts.push(`- **Package:** ${ctx.packageName}`)
  facts.push(`- **Language:** ${(port ? PORT_NAME[port] ?? port : language?.toUpperCase())}`)
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
        if (!part.link) { plain += part.text; continue }
        if (plain) { parts.push(inlineCode(plain)); plain = '' }
        parts.push(`[${inlineCode(part.text)}](${part.link.href})`)
      }
      if (plain) parts.push(inlineCode(plain))
      return parts.join('')
    })
    facts.push(`- **Bases:** ${bases.join(', ')}`)
  }
  if (ctx.canonical) facts.push(`- **Page:** ${ctx.canonical}`)
  if (facts.length) out.push(...facts, '')
  // A C declaration keeps its lines; a library symbol's links are the sections written after the relationships.
  for (const command of ctx.manualLinks ?? []) out.push(`tmux command: [\`${command.name}\`](${command.href})`, '')
  if (ctx.catalogLinks?.length) out.push(`tmux catalog: ${ctx.catalogLinks.map((entry) => `[${entry.name}](${entry.href})`).join(', ')}`, '')
  if (symbol.apiScope === 'supporting') {
    out.push('This type appears in public signatures. It is not a package entry point.', '')
  }

  const native = usesNativeSignatures(symbol, language)
  if (language === 'julia' && symbol.kind === 'typealias' && symbol.type) {
    out.push(fencedCode(`${symbol.name} = ${symbol.type}`, 'julia'), '')
  }
  const signatures = language === 'c' ? symbol.signatures.filter((signature) => signature.raw) : symbol.signatures
  // A parameter set names its declaration whether or not the text was laid out.
  const setLabel = (entry: Signature) => entry.label && entry.label !== '__AllParameterSets' ? `${entry.label}${entry.isDefault ? ' (default)' : ''}:\n` : ''
  const sig = signatures.map((entry) => {
    const layout = ctx.signatureLayouts?.get(entry)?.text
    return layout !== undefined ? `${setLabel(entry)}${layout}` : native && entry.raw
      ? `${setLabel(entry)}${nativeSignatureText(symbol, entry, language)}` : signatureLine(symbol, entry, language)
  }).join('\n\n')
  if (sig) out.push(fencedCode(sig, language === 'c' ? 'c' : ''), '')
  else if (parent?.variant && symbol.type) out.push(fencedCode(`${symbol.name}: ${symbol.type}`, language), '')
  else if (symbol.value !== undefined) out.push(fencedCode(`${qualifiedNameOf(symbol)}${symbol.type ? `: ${symbol.type}` : ''} = ${symbol.value}`, language ?? ''), '')
  else if (language === 'c') out.push(`${anonymousDeclarationLabel(symbol)}.`, '')

  if (symbol.doc?.summary) out.push(prose(symbol.doc.summary), '')
  if (symbol.doc?.body) out.push(prose(symbol.doc.body), '')
  if (symbol.command) {
    out.push('## Command details', '')
    for (const fact of apiCommandFacts(symbol, index?.resolve(symbol.id)?.href)) out.push(`- **${fact.label}:** ${fact.value}`)
    out.push('')
    const related = apiCommandRelatedLinks(symbol, index)
    if (related.length) out.push('Related APIs:', '', ...related.map((link) => `- [${link.symbol ? inlineCode(link.text) : link.text}](${link.href})`), '')
  }

  const methods = apiMethodDetails(symbol)
  if (methods.length) {
    out.push('## Methods', '')
    for (const [methodIndex, method] of methods.entries()) {
      const { signature } = method
      if (symbol.signatures.length > 1) {
        const declaration = ctx.signatureLayouts?.get(signature)?.text ?? nativeSignatureText(symbol, signature, language)
        if (declaration.includes('\n')) out.push(`### ${inlineCode(symbol.name)} (overload ${methodIndex + 1})`, '', fencedCode(declaration, language), '')
        else out.push(`### ${inlineCode(method.label)}`, '')
      }
      if (signature.extension) out.push(`Available when \`${signature.extension}\` is loaded.`, '')
      const source = signature.source
      if (source?.repo && source.revision && source.file) {
        const href = `https://github.com/${source.repo}/blob/${source.revision}/${source.file}${source.line ? `#L${source.line}` : ''}`
        if (methods.length > 1 || href !== ctx.source) out.push(`[Source](${href}).`, '')
      }
      if (signature.doc?.summary) out.push(signature.doc.summary, '')
      if (signature.doc?.body) out.push(signature.doc.body, '')
    }
  }

  if (symbol.doc?.examples?.length) {
    out.push('## Examples', '')
    for (const ex of symbol.doc.examples) {
      if (ex.intro) out.push(ex.intro, '')
      if (ex.sourceUrl) out.push(`[Source example](${ex.sourceUrl}).`, '')
      out.push(fencedCode(ex.code, ex.lang), '')
      if (ex.outro) out.push(ex.outro, '')
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

  const { params, returns, raises, typeParameters } = apiEntryFields(symbol, language)
  const overloads = (labels: string[]) => labels.length ? ` (for ${labels.map(inlineCode).join('; ')})` : ''
  const inheritedTypeParameters = index?.inheritedTypeParameters(symbol) ?? []
  if (typeParameters.length || inheritedTypeParameters.length) {
    out.push('## Type parameters', '')
    const label = (p: TypeParameter) => `${p.modifier ? `${p.modifier}${/^[+-]$/.test(p.modifier) ? '' : ' '}` : ''}${p.name}`
    // The page's own facts, in the order it shows them.
    const facts = (p: TypeParameter) => {
      const found = [p.bound && `${boundLabel(language, p).toLowerCase()} ${inlineCode(p.bound.replaceAll('\n', ' '))}`,
        p.default && `default ${inlineCode(p.default.replaceAll('\n', ' '))}`].filter(Boolean)
      return found.length ? ` (${found.join(', ')})` : ''
    }
    const doc = (p: TypeParameter) => p.doc ? `: ${p.doc.replace(/\s+/g, ' ')}` : ''
    for (const p of typeParameters) out.push(`- ${inlineCode(label(p))}${facts(p)}${doc(p)}${overloads(p.overloads)}`)
    for (const { owner, parameter: p, href } of inheritedTypeParameters) {
      const declared = `${owner.name}${typeParameterList(language, index?.typeParametersDeclaredBy(owner) ?? [])}`
      out.push(`- [${inlineCode(label(p))}](${href}), declared by [${inlineCode(declared)}](${href.split('#')[0]})${facts(p)}${doc(p)}`)
    }
    out.push('')
  }
  if (params.length) {
    out.push('## Parameters', '')
    for (const p of params) {
      const blockDoc = ['julia', 'ts'].includes(language ?? '') && p.doc?.includes('\n')
      out.push(`- ${inlineCode(p.name + (p.optional ? '?' : ''))}${p.type ? ` (${inlineCode(p.type.replaceAll('\n', ' '))})` : ''}${p.doc && !blockDoc ? `: ${p.doc}` : ''}${p.since ? ` (added ${p.since})` : ''}${p.deprecated ? ` (deprecated ${p.deprecated})` : ''}${overloads(p.overloads)}`)
      if (blockDoc) out.push('', ...p.doc!.split('\n').map((line) => `  ${line}`), '')
      if (['julia', 'ts'].includes(language ?? '') && p.default !== undefined) out.push(`  Default: ${inlineCode(p.default)}.`)
      const binding = parameterBindingText(p)
      if (binding) out.push(`  ${binding}`)
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
      out.push(`- ${ctx.hrefFor ? `[${inlineCode(member.name)}](${ctx.hrefFor(member)})` : inlineCode(member.name)} (${symbol.variant && member.type ? inlineCode(member.type) : member.kind})${member.inheritedFrom ? `, inherited from ${inlineCode(member.inheritedFrom)}` : ''}${member.doc?.summary ? `: ${member.doc.summary}` : ''}`)
    }
    out.push('')
  }
  if (declared.length) {
    out.push(symbol.variant ? '## Fields' : '## Members', '')
    if (hasScalarMembers(symbol, declared)) {
      out.push('| Name | Value | Description |', '| --- | --- | --- |')
      const cell = (text: string) => text.replaceAll('|', '\\|').replaceAll('\n', ' ')
      for (const member of declared) {
        const name = ctx.hrefFor ? `[${inlineCode(member.name)}](${ctx.hrefFor(member)})` : inlineCode(member.name)
        out.push(`| ${cell(name)} | ${cell(inlineCode(member.value!))} | ${cell(member.doc?.summary ?? '')} |`)
      }
      out.push('')
    } else for (const group of apiMemberGroups(declared, signals)) {
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
    for (const path of paths) out.push(`### ${path.title}`, '', path.symbols.map((entry, i) =>
      `${i > 0 ? ` — ${path.edges[i - 1] === 'call' ? 'calls' : 'references'} → ` : ''}${symbolLink(entry)}`).join(''), '')
  }
  for (const section of apiRelationshipSections(model, symbol)) {
    out.push(`## ${section.label}`, '')
    for (const target of section.items) {
      const callSource = section.id === 'api-calls' ? apiCallSource(model, symbol, target)
        : section.id === 'api-called-by' ? apiCallSource(model, target, symbol) : undefined
      out.push(`- ${symbolLink(target)} (${target.kind})${callSource ? ` [Call site](${callSource})` : ''}`)
    }
    out.push('')
  }

  for (const section of ctx.manualLinks ? [] : apiTmuxSections(port, symbol)) out.push(...tmuxSectionMarkdown(section), '')
  if (ctx.usage?.length) {
    out.push('## In libtmux', '')
    for (const entry of ctx.usage) out.push(...usageMarkdown(entry), '')
  }

  // One trailing newline, so the file ends the way a text file should.
  let markdown = `${out.join('\n').trimEnd()}\n`
  if (language === 'julia' && index) {
    const edits: { start: number; end: number; text: string }[] = []
    const visit = (node: ReturnType<typeof fromMarkdown> | ReturnType<typeof fromMarkdown>['children'][number]) => {
      if (node.type === 'link' && /^@ref(?:\s|$)/.test(node.url)) {
        const label = node.children.map((child) => 'value' in child ? child.value : '').join('')
        const target = node.url.slice(4).trim() || label
        const link = index.resolve(target, 'any', symbol)
        if (!link) throw new Error(`Unresolved Julia documentation link: ${symbol.id} -> ${target}`)
        node.url = link.href
        edits.push({ start: node.position!.start.offset!, end: node.position!.end.offset!, text: toMarkdown(node).trimEnd() })
      } else if ('children' in node) for (const child of node.children) visit(child as Parameters<typeof visit>[0])
    }
    visit(fromMarkdown(markdown))
    for (const edit of edits.sort((a, b) => b.start - a.start)) markdown = markdown.slice(0, edit.start) + edit.text + markdown.slice(edit.end)
  }

  return markdown
}
