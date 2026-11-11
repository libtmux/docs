import type { ApiSymbol, Signature } from '@libtmux/api-model'
import { CODE_COLUMNS, codeWidthFailures, type CodeLayout } from './code-layout.ts'

/** Continue native type signatures without changing declarations, literals or links. */
export async function haskellSignatureLayout(symbol: ApiSymbol, signature: Signature): Promise<CodeLayout> {
  if (!signature.raw || !signature.nativeSpans?.length || signature.nativeSpans.map((span) => span.text).join('') !== signature.raw) {
    throw new Error(`Unavailable native Haskell header: ${symbol.id}`)
  }
  let spans = signature.nativeSpans
  let text = signature.raw
  let failures = await codeWidthFailures(text, 'api')
  if (failures.length && text.startsWith(`${symbol.name} :: `)) {
    const separator = spans.findIndex((span) => !span.href && !span.target && !span.declaration && span.text.includes(' :: '))
    spans = spans.map((span, i) => i === separator ? { ...span, text: span.text.replace(' :: ', '\n  :: ') } : span)
    text = spans.map((span) => span.text).join('')
    failures = await codeWidthFailures(text, 'api')
  }
  if (failures.length) {
    let depth = 0
    let quote: '"' | "'" | undefined
    let escaped = false
    spans = spans.map((span) => {
      let continued = ''
      const punctuation = !span.href && !span.target && !span.declaration
      for (let i = 0; i < span.text.length; i++) {
        const character = span.text[i]!
        if (quote) {
          continued += character
          if (escaped) escaped = false
          else if (character === '\\') escaped = true
          else if (character === quote) quote = undefined
          continue
        }
        if (character === '"' || (character === "'" && (span.text[i + 1] === '\\' || span.text[i + 2] === "'"))) {
          quote = character
        } else if (punctuation && depth === 0 && span.text.startsWith(' -> ', i)) {
          continued += '\n  -> '
          i += 3
          continue
        } else if ('([{'.includes(character)) depth++
        else if (')]}'.includes(character)) depth--
        continued += character
      }
      return { ...span, text: continued }
    })
    text = spans.map((span) => span.text).join('')
    failures = await codeWidthFailures(text, 'api')
  }
  return { text, nativeSpans: spans, limit: CODE_COLUMNS.api, failures }
}
