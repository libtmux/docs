import type { ApiModel, ApiSymbol } from '@libtmux/api-model'
import { moduleOf } from '@libtmux/api-model'
import { PORT_NAME } from './api-models'

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

function signatureLine(symbol: ApiSymbol): string | undefined {
  const sig = symbol.signatures?.[0]
  if (!sig) return undefined
  const params = (sig.params ?? [])
    .map((p) => `${p.name}${p.type ? `: ${p.type}` : ''}${p.default ? ` = ${p.default}` : ''}`)
    .join(', ')
  const returns = sig.returns ? ` -> ${sig.returns}` : ''
  return `${symbol.publicId ?? symbol.id}(${params})${returns}`
}

export function symbolMarkdown(ctx: MarkdownContext): string {
  const { model, symbol } = ctx
  const id = symbol.publicId ?? symbol.id
  const out: string[] = [`# ${id}`, '']

  // The definition block, in the same order the page shows it.
  const facts: string[] = []
  const mod = moduleOf(symbol)
  if (mod) facts.push(`- **Module:** ${mod}`)
  if (ctx.packageName) facts.push(`- **Package:** ${ctx.packageName}`)
  facts.push(`- **Language:** ${PORT_NAME[model.port] ?? model.port}`)
  if (symbol.kind) facts.push(`- **Kind:** ${symbol.kind}`)
  if (ctx.source) facts.push(`- **Source:** ${ctx.source}`)
  if (ctx.canonical) facts.push(`- **Page:** ${ctx.canonical}`)
  if (facts.length) out.push(...facts, '')
  if (symbol.apiScope === 'supporting') {
    out.push('This type appears in public signatures. It is not a package entry point.', '')
  }

  const sig = signatureLine(symbol)
  if (sig) out.push('```', sig, '```', '')

  if (symbol.doc?.summary) out.push(symbol.doc.summary, '')
  if (symbol.doc?.body) out.push(symbol.doc.body, '')

  const params = symbol.signatures?.[0]?.params ?? []
  if (params.some((p) => p.doc)) {
    out.push('## Parameters', '')
    for (const p of params) {
      out.push(`- \`${p.name}\`${p.type ? ` (${p.type})` : ''}${p.doc ? `: ${p.doc}` : ''}`)
    }
    out.push('')
  }

  const sig0 = symbol.signatures?.[0]
  if (sig0?.returnsDoc) out.push('## Returns', '', sig0.returnsDoc, '')

  if (sig0?.raises?.length) {
    out.push('## Raises', '')
    for (const r of sig0.raises) out.push(`- \`${r.type}\`${r.doc ? `: ${r.doc}` : ''}`)
    out.push('')
  }

  for (const ex of symbol.doc?.examples ?? []) {
    out.push('## Example', '')
    if (ex.intro) out.push(ex.intro, '')
    out.push('```' + (ex.lang ?? ''), ex.code, '```', '')
  }

  const members = model.symbols.filter((s) => s.parent === symbol.id)
  if (members.length) {
    out.push('## Members', '')
    for (const m of members) {
      out.push(`- \`${m.name}\` (${m.kind})${m.doc?.summary ? `: ${m.doc.summary}` : ''}`)
    }
    out.push('')
  }

  // One trailing newline, so the file ends the way a text file should.
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
}
