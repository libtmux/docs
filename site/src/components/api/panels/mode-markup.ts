/** The markup panel mode writes in the browser, in one place so the workspace and its tests agree on it. */
import type { LinkedPanel } from '../../../lib/panels/linked'
import { ICON, esc } from '../columns/html'

export interface HeadSpec {
  id: string
  title: string
  /** A readout beside the title: the page's path, or the equivalent's qualified name. */
  loc?: string
}

/**
 * A panel's header: the handle a drag takes, the stop a keyboard reaches, and the control that closes it.
 * Alt and an arrow key move the panel while the header, or a control in it, has focus.
 */
export function headHtml({ id, title, loc }: HeadSpec): string {
  return `<header class="pw__head" data-head="${esc(id)}" data-draggable role="group" tabindex="0" aria-label="${esc(title)} panel header. Alt and an arrow key move the panel." aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown">` +
    `<span class="pw__title">${esc(title)}</span>${loc ? `<code class="pw__loc" title="${esc(loc)}">${esc(loc)}</code>` : ''}<span class="pw__spacer"></span>` +
    `<button type="button" class="pw__icon" data-act="close:${esc(id)}" aria-label="Close the ${esc(title)} panel">${ICON.close}</button></header>`
}

/** A panel holding a page: its article is the body, and a link in it opens a page in the workspace. */
export function pageRegion(doc: Document, spec: HeadSpec): HTMLElement {
  const el = doc.createElement('section')
  el.className = 'pw__panel'
  el.dataset.region = spec.id
  el.dataset.panelKind = 'page'
  el.setAttribute('aria-label', spec.title)
  el.innerHTML = `${headHtml(spec)}<div class="pw__body" data-body="${esc(spec.id)}"></div>`
  return el
}

/**
 * A linked panel: the page's equivalent in one other port, as the entries the page's own tables gave. Its page link
 * opens the page in this panel, and its list of other ports opens their panels.
 */
export function linkedRegion(doc: Document, panel: LinkedPanel, others: readonly LinkedPanel[]): HTMLElement {
  const lead = panel.entries[0]
  const el = doc.createElement('section')
  el.className = 'pw__panel'
  el.dataset.region = panel.id
  el.dataset.panelKind = 'linked'
  el.setAttribute('aria-label', panel.name)
  const entries = panel.entries.map((entry) => `<article class="pw__doc">` +
    `<p class="pw__eyebrow"><span>${esc(panel.name)}${entry.label && entry.qualifiedName ? ` &middot; ${esc(entry.label)}` : ''}</span></p>` +
    (entry.qualifiedName
      ? `<p class="pw__sym"><code>${esc(entry.qualifiedName)}</code>${entry.kind ? ` <span class="pw__kind">${esc(entry.kind)}</span>` : ''}${entry.chips.map((chip) => `<span class="pw__diff">${esc(chip)}</span>`).join('')}</p>`
      : `<h2 class="pw__h">${esc(entry.label)}</h2>`) +
    (entry.summary ? `<p class="pw__lede">${esc(entry.summary)}</p>` : '') +
    (entry.note ? `<p class="pw__note">${esc(entry.note)}</p>` : '') +
    `<p class="pw__why"><a href="${esc(entry.href)}" data-panel-load>Open the ${esc(panel.name)} page</a></p></article>`).join('')
  const more = others.length
    ? `<h3 class="pw__sub">In other ports</h3><ul class="pw__xrefs">${others.map((other) =>
      `<li><a href="${esc(other.entries[0]?.href)}" data-panel-open="${esc(other.id)}">${esc(other.name)}</a>${other.entries[0]?.qualifiedName ? ` <code>${esc(other.entries[0].qualifiedName)}</code>` : ''}</li>`).join('')}</ul>`
    : ''
  el.innerHTML = `${headHtml({ id: panel.id, title: panel.name, loc: lead?.qualifiedName ?? lead?.label })}<div class="pw__body" data-body="${esc(panel.id)}">${entries}${more}</div>`
  return el
}

/** The workspace around the panels: its toolbar, the stage the layout draws into, and a live region for what changes. */
export const SHELL_HTML =
  `<div class="pw__routebar" role="toolbar" aria-label="Panel workspace">` +
  `<details class="pw__panels" data-panels-menu><summary class="pw__btn" data-panels-summary>Panels</summary><ul class="pw__panellist" data-panel-list></ul></details>` +
  `<button type="button" class="pw__btn" data-act="reset">Reset layout</button>` +
  `<button type="button" class="pw__btn" data-act="exit">Exit panels</button>` +
  `<p class="pw__hint">Drag a panel header to move or dock it, or focus it and press <kbd>Alt</kbd> with an arrow key. Arrow keys, <kbd>Home</kbd> and <kbd>End</kbd> resize a focused splitter. A link in a page opens it here, and <kbd>Shift</kbd> with a click opens it in a new panel.</p>` +
  `</div>` +
  `<div class="pw__stage pw__stage--route" data-route-stage><div class="pw__work" data-route-work></div></div>` +
  `<div class="sr-only" role="status" aria-live="polite" data-live></div>`
