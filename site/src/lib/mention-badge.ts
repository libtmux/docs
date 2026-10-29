import { kindMark, markClass, type MarkClass } from './api-labels.ts'
import { cardDom, cardHtml, type CardElement } from './link-preview-card.ts'

/** tmux kinds read as words in the badge's tooltip; the glyph stays in `kindMark`. */
export const TMUX_KIND_TITLES: Record<string, string> = {
  command: 'tmux command', option: 'tmux option', hook: 'tmux hook', format: 'tmux format variable',
}

/** The kind as a word, for a tooltip and an accessible name. */
export const kindWord = (kind: string) => TMUX_KIND_TITLES[kind] ?? kind.replace(/-/g, ' ')

/**
 * The kind badge that leads a mention link, as one description every renderer of the format reads.
 * Markdown pages, doc comments, reference indexes and the Sphinx pages draw it into different trees from
 * `mentionBadgeHtml`, `mentionBadgeNode` and `mentionBadgeHast`, and none of them restates the classes.
 */
export interface MentionBadge {
  kind: string
  mark: string
  markClass: MarkClass
  /** The badge's own classes; the palette follows the kind. */
  classes: string[]
  title?: string
}

export function mentionBadge(kind: string, title?: string): MentionBadge | undefined {
  const mark = kindMark(kind)
  if (!mark) return undefined
  return { kind, mark, markClass: markClass(mark), classes: ['api-link-kind', 'api-nav__kind', `api-badge--kind-${kind}`], title }
}

/**
 * The badge's elements. Pagefind ignores it: it reads the mark as part of the name that follows,
 * so a search for `Workspace` would otherwise index `CWorkspace`.
 */
export const badgeElement = (badge: MentionBadge): CardElement => ({
  tag: 'span',
  attrs: { class: badge.classes.join(' '), 'data-api-kind': badge.kind, 'aria-hidden': 'true', title: badge.title, 'data-pagefind-ignore': 'all' },
  children: [{ tag: 'span', attrs: { class: 'api-badge__label', 'data-mark': badge.markClass }, children: [badge.mark] }],
})

/** The badge as markup, for a page that writes it into its own HTML. */
export const mentionBadgeHtml = (badge: MentionBadge): string => cardHtml([badgeElement(badge)])

/** The badge as a DOM node of `document`, for a script that marks a page already written. */
export const mentionBadgeNode = (document: Document, badge: MentionBadge): HTMLElement => cardDom(document, [badgeElement(badge)])[0] as HTMLElement

/**
 * A later mention in a section is the link alone. The kind stays in the tooltip and the accessible name,
 * so the reader who needs it can hover or listen for it.
 */
export function plainMention(kind: string, text: string, title?: string) {
  const word = kindWord(kind)
  return { title: title ?? word, dataApiKind: kind, ariaLabel: `${word}: ${text.trim()}` }
}

/** Mark the first mention of a name in a section; every later one stays a plain code link. */
export type First = (key: string) => boolean

/** A `First` for one run of prose: each key is marked once. */
export function firstMention(): First {
  const seen = new Set<string>()
  return (key) => !seen.has(key) && Boolean(seen.add(key))
}
