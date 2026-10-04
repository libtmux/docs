import type { SymbolKind } from '@libtmux/api-model'

/** Compact marks retain the documented kind, including module versus method. */
const KIND_MARKS: Record<SymbolKind, string> = {
  class: 'C',
  interface: 'I',
  struct: 'S',
  union: 'U',
  enum: 'E',
  trait: 'T',
  module: 'M',
  function: 'f',
  method: 'm',
  property: 'p',
  attribute: 'a',
  constant: 'k',
  typealias: 'A',
  exception: '!',
}

export const kindMark = (kind: string) => KIND_MARKS[kind as SymbolKind]

const namespaceSegments = new Intl.Segmenter('en', { granularity: 'grapheme' })

/** Preserve the final namespace segment and each language's separators. */
export function abbreviateNamespace(namespace: string): string {
  const parts = namespace.split(/(::|[./])/)
  return parts
    .map((part, index) =>
      index % 2 === 0 && index < parts.length - 1
        ? (namespaceSegments.segment(part)[Symbol.iterator]().next().value?.segment ?? '')
        : part,
    )
    .join('')
}
