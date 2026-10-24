import type { CodeHighlight } from './highlight'
import type { LinkPreview, PreviewReference } from './link-preview'
import { abbreviateNamespace, kindMark, markClass } from './api-labels.ts'
import { limitPreviewSignature } from './preview-signature.ts'
import { wordBreak } from './word-break.ts'

/**
 * The hover card, as one description that two renderers read.
 *
 * `previewCard` turns a payload into markup as plain data. `cardHtml` writes it for the page that carries a card in
 * its own HTML (the keyword help of a declaration), and `paintCard` writes it into the card the browser reuses for
 * every reference link. Both read the same description, so a card has the same elements, classes and text however it
 * got onto the page, and a change to the card is a change here.
 *
 * Every slot is an element the browser's card keeps from one link to the next, named by a `data-preview-*` attribute.
 * Painting replaces what is inside a slot and the attributes that depend on the payload; the frame around the slots
 * never depends on it.
 */

type Attributes = Record<string, string | true | undefined>
export interface CardElement { tag: string; attrs?: Attributes; children?: readonly CardNode[] }
export type CardNode = string | CardElement

const h = (tag: string, attrs: Attributes = {}, ...children: CardNode[]): CardElement => ({ tag, attrs, children })

const VOID = new Set(['wbr'])
const escapeText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeAttribute = (text: string) => escapeText(text).replace(/"/g, '&quot;')

/** The markup of `nodes`, for a page that renders the card in its own HTML. */
export function cardHtml(nodes: readonly CardNode[]): string {
  return nodes.map((node) => {
    if (typeof node === 'string') return escapeText(node)
    const attributes = Object.entries(node.attrs ?? {}).flatMap(([name, value]) =>
      value === undefined ? [] : [value === true ? ` ${name}` : ` ${name}="${escapeAttribute(value)}"`]).join('')
    return VOID.has(node.tag) ? `<${node.tag}${attributes}>` : `<${node.tag}${attributes}>${cardHtml(node.children ?? [])}</${node.tag}>`
  }).join('')
}

/** `nodes` as DOM nodes of `document`, the browser's counterpart of `cardHtml`. */
export function cardDom(document: Document, nodes: readonly CardNode[]): Node[] {
  return nodes.map((node) => {
    if (typeof node === 'string') return document.createTextNode(node)
    const element = document.createElement(node.tag)
    for (const [name, value] of Object.entries(node.attrs ?? {})) if (value !== undefined) element.setAttribute(name, value === true ? '' : value)
    element.append(...cardDom(document, node.children ?? []))
    return element
  })
}

/* ---------------------------------------------------------------- the kind */

const KIND_NAME = /^[a-z]+(?:-[a-z]+)*$/

/** A cmdlet keeps its word and takes the function colours, as the heading badge does. */
const kindPalette = (kind: string) => kind === 'cmdlet' ? 'function' : kind

/** The kind as a reader says it. */
const kindWord = (kind: string) => kind.replace(/-/g, ' ')

/** The mark of a kind, or nothing for a name that is not a kind of the reference, such as a glossary term for a modifier. */
function markOf(kind: string | undefined): { palette: string; mark: string } | undefined {
  if (!kind || !KIND_NAME.test(kind)) return undefined
  const palette = kindPalette(kind)
  const mark = kindMark(palette)
  // A name that only an object's prototype knows, such as `constructor`, is not a kind.
  return typeof mark === 'string' ? { palette, mark } : undefined
}

/**
 * The inside of the legend chip: the mark and the word in one token, so the header teaches the letter every time.
 * It is the markup `ApiBadge.astro` writes for a heading, and a test holds the two together.
 */
function legendChipChildren(mark: string | undefined, word: string): CardElement[] {
  return [
    ...(mark ? [h('span', { class: 'api-leg__m', 'aria-hidden': 'true' }, h('span', { class: 'api-leg__g', 'data-mark': markClass(mark) }, mark))] : []),
    h('span', { class: 'api-leg__w' }, h('span', { class: 'api-badge__label api-leg__wl' }, word)),
  ]
}

function legendChip(kind: string | undefined): CardElement | undefined {
  const found = markOf(kind)
  if (!found || !kind) return undefined
  return h('span', { class: `api-badge api-badge--kind api-badge--kind-${found.palette} api-leg`, 'data-mark': markClass(found.mark) },
    ...legendChipChildren(found.mark, kindWord(kind)))
}

/* ------------------------------------------------------------------- the body */

/**
 * A page of this site: a path that resolves on the site's own origin. A browser reads `\` as `/` and drops a tab or a
 * newline inside a URL, so `/\evil.test` and `/<tab>/evil.test` are as far from this site as `//evil.test`. The
 * address is resolved as the browser would, against an origin of no site, and must stay on that origin.
 */
const SITE = 'https://reference.invalid'
function sitePath(href: string): boolean {
  if (!href.startsWith('/')) return false
  try { return new URL(href, SITE).origin === SITE } catch { return false }
}

/**
 * A name in the summary, as prose writes it: its kind's small mark, then the name as a link. The mark is decoration,
 * so the link says the kind itself in its accessible name, and the name the reader sees stays the link's text.
 */
function mention(reference: PreviewReference): CardNode {
  const found = markOf(reference.kind)
  const name = h('code', { class: 'api-literal api-literal--link' }, reference.text)
  if (!found || !reference.kind) return h('a', { class: 'api-xref', href: reference.href }, name)
  const word = kindWord(reference.kind)
  return h('a', { class: 'api-xref', href: reference.href, 'aria-label': `${word}: ${reference.text}` },
    h('span', { class: `api-link-kind api-nav__kind api-badge--kind-${found.palette}`, 'data-api-kind': reference.kind, title: word, 'aria-hidden': 'true' },
      h('span', { class: 'api-badge__label', 'data-mark': markClass(found.mark) }, found.mark)),
    h('span', { class: 'api-symbol-link__name' }, name))
}

const EMPTY_DESCRIPTION = 'Read the reference for this declaration.'

/** The runs a card reads in place of `description`, when they are the same words with the references named. */
function usableParts(preview: LinkPreview): (string | PreviewReference)[] | undefined {
  const parts = preview.descriptionParts
  if (!Array.isArray(parts) || !parts.length) return undefined
  const valid = parts.every((part) => typeof part === 'string'
    || (!!part && typeof part === 'object' && typeof part.text === 'string' && typeof part.href === 'string'
      && (part.kind === undefined || typeof part.kind === 'string')))
  const text = (part: string | PreviewReference) => typeof part === 'string' ? part : part.text
  return valid && parts.map(text).join('') === preview.description ? parts : undefined
}

function descriptionNodes(preview: LinkPreview | undefined): CardNode[] {
  if (!preview) return []
  const parts = usableParts(preview)
  if (!parts) return [preview.description || EMPTY_DESCRIPTION]
  return parts.map((part) => typeof part === 'string' ? part : sitePath(part.href) ? mention(part) : part.text)
}

/** The line under the summary: what a link says about where it came from, then what the payload adds. */
const detailText = (preview: LinkPreview | undefined, context: string | undefined) =>
  [context, preview?.detail].filter(Boolean).join(' ')

/** The muted line at the foot: where the entry lives, one part to a place. */
function footerNodes(preview: LinkPreview | undefined): CardNode[] {
  const places = (Array.isArray(preview?.footer) ? preview.footer : []).filter((place) => typeof place === 'string' && place)
  return places.flatMap((place, index) => index ? [h('span', { 'aria-hidden': 'true' }, ' · '), place] : [place])
}

/* ------------------------------------------------------------ the signature */

const SIGNATURE_CLASS = 'reference-link-preview__signature'

const COLOR = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i
const isObject = (input: unknown): input is Record<string, unknown> => !!input && typeof input === 'object'
const isPalette = (input: unknown) => isObject(input) && typeof input.foreground === 'string' && COLOR.test(input.foreground)
  && typeof input.background === 'string' && COLOR.test(input.background)
const isStyle = (input: unknown) => isObject(input) && typeof input.color === 'string' && COLOR.test(input.color)
  && typeof input.fontStyle === 'number' && Number.isInteger(input.fontStyle) && input.fontStyle >= 0 && input.fontStyle <= 15

/** Token metadata is optional and can fail independently of the real link, so it must match the text it colours. */
function isHighlight(input: unknown, signature: string): input is CodeHighlight {
  return isObject(input) && typeof input.language === 'string' && isPalette(input.light) && isPalette(input.dark) && Array.isArray(input.lines)
    && input.lines.every((line: unknown) => Array.isArray(line) && line.every((token: unknown) => isObject(token)
      && typeof token.content === 'string' && isStyle(token.light) && isStyle(token.dark)))
    && input.lines.map((line: { content: string }[]) => line.map((token) => token.content).join('')).join('\n') === signature
}

/** A token's own look. The colours are read by `.lm-highlighted span`, and the weight and slant by the card. */
function tokenStyle(token: CodeHighlight['lines'][number][number]): string {
  return (['light', 'dark'] as const).flatMap((theme) => {
    const { color, fontStyle } = token[theme]
    return [`--shiki-${theme}:${color}`, `--shiki-${theme}-font-style:${fontStyle & 1 ? 'italic' : 'normal'}`,
      `--shiki-${theme}-font-weight:${fontStyle & 2 ? 'bold' : 'normal'}`,
      `--shiki-${theme}-text-decoration:${[fontStyle & 4 ? 'underline' : '', fontStyle & 8 ? 'line-through' : ''].filter(Boolean).join(' ') || 'none'}`]
  }).join(';')
}

function signatureSlot(preview: LinkPreview | undefined): CardElement {
  const signature = limitPreviewSignature(preview?.signature ?? '')
  const slot: Attributes = { 'data-preview-signature': true, class: SIGNATURE_CLASS }
  if (!signature) return h('code', { ...slot, hidden: true })
  const value = preview?.signatureHighlight
  // A cut declaration no longer matches its highlighting, so it is plain text.
  if (!isHighlight(value, signature)) return h('code', slot, signature)
  return h('code', { ...slot, class: `${SIGNATURE_CLASS} lm-highlighted`, 'data-language': value.language,
    style: `--shiki-light:${value.light.foreground};--shiki-dark:${value.dark.foreground}` },
  ...value.lines.flatMap((line, index) => [...(index ? ['\n'] : []), ...line.map((token) => h('span', { style: tokenStyle(token) }, token.content))]))
}

/* ------------------------------------------------------------------ the card */

export const PREVIEW_DEFAULT_ACTION = 'Open reference'
const BLANK_TITLE = 'Reference preview'

/** The accessible name of the card for a payload. */
export const previewLabel = (preview: LinkPreview | undefined) => preview ? `${preview.title} preview` : BLANK_TITLE

export interface CardOptions {
  /** The id of the popover, which the close control and the name hang from. */
  id: string
  /** Show the whole name rather than the shortened one. */
  expanded?: boolean
  /** What the link that opened the card says about the entry, such as where an inherited member is declared. */
  context?: string
  /** Where the action leads when that is not the payload's `href`, such as the page with the link's own fragment. */
  href?: string
}

/** The names of the slots, which the browser's card keeps from link to link. */
export const PREVIEW_SLOTS = ['kind', 'title', 'expand', 'signature', 'description', 'detail', 'footer', 'open'] as const

/** The card of `preview`, or the empty card the page starts with when there is none. */
export function previewCard(preview: LinkPreview | undefined, options: CardOptions): CardNode[] {
  const { id } = options
  const title = preview?.title ?? BLANK_TITLE
  const short = abbreviateNamespace(title)
  const expanded = !!options.expanded && short !== title
  const chip = legendChip(preview?.kind)
  const detail = detailText(preview, options.context)
  const footer = footerNodes(preview)
  const href = options.href ?? preview?.href
  return [
    h('span', { class: 'reference-link-preview__heading' },
      h('span', { 'data-preview-kind': true, class: 'reference-link-preview__kind', hidden: chip ? undefined : true }, ...(chip ? [chip] : [])),
      h('code', { id: `${id}-title`, 'data-preview-title': true, class: 'reference-link-preview__name', title },
        ...wordBreak(expanded ? title : short).flatMap((part, index) => index ? [h('wbr'), part] : [part])),
      h('button', { type: 'button', 'data-preview-close': true, popovertarget: id, popovertargetaction: 'hide', 'aria-label': 'Close preview' }, '×')),
    h('button', { type: 'button', 'data-preview-expand': true, class: 'reference-link-preview__expand', hidden: short === title ? true : undefined,
      'aria-expanded': String(expanded), 'aria-controls': `${id}-title` }, expanded ? 'Collapse' : 'Show full name'),
    signatureSlot(preview),
    h('span', { class: 'reference-link-preview__prose' },
      h('span', { 'data-preview-description': true, class: 'reference-link-preview__summary' }, ...descriptionNodes(preview)),
      h('span', { 'data-preview-detail': true, class: 'reference-link-preview__detail', hidden: detail ? undefined : true }, detail)),
    h('span', { class: 'reference-link-preview__footer' },
      h('span', { 'data-preview-footer': true, class: 'reference-link-preview__where', hidden: footer.length ? undefined : true }, ...footer),
      h('a', { href, 'data-preview-open': true, 'data-preview-skip': true }, preview?.actionLabel ?? PREVIEW_DEFAULT_ACTION)),
  ]
}

/** Make `target` read as `source`: the same attributes and the same children, in the same element. */
function adopt(target: Element, source: Element) {
  for (const name of target.getAttributeNames()) if (!source.hasAttribute(name)) target.removeAttribute(name)
  for (const name of source.getAttributeNames()) if (target.getAttribute(name) !== source.getAttribute(name)) target.setAttribute(name, source.getAttribute(name)!)
  target.replaceChildren(...source.childNodes)
}

/**
 * Paint `preview` into the card the page carries, in place: each slot keeps its element, so a focused control stays
 * focused, and takes what the same payload gives a card that is rendered with `cardHtml`.
 */
export function paintCard(panel: HTMLElement, preview: LinkPreview, options: CardOptions) {
  const fresh = panel.ownerDocument.createElement('span')
  fresh.append(...cardDom(panel.ownerDocument, previewCard(preview, options)))
  for (const slot of PREVIEW_SLOTS) {
    const source = fresh.querySelector(`[data-preview-${slot}]`)
    const target = panel.querySelector(`[data-preview-${slot}]`)
    if (source && target) adopt(target, source)
  }
}
