import { apiTreeHref, type ApiTreeJson } from '../../lib/api-search'
import { sidebarCatalog, sidebarName } from '../../lib/api-sidebar'
import { demoConfig, demoUrl, sidebarExamples, type SidebarDemoConfig } from '../../lib/sidebar-demo'
import { setApiSidebar } from '../api/api-tree'

export async function initSidebarPreview() {
  const root = document.querySelector<HTMLElement>('[data-sidebar-preview]')
  const nav = root?.querySelector<HTMLElement>('.api-nav')
  if (!root || !nav) return
  const response = await fetch(root.dataset.inventory!)
  if (!response.ok) throw new Error('Sidebar inventory could not load')
  const json = await response.json() as ApiTreeJson
  const catalog = sidebarCatalog(json)
  const examples = sidebarExamples(json)
  const base = nav.dataset.base ?? '/'
  const href = (id: string) => apiTreeHref(base, catalog.symbols.get(id)!, json.hrefs)
  const byHref = new Map(catalog.records.map((record) => [new URL(href(record.id), location.href).pathname, record.id]))
  let config = demoConfig(new URLSearchParams(location.search))
  config.language = json.port as SidebarDemoConfig['language']
  if (!catalog.symbols.has(config.symbol)) config.symbol = examples[0]?.id ?? catalog.records[0]!.id
  let revision = 0
  let articleSymbol = ''
  const send = (type: string, detail: object) => window.parent.postMessage({ type, language: json.port, ...detail }, location.origin)
  const text = (selector: string, value: string) => { root.querySelector<HTMLElement>(selector)!.textContent = value }
  const link = (id: string) => {
    const element = document.createElement('a')
    element.href = href(id)
    element.textContent = sidebarName(catalog.symbols.get(id)!.name, json.port)
    return element
  }
  const article = (symbol: string) => {
    const record = catalog.symbols.get(symbol)!
    text('[data-preview-title]', record.qualifiedName)
    text('[data-preview-summary]', record.summary || 'This declaration has no summary in the current API model.')
    text('[data-preview-kind]', record.kind)
    text('[data-preview-selection]', record.qualifiedName)
    const ancestors: HTMLAnchorElement[] = []
    const seen = new Set<string>()
    for (let id = catalog.parent.get(symbol); id && !seen.has(id); id = catalog.parent.get(id)) {
      seen.add(id)
      if (catalog.symbols.has(id)) ancestors.unshift(link(id))
    }
    root.querySelector('[data-preview-ancestry]')!.replaceChildren(...ancestors)
    const owner = catalog.ownerOf(symbol)
    const members = catalog.membersOf(owner?.id ?? '')
    text('[data-preview-members-title]', owner ? `${owner.name} members (${members.length})` : 'Members')
    root.querySelector<HTMLElement>('[data-preview-members-title]')!.hidden = members.length === 0
    root.querySelector('[data-preview-members]')!.replaceChildren(...members.map((member) => {
      const element = link(member.id)
      const kind = document.createElement('small')
      kind.textContent = member.kind
      element.append(kind)
      if (member.id === symbol) element.setAttribute('aria-current', 'page')
      return element
    }))
    root.querySelector<HTMLAnchorElement>('[data-preview-full]')!.href = href(symbol)
    if (symbol !== articleSymbol) root.querySelector<HTMLElement>('.sidebar-preview__article')!.scrollTop = 0
    articleSymbol = symbol
    document.title = `${record.qualifiedName} · Sidebar preview`
  }
  const appearance = () => {
    document.documentElement.dataset.themeMode = config.theme
    document.documentElement.style.colorScheme = config.theme
    root.style.setProperty('--sidebar-width', `${config.width}px`)
    text('[data-preview-mode]', config.variant)
  }
  const apply = async (next: SidebarDemoConfig, requestRevision: number) => {
    config = { ...next, language: json.port as SidebarDemoConfig['language'] }
    if (!catalog.symbols.has(config.symbol)) config.symbol = examples[0]?.id ?? catalog.records[0]!.id
    appearance()
    if (!nav.dataset.presentationReady || nav.dataset.restoring === 'true' || nav.dataset.presentation !== config.variant || nav.dataset.symbol !== config.symbol) {
      const record = await setApiSidebar(nav, config.variant, config.symbol, { notify: false })
      if (!record || requestRevision !== revision) return
      config.symbol = record.id
      article(record.id)
    } else if (!articleSymbol) article(config.symbol)
    history.replaceState({ ...history.state, sidebarDemo: true }, '', demoUrl(new URL(location.href), config))
    send('sidebar-demo:configured', { symbol: config.symbol, revision: requestRevision })
  }
  nav.addEventListener('api-sidebar:change', (event) => {
    const detail = (event as CustomEvent<{ symbol: string; presentation: SidebarDemoConfig['variant'] }>).detail
    config = { ...config, symbol: detail.symbol, variant: detail.presentation }
    appearance()
    article(config.symbol)
    history.replaceState({ ...history.state, sidebarDemo: true }, '', demoUrl(new URL(location.href), config))
    send('sidebar-demo:selection', { symbol: config.symbol, variant: config.variant, revision })
  })
  root.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.defaultPrevented) return
    const anchor = (event.target as Element).closest<HTMLAnchorElement>('a')
    if (!anchor || anchor.hasAttribute('data-preview-full') || anchor.hasAttribute('data-api-owner-back')) return
    const symbol = anchor.origin === location.origin && byHref.get(anchor.pathname)
    if (!symbol) return
    event.preventDefault()
    nav.dispatchEvent(new CustomEvent('api-sidebar:clear-search'))
    void setApiSidebar(nav, config.variant, symbol)
    if (nav.hasAttribute('data-open')) {
      nav.querySelector<HTMLButtonElement>('[data-api-nav-close]')?.click()
      root.querySelector<HTMLElement>('#preview-article')?.focus({ preventScroll: true })
    }
  })
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== 'sidebar-demo:configure') return
    if (!Number.isSafeInteger(event.data.revision) || event.data.revision < revision) return
    const next = demoConfig(new URLSearchParams(event.data.query))
    if (next.language !== json.port) return
    revision = event.data.revision
    void apply(next, revision)
  })
  await apply(config, revision)
  send('sidebar-demo:ready', { examples })
  root.dataset.ready = 'true'
}
