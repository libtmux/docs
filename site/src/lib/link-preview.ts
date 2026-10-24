import { docSummaryText, sourceUrl, type ApiModel, type ApiSymbol, type SymbolIndex } from '@libtmux/api-model'
import { productApiHref, productApiIndex } from './product-api'
import { nativePackageName, nativeShortName } from './native-name'
import { PORT_BY_SLUG } from './ports'
import { apiGlossary } from './api-glossary'
import { codeLang, highlightTokens, type CodeHighlight } from './highlight'
import { tmuxEntityHref } from './tmux-links'
import { tmuxManual, tmuxManualEntities, tmuxManualEntityHref, tmuxManualUrl, type TmuxManualEntity } from './tmux-manual-data'

/** A name in a card's summary that has a page of its own, drawn with the mark of its kind. */
export interface PreviewReference {
  text: string
  /** A path on this site. */
  href: string
  kind?: string
}

/** Small, inert metadata shared by reference links and their preview cards. */
export interface LinkPreview {
  schema: 1
  title: string
  kind?: string
  description: string
  /**
   * `description` as runs of text and the references it names, so a card can mark each with its kind. The runs read as
   * `description`; a card that does not use them, or finds that they differ, shows `description` as it is.
   */
  descriptionParts?: (string | PreviewReference)[]
  detail?: string
  signature?: string
  signatureLanguage?: string
  signatureHighlight?: CodeHighlight
  href: string
  /** Where the entry lives, as the muted line at the foot of the card, such as its package and its owner. */
  footer?: string[]
  /** Replaces the card's default "Open reference" link text. */
  actionLabel?: string
  source?: string
  terms?: Record<string, LinkPreview>
}

const symbolsById = new WeakMap<ApiModel, Map<string, ApiSymbol>>()

/** The symbol a member is declared in. */
function ownerOf(model: ApiModel, symbol: ApiSymbol): ApiSymbol | undefined {
  if (!symbol.parent) return undefined
  let table = symbolsById.get(model)
  if (!table) { table = new Map(model.symbols.map((entry) => [entry.id, entry])); symbolsById.set(model, table) }
  return table.get(symbol.parent)
}

/** A description as runs: neighbouring text is one run, and a named reference stands alone. */
export function previewRuns() {
  const parts: (string | PreviewReference)[] = []
  let referenced = false
  return {
    text(text: string) {
      const last = parts.at(-1)
      if (typeof last === 'string') parts[parts.length - 1] = last + text
      else if (text) parts.push(text)
    },
    reference(reference: PreviewReference) { parts.push(reference); referenced = true },
    /** The runs, when one of them names a reference and they read as `description`; a card shows `description` otherwise. */
    finish(description: string): LinkPreview['descriptionParts'] {
      return referenced && parts.map((part) => typeof part === 'string' ? part : part.text).join('') === description ? parts : undefined
    },
  }
}

/** The summary as runs of text and the references that resolve to a page of this site. */
function summaryParts(index: SymbolIndex, summary: string, context: ApiSymbol, description: string): LinkPreview['descriptionParts'] {
  const runs = previewRuns()
  for (const span of index.linkText(summary, context)) {
    const text = span.kind === 'ref' || span.kind === 'citation' ? span.label : span.text
    const target = span.kind === 'ref' && span.link && !span.link.external ? span.link.symbol : undefined
    if (target && target.id !== context.id) runs.reference({ text, href: span.link!.href, kind: target.command?.kind ?? target.kind })
    else runs.text(text)
  }
  return runs.finish(description)
}

/** The package and the owner a card's footer names; an owner that is the package itself, as PowerShell's module is, is said once. */
function footerPlaces(...places: (string | undefined)[]): string[] {
  return places.filter((place): place is string => !!place).filter((place, index, all) => place !== all[index - 1])
}

export function symbolPreview(model: ApiModel, symbol: ApiSymbol, version: string): LinkPreview {
  const summary = symbol.doc?.summary ?? symbol.signatures.find((signature) => signature.doc?.summary)?.doc?.summary
  const signature = symbol.signatures[0]?.raw ?? (symbol.value !== undefined ? `${symbol.name} = ${symbol.value}` : undefined)
  const description = summary ? docSummaryText(summary, model.port) : ''
  const footer = footerPlaces(nativePackageName(model, symbol) ?? PORT_BY_SLUG[model.port]?.packageName, ownerOf(model, symbol)?.name)
  return {
    schema: 1, title: nativeShortName(model, symbol), kind: symbol.command?.kind ?? symbol.kind,
    description,
    descriptionParts: summary ? summaryParts(productApiIndex(model, version), summary, symbol, description) : undefined,
    footer: footer.length ? footer : undefined,
    signature,
    signatureLanguage: signature ? codeLang(model.port) : undefined,
    detail: symbol.signatures.length > 1 ? `${symbol.signatures.length} signatures in the full reference.` : undefined,
    href: productApiHref(model, symbol, version), source: sourceUrl(model, symbol),
  }
}

/** Highlight at endpoint generation without putting a highlighter in the browser. */
export async function highlightedPreview(preview: LinkPreview): Promise<LinkPreview> {
  if (!preview.signature) return preview
  return { ...preview, signatureHighlight: await highlightTokens(preview.signature, preview.signatureLanguage ?? 'text') }
}

export function glossaryPreview(href: string): LinkPreview {
  const glossary = apiGlossary(href)
  return { schema: 1, title: glossary.title, description: glossary.description, href: glossary.path,
    terms: Object.fromEntries(glossary.groups.flatMap((group) => group.terms.map((term) => [term.id, {
      schema: 1, title: term.id, kind: term.id, description: term.definition, detail: term.detail,
      href: `${glossary.path}#${term.id}`, footer: [glossary.title, group.title],
    } satisfies LinkPreview]))),
  }
}

const MANUAL_ACTION = 'Open manual'

/** Where a manual entry lives: the release it describes, then the manual. */
const manualFooter = (version: string) => [`tmux ${tmuxManual(version).version}`, 'Manual']

function tmuxEntityPreview(entity: TmuxManualEntity, version: string): LinkPreview {
  return {
    schema: 1, title: entity.name, kind: entity.kind, description: entity.summary || entity.detail, detail: entity.detail,
    footer: manualFooter(version),
    signature: entity.usage, signatureLanguage: entity.usage ? 'tmux-usage' : undefined,
    href: tmuxManualEntityHref(entity.kind, entity.name, version)!, actionLabel: MANUAL_ACTION,
  }
}

/**
 * Cards for the CLI manual: a command page previews its summary and syntax,
 * and the full manual previews each option, hook and format variable by anchor.
 */
export function tmuxManualPreview(version: string, slug: string): LinkPreview {
  const reference = tmuxManual(version)
  if (slug === 'full') {
    return {
      schema: 1, title: `tmux ${reference.version} manual`, kind: 'manual', href: tmuxManualUrl(version, 'full'),
      description: `Command syntax and behavior for tmux ${reference.version}.`, actionLabel: MANUAL_ACTION,
      terms: Object.fromEntries(tmuxManualEntities(version).map((entity) => [entity.anchor, tmuxEntityPreview(entity, version)])),
    }
  }
  const command = reference.commands.find((entry) => entry.name === slug)
  if (!command) throw new Error(`Unknown tmux command: ${slug}`)
  return {
    schema: 1, title: command.name, kind: 'command', description: command.summary, href: tmuxEntityHref('command', command.name, version)!,
    signature: `tmux ${command.name}${command.usage ? ` ${command.usage}` : ''}`, signatureLanguage: 'tmux-usage',
    detail: command.alias ? `Alias: ${command.alias}.` : undefined, footer: manualFooter(version), actionLabel: MANUAL_ACTION,
  }
}
