import { describe, expect, it } from 'vitest'
import { proseTexts, type ApiSymbol, type SymbolIndex } from '@libtmux/api-model'
import { TYPE_KINDS } from '../../packages/api-model/src/link'
import { API_MODELS } from '../src/lib/api-models'
import { defaultVersionFor } from '../src/lib/versions'
import { productApiIndex } from '../src/lib/product-api'
import { linkTmuxDoc } from '../src/lib/tmux-links'

/**
 * A literal that resolves to nothing whole is linked name by name. Calling it a call keeps a bare argument from
 * linking to an unrelated member, and must not cost any other link: this holds the new linker to what the
 * previous one linked, over every such literal in every port's model. The three drops are deliberate: a bare value that
 * matched an unrelated member, a control-mode marker such as `%end` that linked the member named `end`, and a kebab-case
 * word such as `control-mode` that linked the member named `mode`. A kebab-case tmux command, option or hook is named
 * whole by the tmux linker before a page draws the parts of its literal, so most of those drops cost a reader nothing;
 * the ones it does not name are listed below, so that a new one is recorded here and not lost without notice.
 */
const indexes: Record<string, SymbolIndex> = Object.fromEntries(Object.entries(API_MODELS).map(([port, model]) => [port, productApiIndex(model, defaultVersionFor(port))]))
const KEYWORD = /^[A-Za-z_]\w*[?!]?:(?:\s|$)/
/** A tmux control-mode marker: a protocol line, whose words are no member's. */
const MARKER = /^%[\w-]+$/
/** A kebab-case word: one name, not two members around a minus. */
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)+$/
/** The kebab-case literals no tmux name claims whole, each of which linked a word of it to an unrelated member. */
const UNCLAIMED_KEBAB = [
  'julia libtmux-workspace', 'rs copy-mode-vi', 'rs even-horizontal', 'rs global-session', 'rs global-window', 'rs main-horizontal', 'rs tree-mode',
]

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
  const tally = { literals: 0, calls: 0, before: 0, after: 0, values: 0, markers: 0, kebab: 0, claimed: 0, unclaimed: new Set<string>(), lost: [] as string[], gained: 0 }
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
            else if (KEBAB.test(label)) {
              tally.kebab++
              // The tmux linker takes a name whole, as the page does before it draws the parts of a literal.
              if (linkTmuxDoc([{ kind: 'ref', role: 'any', target: label, label }])[0]?.kind === 'link') tally.claimed++
              else tally.unclaimed.add(`${port} ${label}`)
            } else if (isValue(label, link)) tally.values++
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

  it('lose no link the previous linker made, except a bare value inside a call\'s parentheses, a control-mode marker and a kebab-case word', () => {
    expect(tally.lost).toEqual([])
  })

  it('still drop that value, those markers and those words, so the comparison above is tested against the cases it exists for', () => {
    expect(tally.values).toBeGreaterThan(0)
    expect(tally.markers).toBeGreaterThan(0)
    expect(tally.kebab).toBeGreaterThan(0)
    expect(tally.after).toBe(tally.before - tally.values - tally.markers - tally.kebab + tally.gained)
  })

  it('name every kebab-case word that no tmux name claims, and find the rest claimed by the tmux linker', () => {
    expect([...tally.unclaimed].sort()).toEqual(UNCLAIMED_KEBAB)
    expect(tally.claimed).toBeGreaterThan(tally.kebab / 2)
  })

  it('cover signature-style references, chained calls and nested arguments across the ports', () => {
    expect(tally.literals).toBeGreaterThan(1000)
    expect(tally.calls).toBeGreaterThan(100)
  })
})
