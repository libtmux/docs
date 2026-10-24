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
const TMUX_MARKS: Record<string, string> = { command: '$', option: 'o', hook: 'h', format: '#', key: ':', section: '§' }
export const kindMark = (kind: string) => KIND_MARKS[kind as SymbolKind] ?? PROTOCOL_MARKS[kind] ?? TMUX_MARKS[kind]

/** Marks drawn at x-height; the rest stand at cap height. A badge lifts these to centre their ink. */
export const markHeight = (mark: string): 'x' | undefined => /^[acemnorsuvwxz:]$|^p$/.test(mark) ? 'x' : undefined

/**
 * How a mark's ink sits on its baseline, so a badge can centre it by font metrics:
 * `x` for a m o p r, `col` for the colon (x-height, no overshoot), `asc` for the ascenders f h k, `tee` for the short t, `cap` for the rest.
 */
export type MarkClass = 'x' | 'col' | 'asc' | 'tee' | 'cap'
export const markClass = (mark: string): MarkClass => mark === ':' ? 'col' : markHeight(mark) ?? (/^[fhk]$/.test(mark) ? 'asc' : mark === 't' ? 'tee' : 'cap')

/** A member written `Owner#member`, as a doc comment links Ruby and Java members. */
export const memberReference = /^(?:[\w$]+(?:\.[\w$]+)*)?#[^\s#]+(?:\([^#]*\))?$/

/** `label` with the `#` of a member reference as a part of its own, which the page can mark as the separator. */
export const labelParts = (label: string, qualified: boolean) => qualified ? label.split(/(#)/) : [label]

const namespaceSegments = new Intl.Segmenter('en', { granularity: 'grapheme' })
const FULL_NAMESPACE_LENGTH = 48

/** Keep ordinary namespaces readable; shorten only long paths, preserving their final segment and separators. */
export function abbreviateNamespace(namespace: string): string {
  if ([...namespaceSegments.segment(namespace)].length <= FULL_NAMESPACE_LENGTH) return namespace
  const parts = namespace.split(/(::|[./])/)
  return parts.map((part, index) => index % 2 === 0 && index < parts.length - 1
    ? namespaceSegments.segment(part)[Symbol.iterator]().next().value?.segment ?? '' : part).join('')
}

/**
 * Languages whose type names mean nothing without their module: Elixir writes a type as `name/arity` and calls
 * each module's main type `t`, so `t/0` outside its own module has to be `Snapshot.t/0`.
 */
const OWNER_BOUND_TYPES: ReadonlySet<string> = new Set(['elixir'])

/** What the related-types label rule needs to know about one entry. */
export interface RelatedLabelInput {
  id: string
  /** The label before this rule: the name, with the module of a top-level type whose name repeats. */
  label: string
  name: string
  /** The source-qualified spelling the page's own heading and title use. */
  qualifiedName: string
  /** The declaration this one is a member of. */
  owner?: { id: string; name: string }
  /** More than one type in the port has this name. */
  shared: boolean
}

/**
 * `Owner.name` or `Owner::name`: the owner's name and the separator the language's qualified name puts before the entry.
 * An entry with no owner, or whose qualified name does not end in `owner.name`, is spelled in full.
 */
export function ownerQualifiedName({ name, qualifiedName, owner }: RelatedLabelInput): string {
  const head = qualifiedName.endsWith(name) ? qualifiedName.slice(0, qualifiedName.length - name.length) : undefined
  const separator = head?.match(/[^\w$]+$/)?.[0]
  if (!owner || !head || !separator || !head.slice(0, head.length - separator.length).endsWith(owner.name)) return qualifiedName
  return `${owner.name}${separator}${name}`
}

/**
 * The visible labels of one page's related types, in order.
 *
 * A bare name stands when it is unambiguous and the page's own subject owns it. An entry another declaration owns takes
 * that owner when the language binds a type's name to its module, or when more than one type in the port carries the
 * name. Entries that still share a label then take their owner, and last their full name, so no two read alike.
 * Every other label is left as it was.
 *
 * `home` holds the ids of the page's subject and of what contains it; an entry that is one of them, or that one declares,
 * is at home.
 */
export function relatedLabels(inputs: readonly RelatedLabelInput[], home: ReadonlySet<string>, language?: string): string[] {
  const bound = language !== undefined && OWNER_BOUND_TYPES.has(language)
  const atHome = (input: RelatedLabelInput) => home.has(input.id) || (input.owner !== undefined && home.has(input.owner.id))
  const labels = inputs.map((input) => input.owner && !atHome(input) && (bound || input.shared) ? ownerQualifiedName(input) : input.label)
  for (const spell of [ownerQualifiedName, (input: RelatedLabelInput) => input.qualifiedName]) {
    const counts = new Map<string, number>()
    for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1)
    for (const [i, input] of inputs.entries()) if ((counts.get(labels[i]!) ?? 0) > 1) labels[i] = spell(input)
  }
  return labels
}
