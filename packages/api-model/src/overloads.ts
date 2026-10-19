import type { ApiSymbol } from './model.ts'

/**
 * Whether a symbol is something a caller invokes, and so can be one of several
 * signatures sharing a name.
 *
 * Constructors, initializers and operators are `method`s or `function`s here;
 * the model has no kind of their own for them.
 */
export const isCallable = (symbol: Pick<ApiSymbol, 'kind'>): boolean =>
  symbol.kind === 'method' || symbol.kind === 'function'

/**
 * `overload` says one callable has several signatures. Nothing else may carry it.
 *
 * Two declarations sharing an id are not always an overload set. A Rust
 * `struct X` and its `impl X`, a TypeScript `class X` and its `interface X`,
 * C#'s `Result` and `Result<T>`, and a Java field next to the accessor named
 * after it all collapse onto one id. They merge, and the merge keeps whatever
 * the parts say, but a type or a property is not an overload of itself.
 */
export const canOverload = (symbol: Pick<ApiSymbol, 'kind' | 'signatures'>): boolean =>
  isCallable(symbol) && symbol.signatures.length > 1

/** Record that declarations of one callable were merged, where that makes an overload set. */
export function markOverload(symbol: ApiSymbol): void {
  if (canOverload(symbol) && !symbol.modifiers.includes('overload')) symbol.modifiers.push('overload')
}

/** Drop an `overload` a merge carried over from a part that was not an overload set. */
export function retractMisplacedOverload(symbol: ApiSymbol): void {
  if (!canOverload(symbol)) symbol.modifiers = symbol.modifiers.filter((modifier) => modifier !== 'overload')
}

/** Symbols that claim to be an overload set and are not one. */
export const misplacedOverloads = (symbols: readonly ApiSymbol[]): ApiSymbol[] =>
  symbols.filter((symbol) => symbol.modifiers.includes('overload') && !canOverload(symbol))
