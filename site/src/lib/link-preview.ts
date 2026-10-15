import { docSummaryText, qualifiedNameOf, sourceUrl, type ApiModel, type ApiSymbol } from '@libtmux/api-model'
import { productApiHref } from './product-api'
import { API_GLOSSARY_GROUPS, ALL_GLOSSARY_GROUPS, API_GLOSSARY_PATH, MCP_GLOSSARY_TITLE, MCP_GLOSSARY_DESCRIPTION } from './api-glossary'
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
  return {
    schema: 1, title: qualifiedNameOf(symbol), kind: symbol.command?.kind ?? symbol.kind,
    description: summary ? docSummaryText(summary, model.port) : '',
    signature: symbol.signatures[0]?.raw,
    signatureLanguage: symbol.signatures[0]?.raw ? codeLang(model.port) : undefined,
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
  const mcp = href.includes('/mcp/reference/')
  const groups = mcp || href === API_GLOSSARY_PATH ? ALL_GLOSSARY_GROUPS : API_GLOSSARY_GROUPS
  return { schema: 1, title: mcp ? MCP_GLOSSARY_TITLE : 'API glossary', description: mcp ? MCP_GLOSSARY_DESCRIPTION : 'Definitions of API kinds, modifiers, packages, and MCP annotations.', href,
    terms: Object.fromEntries(groups.flatMap((group) => group.terms.map((term) => [term.id, {
      schema: 1, title: term.id, kind: term.id, description: term.definition, detail: term.detail,
      href: `${href}#${term.id}`,
    } satisfies LinkPreview]))),
  }
}
