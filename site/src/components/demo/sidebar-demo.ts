import { DEMO_VIEWPORTS, demoConfig, demoUrl, type SidebarDemoConfig } from '../../lib/sidebar-demo'

const tradeoffs = {
  outline: 'Outline keeps the type hierarchy visible; expanding a large owner makes a longer list.',
  focus: 'Focus keeps one type’s members together. The type picker and enclosing-type link keep other owners reachable.',
  grouped: 'Grouped separates one type’s members by kind, with alphabetical lists. It adds headings but makes long member lists easier to scan.',
}

export function initSidebarDemo() {
  const root = document.querySelector<HTMLElement>('[data-sidebar-demo]')
  const frame = root?.querySelector<HTMLIFrameElement>('[data-sidebar-frame]')
  const form = root?.querySelector<HTMLFormElement>('form')
  if (!root || !frame || !form) return
  let config = demoConfig(new URLSearchParams(location.search))
  const selections = new Map<string, string>()
  const examples = new Map<string, { id: string; label: string }[]>()
  let loadedLanguage = ''
  let revision = 0
  const picker = form.elements.namedItem('symbol') as HTMLSelectElement
  const send = () => frame.contentWindow?.postMessage({ type: 'sidebar-demo:configure', revision, query: demoUrl(new URL(location.href), config).search }, location.origin)
  const reflect = (configure = true) => {
    for (const [name, value] of Object.entries(config)) {
      if (name !== 'symbol') (form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement).value = String(value)
    }
    picker.replaceChildren(...(examples.get(config.language) ?? []).map((example) => {
      const option = document.createElement('option')
      option.value = example.id
      option.textContent = example.label
      return option
    }))
    if (config.symbol && ![...picker.options].some((option) => option.value === config.symbol)) {
      const option = document.createElement('option')
      option.value = config.symbol
      option.textContent = config.symbol
      picker.append(option)
    }
    picker.value = config.symbol
    root.querySelector('[data-width]')!.textContent = `${config.width}px`
    root.querySelector('[data-tradeoff]')!.textContent = tradeoffs[config.variant]
    root.querySelector<HTMLAnchorElement>('[data-share]')!.href = demoUrl(new URL(location.href), config).href
    frame.style.width = `${DEMO_VIEWPORTS[config.viewport]}px`
    if (loadedLanguage !== config.language) {
      loadedLanguage = config.language
      const url = demoUrl(new URL(`${root.dataset.previewBase}${config.language}/`, location.href), config).href
      if (frame.contentWindow) frame.contentWindow.location.replace(url)
      else frame.src = url
    } else if (configure) send()
  }
  const commit = (next: SidebarDemoConfig, replace = false) => {
    const url = demoUrl(new URL(location.href), next)
    config = next
    revision++
    selections.set(config.language, config.symbol)
    if (url.href !== location.href || !history.state?.sidebarDemo) {
      history[replace ? 'replaceState' : 'pushState']({ ...history.state, sidebarDemo: true }, '', url)
    }
    reflect()
  }
  form.addEventListener('submit', (event) => event.preventDefault())
  form.addEventListener('change', () => {
    const params = new URLSearchParams()
    for (const [key, value] of new FormData(form)) if (typeof value === 'string') params.set(key, value)
    const next = demoConfig(params)
    if (next.language !== config.language) next.symbol = selections.get(next.language) ?? ''
    commit(next)
  })
  window.addEventListener('popstate', () => {
    config = demoConfig(new URLSearchParams(location.search))
    revision++
    selections.set(config.language, config.symbol)
    reflect()
  })
  frame.addEventListener('load', send)
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow || event.data?.language !== config.language) return
    if (event.data.type === 'sidebar-demo:ready') {
      examples.set(config.language, event.data.examples)
      reflect()
    } else if (event.data.type === 'sidebar-demo:configured' && event.data.revision === revision && event.data.symbol !== config.symbol) {
      config = { ...config, symbol: event.data.symbol }
      selections.set(config.language, config.symbol)
      history.replaceState({ ...history.state, sidebarDemo: true }, '', demoUrl(new URL(location.href), config))
      reflect(false)
    } else if (event.data.type === 'sidebar-demo:selection' && event.data.revision === revision && event.data.variant === config.variant && event.data.symbol !== config.symbol) {
      commit({ ...config, symbol: event.data.symbol }, !config.symbol)
    }
  })
  commit(config, true)
}
