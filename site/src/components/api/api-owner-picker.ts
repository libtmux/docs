/** Searchable type selection; focus stays in the input while arrows browse options. */
export function initApiOwnerPicker(nav: HTMLElement, signal: AbortSignal) {
  const root = nav.querySelector<HTMLElement>('[data-api-owner-picker]')
  const trigger = root?.querySelector<HTMLButtonElement>('[data-api-owner]')
  const input = root?.querySelector<HTMLInputElement>('[data-api-owner-search]')
  const popup = root?.querySelector<HTMLElement>('[data-api-owner-popup]')
  const empty = root?.querySelector<HTMLElement>('[data-api-owner-empty]')
  if (!root || !trigger || !input || !popup) return
  const options = [...popup.querySelectorAll<HTMLElement>('[role="option"]')]
  let visible = options
  let active = -1
  const highlight = (index: number) => {
    active = index
    for (const option of options) option.classList.toggle('is-active', option === visible[index])
    if (visible[index]) {
      input.setAttribute('aria-activedescendant', visible[index]!.id)
      visible[index]!.scrollIntoView({ block: 'nearest' })
    } else input.removeAttribute('aria-activedescendant')
  }
  const close = (restoreFocus = false) => {
    popup.hidden = true
    trigger.setAttribute('aria-expanded', 'false')
    input.setAttribute('aria-expanded', 'false')
    input.removeAttribute('aria-activedescendant')
    input.value = ''
    if (restoreFocus) trigger.focus({ preventScroll: true })
  }
  const filter = (query: string) => {
    const terms = query.toLocaleLowerCase().trim().split(/\s+/)
    for (const option of options) option.hidden = !terms.every((term) => option.dataset.qualifiedName!.toLocaleLowerCase().includes(term))
    visible = options.filter((option) => !option.hidden)
    if (empty) empty.hidden = visible.length > 0
    highlight(visible.length ? 0 : -1)
  }
  const open = () => {
    popup.hidden = false
    trigger.setAttribute('aria-expanded', 'true')
    input.setAttribute('aria-expanded', 'true')
    input.value = ''
    filter('')
    const selected = visible.findIndex((option) => option.dataset.ownerId === trigger.dataset.symbol)
    highlight(selected < 0 ? 0 : selected)
    input.focus({ preventScroll: true })
  }
  const choose = (option: HTMLElement | undefined) => {
    if (!option) return
    trigger.dataset.symbol = option.dataset.ownerId
    close(true)
    trigger.dispatchEvent(new Event('change', { bubbles: true }))
  }
  trigger.addEventListener('click', () => { if (popup.hidden) open(); else close(true) }, { signal })
  input.addEventListener('input', () => {
    popup.hidden = false
    input.setAttribute('aria-expanded', 'true')
    filter(input.value)
  }, { signal })
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') return
    if (event.key === 'Escape' && !popup.hidden) {
      event.preventDefault()
      event.stopPropagation()
      close(true)
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].includes(event.key)) {
      if (popup.hidden && !['ArrowDown', 'ArrowUp'].includes(event.key)) return
      event.preventDefault()
      if (popup.hidden) { open(); return }
      if (event.key === 'Enter') choose(visible[active])
      else if (event.key === 'Home') highlight(0)
      else if (event.key === 'End') highlight(visible.length - 1)
      else if (visible.length) highlight((active + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length)
    }
  }, { signal })
  popup.addEventListener('pointerdown', (event) => {
    if ((event.target as Element).closest('[role="option"]')) event.preventDefault()
  }, { signal })
  popup.addEventListener('click', (event) => choose((event.target as Element).closest<HTMLElement>('[role="option"]') ?? undefined), { signal })
  root.addEventListener('focusout', (event) => {
    if (event.relatedTarget === trigger || !root.contains(event.relatedTarget as Node | null)) close()
  }, { signal })
  document.addEventListener('pointerdown', (event) => {
    if (!root.contains(event.target as Node)) close()
  }, { signal })
  nav.addEventListener('api-owner:sync', () => close(), { signal })
}
