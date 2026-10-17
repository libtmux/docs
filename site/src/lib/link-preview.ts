import { docSummaryText, qualifiedNameOf, sourceUrl, type ApiModel, type ApiSymbol } from '@libtmux/api-model'
import { productApiHref } from './product-api'
import { apiGlossary } from './api-glossary'
import { codeLang, highlightTokens, type CodeHighlight } from './highlight'

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
