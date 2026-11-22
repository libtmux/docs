/** The panels page: artboard, width, pointer and template pickers around one PanelWorkspace mount. */
import { conceptIndex, type ConceptRecord } from '../../../lib/panels/concepts'
import { browserStorage } from '../../../lib/panels/persist'
import { TEMPLATE_NAMES, type TemplateName } from '../../../lib/panels/state'
import { BOARDS, mountPanelWorkspace, type BoardId } from './panel-workspace'

const urlParam = (key: string) => new URLSearchParams(location.search).get(key)

export function mountPanelsTrial(root: HTMLElement) {
  // The router fires `astro:page-load` on the first load too; a second mount would bind every handler twice.
  if (root.hasAttribute('data-mounted')) return
  root.setAttribute('data-mounted', '')
  const raw = JSON.parse(document.getElementById('pw-concepts')!.textContent ?? '{}') as { list: ConceptRecord[]; ports: { slug: string; name: string; short: string }[] }
  const concepts = conceptIndex(raw.list, raw.ports)
  const board = urlParam('board')
  const template = urlParam('template')
  const loc = urlParam('loc')
  const pointer = urlParam('pointer')
  const slider = root.querySelector<HTMLInputElement>('[data-width-slider]')
  const workspace = mountPanelWorkspace(root, {
    concepts, storage: browserStorage(), restore: !template && !loc,
    board: BOARDS.some((b) => b[0] === board) ? board as BoardId : 'fit',
    pointer: pointer === 'hover' || pointer === 'touch' ? pointer : undefined,
    template: template && template in TEMPLATE_NAMES ? template as TemplateName : 'study',
    loc: loc ?? undefined,
    onChange({ board: b, pointer: p, plan }) {
      root.querySelectorAll<HTMLElement>('[data-pick-board]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.pickBoard === b)))
      root.querySelectorAll<HTMLElement>('[data-pick-pointer]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.pickPointer === p)))
      if (slider && document.activeElement !== slider) slider.value = String(plan.width)
      const q = new URLSearchParams(location.search)
      if (b === 'fit' || b === 'custom') q.delete('board'); else q.set('board', b)
      q.set('pointer', p)
      if (p === (matchMedia('(hover: hover)').matches ? 'hover' : 'touch')) q.delete('pointer')
      const next = q.toString() ? `?${q}` : ''
      if (next !== location.search) history.replaceState(history.state, '', `${location.pathname}${next}${location.hash}`)
    },
  })
  root.addEventListener('click', (e) => {
    const t = e.target as Element
    const pick = t.closest<HTMLElement>('[data-pick-board]')?.dataset.pickBoard
    if (pick) workspace.setBoard(pick as BoardId)
    const ptr = t.closest<HTMLElement>('[data-pick-pointer]')?.dataset.pickPointer
    if (ptr === 'hover' || ptr === 'touch') workspace.setPointer(ptr)
    const tpl = t.closest<HTMLElement>('[data-pick-template]')?.dataset.pickTemplate
    if (tpl) workspace.loadTemplate(tpl as TemplateName)
    if (t.closest('[data-rotate]')) {
      const p = workspace.plan()
      if (p) workspace.setBoard('custom', { w: p.height, h: p.width })
    }
  })
  slider?.addEventListener('input', () => {
    const p = workspace.plan()
    workspace.setBoard('custom', { w: Number(slider.value), h: p?.height ?? 720 })
  })
}
