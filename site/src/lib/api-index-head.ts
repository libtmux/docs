/**
 * What a port's reference home says about itself: counts and the source revision, from the model.
 *
 * The counts are computed from the declarations the page indexes, never typed, so they move with the model.
 */
import { OWNER_KINDS, symbolsForProduct, type ApiModel, type ApiSymbol } from '@libtmux/api-model/reference'

export interface IndexCount { word: string; count: number }

const GROUPS: [word: string, one: string, test: (symbol: ApiSymbol) => boolean][] = [
  ['types', 'type', (symbol) => OWNER_KINDS.has(symbol.kind) && symbol.kind !== 'module'],
  ['functions', 'function', (symbol) => symbol.kind === 'function'],
  ['methods', 'method', (symbol) => symbol.kind === 'method'],
  ['fields', 'field', (symbol) => symbol.kind === 'property' || symbol.kind === 'attribute'],
  ['constants', 'constant', (symbol) => symbol.kind === 'constant'],
]

/** Declarations of the core library by kind, in the order a reader looks for them; empty kinds are left out. */
export function indexCounts(model: ApiModel): IndexCount[] {
  const symbols = symbolsForProduct(model, 'core')
  return GROUPS.map(([word, one, test]) => {
    const count = symbols.filter(test).length
    return { word: count === 1 ? one : word, count }
  }).filter((entry) => entry.count > 0)
}

/** "237 types, 78 functions and 1604 methods". */
export function countsSentence(counts: IndexCount[]): string {
  return new Intl.ListFormat('en-GB', { type: 'conjunction' }).format(counts.map((entry) => `${entry.count.toLocaleString('en-US')} ${entry.word}`))
}

/** The letter the port's alphabetical index opens on: the first alphanumeric start of a documented name. */
export function firstIndexLetter(model: ApiModel): string {
  const letters = symbolsForProduct(model, 'core').map((symbol) => /[a-z0-9]/i.exec(symbol.name)?.[0]?.toLowerCase()).filter(Boolean) as string[]
  return letters.sort()[0] ?? 'a'
}

/** `owner/repo@revision`, the way the reference cites the source it documents. */
export function sourceRevision(model: ApiModel): string | undefined {
  return model.repo && model.revision ? `${model.repo}@${model.revision.slice(0, 12)}` : undefined
}
