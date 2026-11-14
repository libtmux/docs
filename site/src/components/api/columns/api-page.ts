/**
 * The page the columns view shows for a node of the API reference: the index,
 * a group, a type with its members, or a member.
 *
 * It is built from the reference inventory (names, kinds, summaries, the
 * owner), so it lists what the tree lists. The signature, behavior, parameters
 * and examples live on the declaration's own page, which one link opens.
 */
import { kindLabel, kindMark, kindPalette, markClass } from '../../../lib/api-labels'
import type { ApiSource } from '../../../lib/columns/api-hierarchy'
import type { ColumnNode } from '../../../lib/columns/types'
import type { PageContext } from './miller'
import { esc } from './html'

/** Members listed before the rest are named in the member column. */
export const ENTRY_CAP = 40

/** The compact kind mark, as the tree draws it. */
export function markHtml(kind: string): string {
  const mark = kindMark(kind)
  if (!mark) return '<span class="miller__nomark" aria-hidden="true"></span>'
  return `<span class="api-nav__kind api-badge--kind-${esc(kindPalette(kind))}" title="${esc(kindLabel(kind))}" aria-hidden="true"><span class="api-badge__label" data-mark="${markClass(mark)}">${esc(mark)}</span></span>`
}

/** The legend chip: the mark and the word in one token, as a declaration's heading shows it. */
export function legendHtml(kind: string): string {
  const mark = kindMark(kind)
  const word = kindLabel(kind)
  return `<span class="api-badge api-badge--kind api-badge--kind-${esc(kindPalette(kind))} api-leg"${mark ? ` data-mark="${markClass(mark)}"` : ''}>` +
    (mark ? `<span class="api-leg__m" aria-hidden="true"><span class="api-leg__g" data-mark="${markClass(mark)}">${esc(mark)}</span></span>` : '') +
    `<span class="api-leg__w"><span class="api-badge__label api-leg__wl">${esc(word)}</span></span></span>`
}

export const nodeMark = (node: ColumnNode): string => (node.kind === 'group' || node.kind === 'root' ? '' : markHtml(node.kind))

/** What a node's children are called. */
export function nounFor(node: ColumnNode): string {
  if (node.kind === 'root') return 'Groups'
  if (node.kind === 'group') return 'Declarations'
  return 'Members'
}

const link = (node: ColumnNode, inner: string) => `<a href="#" data-at="${esc(node.id)}">${inner}</a>`
const named = (node: ColumnNode) => (node.data?.symbol ? `<code>${esc(node.data.shortName ?? node.label)}</code>` : esc(node.label))

function rows(list: readonly ColumnNode[]): string {
  return `<ul class="api-columns-page__list">${list.map((k) =>
    `<li><a class="api-columns-page__row" href="#" data-at="${esc(k.id)}">${nodeMark(k) || '<span class="miller__nomark" aria-hidden="true"></span>'}` +
    `<span class="api-columns-page__name">${esc(k.label)}${k.count ? ` <span class="miller__count">${k.count}</span>` : ''}</span>` +
    `${k.summary ? `<span class="api-columns-page__sum">${esc(k.summary)}</span>` : ''}</a></li>`).join('')}</ul>`
}

export function apiPageHtml(source: ApiSource, node: ColumnNode, context: PageContext, portName: string): string {
  const chain = context.path
  const kids = node.leaf ? [] : source.children(node)
  let h = '<article class="miller__doc api-columns-page">'
  if (chain.length > 1) {
    h += `<ol class="api-columns-page__crumbs" aria-label="Breadcrumb">${chain.map((x, i) =>
      i === chain.length - 1 ? `<li aria-current="page">${named(x)}</li>` : `<li>${link(x, named(x))}</li>`).join('')}</ol>`
  }
  if (node.kind === 'root') {
    const title = typeof node.data?.title === 'string' ? node.data.title : node.label
    h += `<h1 class="miller__title" tabindex="-1">${esc(title)}</h1><p class="api-columns-page__summary">Every declaration in libtmux for ${esc(portName)}, in the groups the tree lists.</p>`
    h += `<ul class="api-columns-page__cards">${kids.map((b) => {
      const names = source.children(b).slice(0, 3).map((k) => k.label).join(', ')
      return `<li><a class="api-columns-page__card" href="#" data-at="${esc(b.id)}"><strong>${esc(b.label)} <span class="miller__count">${b.count ?? 0}</span></strong><span>${esc(names)}${source.children(b).length > 3 ? ' and more' : ''}</span></a></li>`
    }).join('')}</ul>`
    return `${h}${fullPageLink(node)}</article>`
  }
  if (node.kind === 'group') {
    h += `<h1 class="miller__title" tabindex="-1">${esc(node.label)}</h1><p class="api-columns-page__summary">The declarations in the ${esc(node.label)} group of the ${esc(portName)} API.</p>`
    return `${h}${rows(kids)}${fullPageLink(node)}</article>`
  }
  const owner = node.parent ? source.find(node.parent) : undefined
  const ownerIsType = owner && owner.kind !== 'group' && owner.kind !== 'root'
  h += `<div class="api-columns-page__eyebrow">${legendHtml(node.kind)}${ownerIsType ? `<span>of ${link(owner, `<code>${esc(owner.data?.shortName ?? owner.label)}</code>`)}</span>` : ''}</div>`
  h += `<h1 class="miller__title" tabindex="-1">${esc(String(node.data?.shortName ?? node.label))}</h1>`
  if (node.summary) h += `<p class="api-columns-page__summary">${esc(node.summary)}</p>`
  if (kids.length) {
    h += `<h2 class="api-columns-page__rubric">Members <span class="miller__count">${kids.length}</span></h2>${rows(kids.slice(0, ENTRY_CAP))}`
    if (kids.length > ENTRY_CAP) h += `<p class="miller__more">${kids.length - ENTRY_CAP} more, listed in full in the member column.</p>`
  }
  return `${h}${fullPageLink(node)}</article>`
}

function fullPageLink(node: ColumnNode): string {
  if (!node.href) return ''
  const what = node.kind === 'group' ? 'Show the group on the reference index' : node.kind === 'root' ? 'Open the reference index' : 'Open the full page'
  return `<p class="api-columns-page__full"><a class="miller__btn api-columns-page__open" href="${esc(node.href)}" data-open-page>${what}</a><span class="miller__more">${node.kind === 'group' || node.kind === 'root' ? '' : 'Signature, behavior, parameters and examples.'}</span></p>`
}
