export const HOME_PREVIEW_DELAY = 1200
export const HOME_PREVIEW_FADE = 180
export const HOME_PORT_PREVIEW_EVENT = 'lm-home-port:preview'

/** A hover is provisional until its control is clicked. Touch keeps click behavior. */
export function bindHomeHoverPreview({ options, show, restore, signal }: {
  options: HTMLElement[]
  show: (option: HTMLElement) => void
  restore: () => void
  signal: AbortSignal
}) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let active = false
  const commit = () => {
    clearTimeout(timer)
    timer = undefined
    active = false
  }
  const cancel = () => {
    const wasActive = active
    commit()
    if (wasActive) restore()
  }
  for (const option of options) {
    option.addEventListener('pointerenter', (event) => {
      if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return
      if (!window.matchMedia('(any-hover: hover)').matches) return
      cancel()
      timer = setTimeout(() => {
        timer = undefined
        if (!option.isConnected || signal.aborted) return
        active = true
        show(option)
      }, HOME_PREVIEW_DELAY)
    }, { signal })
    option.addEventListener('pointerleave', cancel, { signal })
    option.addEventListener('pointercancel', cancel, { signal })
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') cancel()
  }, { signal, capture: true })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancel()
  }, { signal })
  window.addEventListener('blur', cancel, { signal })
  window.addEventListener('pagehide', cancel, { signal })
  document.addEventListener('astro:before-swap', cancel, { signal })
  signal.addEventListener('abort', cancel, { once: true })
  return { cancel, commit }
}
