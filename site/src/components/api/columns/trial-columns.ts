/** The all-variants page: toolbar, stage width, jumps and the column props, around one MillerColumns mount. */
import { apiSource } from '../../../lib/columns/api-hierarchy'
import { columnsLiteral, mergeColumns } from '../../../lib/columns/config'
import { describePlan } from '../../../lib/columns/bands'
import { parseUrlState, serializeUrlState } from '../../../lib/columns/url-state'
import { COLUMN_DEFAULTS, VARIANT_IDS, VARIANTS, type Variant } from '../../../lib/columns/types'
import type { ApiTreeJson } from '../../../lib/api-search'
import { apiPageHtml, nodeMark, nounFor } from './api-page'
import { mountMiller } from './miller'

const DEFAULT_AT = 'sym:tmux.Pane.Capture'

export async function mountColumnsTrial(root: HTMLElement) {
  const base = root.dataset.base ?? ''
  const portName = root.dataset.portName ?? ''
  const holder = root.querySelector<HTMLElement>('[data-trial-miller]')!
  const what = root.querySelector('[data-what]')!
  const status = root.querySelector('[data-status]')!
  const props = root.querySelector<HTMLElement>('[data-col-props]')!
  const reference = base && location.pathname.startsWith(base) ? base : location.pathname.replace(/trial\/.*$/, '')
  let json: ApiTreeJson
  try {
    const r = await fetch(`${reference}tree.json`)
    if (!r.ok) throw new Error(String(r.status))
    json = await r.json() as ApiTreeJson
  } catch {
    holder.innerHTML = '<p class="api-columns__error" role="status">The reference tree did not load.</p>'
    return
  }
  const source = apiSource(json, { base: reference, portName })
  const url = parseUrlState(location.search)
  const defaults = { variant: 'b' as Variant, at: DEFAULT_AT, width: 'fit', columns: COLUMN_DEFAULTS }
  const at = (url.at && source.find(url.at)?.id) || DEFAULT_AT
  const miller = mountMiller(holder, {
    source, variant: url.variant ?? defaults.variant, at, width: url.width ?? 'fit', height: 600, address: true,
    columns: mergeColumns(COLUMN_DEFAULTS, url.columns),
    label: `${portName} API`,
    page: (node, context) => apiPageHtml(source, node, context, portName),
    mark: nodeMark, noun: nounFor,
    onRender(plan, state) {
      what.textContent = VARIANTS[state.variant].what
      status.textContent = `${describePlan(plan, state.variant)} ${plan.lists + (plan.preview ? 1 : 0) - plan.hidden - plan.spines} in view.`
      root.querySelectorAll<HTMLElement>('[data-pick-variant]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pickVariant === state.variant)))
      root.querySelectorAll<HTMLElement>('[data-pick-width]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pickWidth === state.width)))
      props.hidden = state.variant !== 'g'
      props.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-col-prop]').forEach((el) => {
        const v = state.columns[el.dataset.colProp as keyof typeof state.columns]
        if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = Boolean(v)
        else el.value = String(v)
      })
      const code = props.querySelector('[data-col-code]')
      if (code) code.textContent = columnsLiteral(state.columns)
      const next = serializeUrlState(location.search, { variant: state.variant, at: state.at, width: state.width, columns: state.columns }, defaults)
      if (next !== location.search) history.replaceState(history.state, '', `${location.pathname}${next}${location.hash}`)
    },
  })
  root.addEventListener('click', (e) => {
    const t = e.target as Element
    const variant = t.closest<HTMLElement>('[data-pick-variant]')?.dataset.pickVariant as Variant | undefined
    if (variant && (VARIANT_IDS as readonly string[]).includes(variant)) miller.set({ variant })
    const width = t.closest<HTMLElement>('[data-pick-width]')?.dataset.pickWidth
    if (width) miller.setWidth(width)
    const jump = t.closest<HTMLElement>('[data-jump]')?.dataset.jump
    if (jump) miller.select(jump === '__root' ? source.root : jump)
  })
  root.addEventListener('change', (e) => {
    const el = (e.target as Element).closest<HTMLInputElement | HTMLSelectElement>('[data-col-prop]')
    if (!el) return
    const k = el.dataset.colProp!
    miller.set({ columns: { [k]: el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : k === 'pageSize' ? Number(el.value) : el.value } })
  })
}
