import { describe, expect, it } from 'vitest'
import { proseTexts, type ApiSymbol, type SymbolIndex } from '@libtmux/api-model'
import { TYPE_KINDS } from '../../packages/api-model/src/link'
import { API_MODELS } from '../src/lib/api-models'
import { defaultVersionFor } from '../src/lib/versions'
import { productApiIndex } from '../src/lib/product-api'

/**
 * A literal that resolves to nothing whole is linked name by name. Calling it a call keeps a bare argument from
 * linking to an unrelated member, and must not cost any other link: this holds the new linker to what the
 * previous one linked, over every such literal in every port's model. The two drops are deliberate: a bare value that
 * matched an unrelated member, and a control-mode marker such as `%end` that linked the member named `end`.
 */
const indexes: Record<string, SymbolIndex> = Object.fromEntries(Object.entries(API_MODELS).map(([port, model]) => [port, productApiIndex(model, defaultVersionFor(port))]))
const KEYWORD = /^[A-Za-z_]\w*[?!]?:(?:\s|$)/
/** A tmux control-mode marker: a protocol line, whose words are no member's. */
const MARKER = /^%[\w-]+$/

interface Link { text: string; href: string; offset: number; kind?: string }
const linksOf = (spans: { text: string; link?: { href: string; symbol?: ApiSymbol } }[]): Link[] => {
  let offset = 0
  return spans.flatMap((span) => {
    const here = offset
    offset += span.text.length
    return span.link ? [{ text: span.text, href: span.link.href, offset: here, kind: span.link.symbol?.kind }] : []
  })
}

/** Whether `link` is a bare name inside parentheses that is a member and not a type: the caller's own value. */
const isValue = (label: string, link: Link) => {
  const before = label.slice(0, link.offset)
  const depth = [...before].reduce((open, char) => Math.max(0, open + (char === '(' ? 1 : char === ')' ? -1 : 0)), 0)
  return depth > 0 && link.kind !== undefined && !TYPE_KINDS.has(link.kind as never) && !/[.:#/]/.test(link.text) && !/[.:#/>]$/.test(before.trimEnd())
}

function compare() {
  const tally = { literals: 0, calls: 0, before: 0, after: 0, values: 0, markers: 0, lost: [] as string[], gained: 0 }
  for (const [port, model] of Object.entries(API_MODELS)) {
    const index = indexes[port]
    for (const symbol of model.symbols as ApiSymbol[]) {
      for (const { text } of proseTexts(symbol)) {
        for (const span of index.linkText(text, symbol)) {
          if (span.kind !== 'ref' || span.link) continue
          const label = span.label
          tally.literals++
          if (label.includes('(')) tally.calls++
          const previous = linksOf(KEYWORD.test(label) ? [{ text: label }] : index.linkType(label, symbol))
          const current = linksOf(index.linkLiteral(label, symbol))
          tally.before += previous.length
          tally.after += current.length
          const kept = (link: Link) => current.some((other) => other.offset === link.offset && other.href === link.href)
          for (const link of previous.filter((entry) => !kept(entry))) {
            if (MARKER.test(label)) tally.markers++
            else if (isValue(label, link)) tally.values++
            else tally.lost.push(`${port} ${label} lost ${link.text}`)
          }
          tally.gained += current.filter((link) => !previous.some((other) => other.offset === link.offset && other.href === link.href)).length
        }
      }
    }
  }
  return tally
}

describe('the literals a reference page links name by name', () => {
  const tally = compare()

  it('lose no link the previous linker made, except a bare value inside a call\'s parentheses and a control-mode marker', () => {
    expect(tally.lost).toEqual([])
  })

  it('still drop that value and those markers, so the comparison above is tested against the cases it exists for', () => {
    expect(tally.values).toBeGreaterThan(0)
    expect(tally.markers).toBeGreaterThan(0)
    expect(tally.after).toBe(tally.before - tally.values - tally.markers + tally.gained)
  })

  it('cover signature-style references, chained calls and nested arguments across the ports', () => {
    expect(tally.literals).toBeGreaterThan(1000)
    expect(tally.calls).toBeGreaterThan(100)
  })
})
