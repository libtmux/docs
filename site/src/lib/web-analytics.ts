/** Analytics starts after load and only with a fresh edge permission. */
export function initializeWebAnalytics(policyUrl: string): void {
  const win = window as Window & { __libtmuxWebAnalytics?: boolean }
  if (win.__libtmuxWebAnalytics) return
  win.__libtmuxWebAnalytics = true

  const start = async () => {
    if (document.querySelector('script[data-cf-beacon]')) return
    try {
      const response = await win.fetch(policyUrl, { cache: 'no-store', credentials: 'same-origin' })
      if (!response.ok || response.headers.get('x-libtmux-analytics') !== 'allow') return
      const { token } = await response.json()
      if (typeof token !== 'string' || !/^[a-f0-9]{32}$/.test(token)) return
      const script = document.createElement('script')
      script.type = 'module'
      script.async = true
      script.src = 'https://static.cloudflareinsights.com/beacon.min.js'
      script.dataset.cfBeacon = JSON.stringify({ token })
      document.head.append(script)
    } catch {
      // Failed policy requests leave optional analytics disabled.
      return
    }
  }
  if (document.readyState === 'complete') void start()
  else win.addEventListener('load', () => { void start() }, { once: true })
}
