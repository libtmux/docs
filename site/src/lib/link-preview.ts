import { docSummaryText, qualifiedNameOf, sourceUrl, type ApiModel, type ApiSymbol } from '@libtmux/api-model'
import { productApiHref } from './product-api'
import { apiGlossary } from './api-glossary'
import { codeLang, highlightTokens, type CodeHighlight } from './highlight'
import { tmuxEntityHref } from './tmux-links'
import { tmuxManual, tmuxManualEntities, tmuxManualUrl, type TmuxManualEntity } from './tmux-manual-data'

/** Small, inert metadata shared by reference links and their preview cards. */
export interface LinkPreview {
  schema: 1
  title: string
  kind?: string
  description: string
  detail?: string
  signature?: string
  signatureLanguage?: string
  signatureHighlight?: CodeHighlight
  href: string
  /** Replaces the card's default "Open reference" link text. */
  actionLabel?: string
  source?: string
  terms?: Record<string, LinkPreview>
}

export function symbolPreview(model: ApiModel, symbol: ApiSymbol, version: string): LinkPreview {
  const summary = symbol.doc?.summary ?? symbol.signatures.find((signature) => signature.doc?.summary)?.doc?.summary
  const signature = symbol.signatures[0]?.raw ?? (symbol.value !== undefined ? `${symbol.name} = ${symbol.value}` : undefined)
  return {
    schema: 1, title: qualifiedNameOf(symbol), kind: symbol.command?.kind ?? symbol.kind,
    description: summary ? docSummaryText(summary, model.port) : '',
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
      href: `${glossary.path}#${term.id}`,
    } satisfies LinkPreview]))),
  }
}

const MANUAL_ACTION = 'Open manual'

function tmuxEntityPreview(entity: TmuxManualEntity, version: string): LinkPreview {
  return {
    schema: 1, title: entity.name, kind: entity.kind, description: entity.summary || entity.detail, detail: entity.detail,
    signature: entity.usage, signatureLanguage: entity.usage ? 'tmux-usage' : undefined,
    href: tmuxEntityHref(entity.kind, entity.name, version)!, actionLabel: MANUAL_ACTION,
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
    detail: command.alias ? `Alias: ${command.alias}.` : undefined, actionLabel: MANUAL_ACTION,
  }
}
