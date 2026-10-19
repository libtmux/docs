import type { SymbolKind } from '@libtmux/api-model'

/** Compact marks retain the documented kind, including module versus method. */
const KIND_MARKS: Record<SymbolKind, string> = {
  class: 'C', interface: 'I', struct: 'S', union: 'U', enum: 'E', trait: 'T',
  module: 'M', function: 'f', method: 'm', property: 'p', attribute: 'a',
  constant: 'k', typealias: 'A', exception: '!',
}

const PROTOCOL_MARKS: Record<string, string> = { tool: 't', prompt: 'P', resource: 'r', 'resource-template': 'R' }
// tmux names borrow the sigils people already type: a shell prompt for commands, `#` for formats.
// A workspace command and option take the tmux marks; a configuration key takes the colon that follows it in YAML.
const TMUX_MARKS: Record<string, string> = { command: '$', option: 'o', hook: 'h', format: '#', key: ':' }
export const kindMark = (kind: string) => KIND_MARKS[kind as SymbolKind] ?? PROTOCOL_MARKS[kind] ?? TMUX_MARKS[kind]

/** Marks drawn at x-height; the rest stand at cap height. A badge lifts these to centre their ink. */
export const markHeight = (mark: string): 'x' | undefined => /^[acemnorsuvwxz:]$|^p$/.test(mark) ? 'x' : undefined

/**
 * How a mark's ink sits on its baseline, so a badge can centre it by font metrics:
 * `x` for a m o p r, `col` for the colon (x-height, no overshoot), `asc` for the ascenders f h k, `tee` for the short t, `cap` for the rest.
 */
export type MarkClass = 'x' | 'col' | 'asc' | 'tee' | 'cap'
export const markClass = (mark: string): MarkClass => mark === ':' ? 'col' : markHeight(mark) ?? (/^[fhk]$/.test(mark) ? 'asc' : mark === 't' ? 'tee' : 'cap')

const namespaceSegments = new Intl.Segmenter('en', { granularity: 'grapheme' })
const FULL_NAMESPACE_LENGTH = 48

/** Keep ordinary namespaces readable; shorten only long paths, preserving their final segment and separators. */
export function abbreviateNamespace(namespace: string): string {
  if ([...namespaceSegments.segment(namespace)].length <= FULL_NAMESPACE_LENGTH) return namespace
  const parts = namespace.split(/(::|[./])/)
  return parts.map((part, index) => index % 2 === 0 && index < parts.length - 1
    ? namespaceSegments.segment(part)[Symbol.iterator]().next().value?.segment ?? '' : part).join('')
}
