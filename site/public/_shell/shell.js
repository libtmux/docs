/** Shared navigation and theme integration for native API generators. */
;(function () {
  'use strict'

  // >>> generated from site/src/lib/ports.ts by scripts/gen-shell-ports.mjs
  var PORTS = [
    {"slug":"py","name":"Python","versionedDocs":true},
    {"slug":"ts","name":"TypeScript","versionedDocs":true},
    {"slug":"rs","name":"Rust","versionedDocs":true},
    {"slug":"go","name":"Go","versionedDocs":true},
    {"slug":"java","name":"Java","versionedDocs":true},
    {"slug":"dotnet","name":".NET","versionedDocs":true},
    {"slug":"cxx","name":"C++","versionedDocs":true},
    {"slug":"swift","name":"Swift","versionedDocs":true},
  ]
  // <<< end generated

  var portNames = PORTS.map(function (port) { return port.slug }).join('|')
  var routeMatch = new RegExp('^(.*?)/(' + portNames + ')/([^/]+)/(.*)$').exec(location.pathname)
  var siteRoot = routeMatch ? routeMatch[1] : '/en'
  var currentPort = routeMatch ? routeMatch[2] : null
  var currentVersion = routeMatch ? routeMatch[3] : null
  var pagePath = routeMatch ? routeMatch[4] : ''
  var portMeta = PORTS.find(function (port) { return port.slug === currentPort })
  var portDefaults = {}
  var pageLinks
  var manifest = fetch(siteRoot + '/versions.json', { cache: 'no-cache' })
    .then(function (response) { return response.ok ? response.json() : null })
    .catch(function () { return null })

  function portHome(port) {
    var version = port.slug === currentPort ? currentVersion : (portDefaults[port.slug] || 'latest')
    return siteRoot + '/' + port.slug + '/' + (port.versionedDocs ? version + '/' : '')
  }

  function defineVersionSwitcher() {
    if (customElements.get('libtmux-version-switcher')) return
    class LibtmuxVersionSwitcher extends HTMLElement {
      connectedCallback() {
        var select = this.querySelector('select')
        var port = this.dataset.port
        var current = this.dataset.current
        if (!select || !port) return
        manifest.then(function (data) {
          if (!data || data.schema !== 1) return
          var entries = (data.ports[port] || []).filter(function (entry) { return entry.supported })
          if (!entries.length) return
          select.innerHTML = ''
          entries.forEach(function (entry) {
            var option = document.createElement('option')
            option.value = entry.slug
            option.textContent = entry.eol ? entry.label + ' (end of life)' : entry.label
            option.selected = entry.slug === current
            select.appendChild(option)
          })
          select.addEventListener('change', function () {
            if (select.value && select.value !== current) {
              location.href = siteRoot + '/' + port + '/' + select.value + '/' + pagePath + location.hash
            }
          })
        })
      }
    }
    customElements.define('libtmux-version-switcher', LibtmuxVersionSwitcher)
  }

  function buildVersionSwitcher(port, version) {
    if (!port || !port.versionedDocs) return null
    var element = document.createElement('libtmux-version-switcher')
    element.dataset.port = port.slug
    element.dataset.current = version
    element.className = 'lt-shell-version'
    var select = document.createElement('select')
    select.setAttribute('aria-label', 'Version of the ' + port.name + ' documentation')
    var option = document.createElement('option')
    option.value = version
    option.textContent = version
    option.selected = true
    select.appendChild(option)
    element.appendChild(select)
    return element
  }

  function dropdown(label, accessibleLabel) {
    var details = document.createElement('details')
    details.className = 'lt-shell-dropdown'
    var summary = document.createElement('summary')
    summary.textContent = label
    summary.setAttribute('aria-label', accessibleLabel)
    var list = document.createElement('ul')
    details.appendChild(summary)
    details.appendChild(list)
    return details
  }

  function refreshPagePorts() {
    var control = document.querySelector('[data-page-port-switcher]')
    if (!control) return
    var list = control.querySelector('ul')
    list.innerHTML = ''
    var symbols = pageLinks && pageLinks.symbols[currentPort] || {}
    var hash = ''
    try { hash = decodeURIComponent(location.hash.slice(1)) } catch (_) { /* Invalid fragment. */ }
    var subject = hash ? document.getElementById(hash) : null
    var signature = subject && subject.closest('dt.sig')
    var pageSignature = document.querySelector('dt.sig[id]')
    var matches = symbols[hash] || (signature
      ? symbols[signature.id]
      : pageSignature && symbols[pageSignature.id]) || []
    var indexPage = /^api\/(?:index\.html)?$/.test(pagePath)
    PORTS.forEach(function (port) {
      var links = matches.filter(function (entry, i, all) {
        return entry.port === port.slug && all.findIndex(function (candidate) {
          return candidate.port === entry.port && candidate.href === entry.href
        }) === i
      })
      if (indexPage && pageLinks) links = [{ href: pageLinks.indexes[port.slug] }]
      if (port.slug === currentPort) links = [{ href: location.pathname + location.hash }]
      var item = document.createElement('li')
      if (links.length) {
        links.forEach(function (entry) {
          var link = document.createElement('a')
          link.href = entry.href
          link.textContent = port.name + (links.length > 1 ? ': ' + entry.label : '')
          if (port.slug === currentPort) link.setAttribute('aria-current', 'page')
          item.appendChild(link)
        })
      } else {
        var disabled = document.createElement('span')
        disabled.textContent = port.name + ' (Unavailable)'
        disabled.setAttribute('aria-disabled', 'true')
        item.appendChild(disabled)
      }
      list.appendChild(item)
    })
  }

  function buildHeader() {
    var header = document.createElement('div')
    header.className = 'lt-shell-header'
    header.setAttribute('data-lt-shell', 'header')
    var brand = document.createElement('a')
    brand.className = 'lt-shell-brand'
    brand.href = siteRoot + '/'
    brand.textContent = 'libtmux'
    header.appendChild(brand)
    var nav = document.createElement('nav')
    nav.className = 'lt-shell-nav'
    nav.setAttribute('aria-label', 'Language')
    PORTS.forEach(function (port) {
      var link = document.createElement('a')
      link.href = portHome(port)
      link.dataset.portHome = port.slug
      link.textContent = port.name
      link.className = 'lt-shell-nav-link' + (port.slug === currentPort ? ' lt-shell-nav-link--active' : '')
      if (port.slug === currentPort) link.setAttribute('aria-current', 'page')
      nav.appendChild(link)
    })
    header.appendChild(nav)
    var controls = document.createElement('div')
    controls.className = 'lt-shell-controls'
    controls.setAttribute('data-header-controls', '')
    header.appendChild(controls)
    var versionSwitcher = buildVersionSwitcher(portMeta, currentVersion)
    if (versionSwitcher) controls.appendChild(versionSwitcher)
    var pageSwitchers = document.createElement('div')
    pageSwitchers.className = 'lt-shell-page-switchers'
    pageSwitchers.setAttribute('data-page-switchers', '')
    var pageSwitcher = dropdown(portMeta ? portMeta.name : 'In other ports', 'This page in other programming languages')
    pageSwitcher.setAttribute('data-page-port-switcher', '')
    pageSwitchers.appendChild(pageSwitcher)
    var localeSwitcher = dropdown('English', 'Available translations')
    var localeItem = document.createElement('li')
    var localeLink = document.createElement('a')
    localeLink.href = location.pathname
    localeLink.textContent = 'English'
    localeLink.lang = 'en'
    localeLink.setAttribute('aria-current', 'true')
    localeItem.appendChild(localeLink)
    localeSwitcher.querySelector('ul').appendChild(localeItem)
    pageSwitchers.appendChild(localeSwitcher)
    controls.appendChild(pageSwitchers)
    ;[['Reference', '/reference/'], ['MCP', '/mcp/'], ['Search', '/search/']].forEach(function (entry) {
      var link = document.createElement('a')
      link.className = 'lt-shell-search-link'
      link.href = siteRoot + entry[1]
      link.textContent = entry[0]
      controls.appendChild(link)
    })
    return header
  }

  function buildFooter() {
    var footer = document.createElement('div')
    footer.className = 'lt-shell-footer'
    footer.setAttribute('data-lt-shell', 'footer')
    var list = document.createElement('ul')
    list.className = 'lt-shell-footer-list'
    PORTS.forEach(function (port) {
      var item = document.createElement('li')
      var link = document.createElement('a')
      link.href = portHome(port)
      link.dataset.portHome = port.slug
      link.textContent = port.name
      item.appendChild(link)
      list.appendChild(item)
    })
    var item = document.createElement('li')
    var link = document.createElement('a')
    link.href = siteRoot + '/third-party-notices/'
    link.textContent = 'Third-party notices'
    item.appendChild(link)
    list.appendChild(item)
    footer.appendChild(list)
    return footer
  }

  var CHROME_STYLE =
    '.lt-shell-header,.lt-shell-footer{font-family:var(--lt-font-sans,sans-serif);' +
    'font-size:0.875rem;background:var(--lt-color-bg,#fff);color:var(--lt-color-fg,#000);box-sizing:border-box}' +
    '.lt-shell-header *,.lt-shell-footer *{box-sizing:border-box}' +
    '.lt-shell-header{display:flex;flex-wrap:wrap;align-items:center;gap:0.75rem;' +
    'padding:0.6rem 1rem;border-bottom:1px solid var(--lt-color-border,#eeebee)}' +
    '.lt-shell-brand{font-family:var(--lt-font-mono,monospace);font-weight:600;' +
    'font-size:1.05rem;color:var(--lt-color-fg,#000);text-decoration:none;letter-spacing:-0.01em}' +
    '.lt-shell-nav{display:flex;flex-wrap:wrap;gap:0.15rem;flex:1}' +
    '.lt-shell-nav-link{padding:0.25rem 0.5rem;border-radius:var(--lt-radius,0.375rem);' +
    'color:var(--lt-color-fg-secondary,#5a5c63);text-decoration:none}' +
    '.lt-shell-nav-link:hover{background:var(--lt-color-bg-hover,#efeff4)}' +
    '.lt-shell-nav-link--active{font-weight:600;color:var(--lt-color-accent,#0a4bff);' +
    'background:var(--lt-color-bg-secondary,#f8f9fb)}' +
    '.lt-shell-version select{border:1px solid var(--lt-color-border,#eeebee);' +
    'border-radius:var(--lt-radius,0.375rem);padding:0.2rem 0.4rem;font-size:0.85rem;' +
    'background:var(--lt-color-bg,#fff);color:var(--lt-color-fg,#000)}' +
    '.lt-shell-search-link{padding:0.25rem 0.6rem;border:1px solid var(--lt-color-border,#eeebee);' +
    'border-radius:var(--lt-radius,0.375rem);color:var(--lt-color-fg,#000);text-decoration:none}' +
    '.lt-shell-search-link:hover{background:var(--lt-color-bg-hover,#efeff4)}' +
    '.lt-shell-controls{position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:1rem;max-width:100%}' +
    '.lt-shell-page-switchers{display:flex;flex-wrap:nowrap;align-items:center;flex-shrink:0;gap:1rem}' +
    '.lt-shell-dropdown summary{list-style:none;cursor:pointer;padding:.25rem .5rem;border-radius:var(--lt-radius,.375rem)}' +
    '.lt-shell-dropdown summary::-webkit-details-marker{display:none}' +
    '.lt-shell-dropdown summary:hover{background:var(--lt-color-bg-hover,#efeff4)}' +
    '.lt-shell-dropdown ul{position:absolute;left:0;z-index:50;width:16rem;max-width:calc(100vw - 2rem);list-style:none;margin:.25rem 0 0;padding:.25rem 0;' +
    'border:1px solid var(--lt-color-border,#eeebee);border-radius:.25rem;background:var(--lt-color-bg,#fff);box-shadow:0 10px 15px -3px #0003}' +
    '.lt-shell-dropdown li a,.lt-shell-dropdown li>span{display:block;padding:.375rem .75rem;color:inherit;text-decoration:none}' +
    '.lt-shell-dropdown li a:hover{background:var(--lt-color-bg-hover,#efeff4)}' +
    '.lt-shell-dropdown [aria-current]{font-weight:600}' +
    '.lt-shell-dropdown [aria-disabled]{color:var(--lt-color-fg-secondary,#5a5c63)}' +
    '.lt-shell-footer{margin-top:2rem;padding:1.5rem 1rem;border-top:1px solid var(--lt-color-border,#eeebee)}' +
    '.lt-shell-footer-list{list-style:none;display:flex;flex-wrap:wrap;gap:0 1rem;margin:0;padding:0}' +
    '.lt-shell-footer-list a{color:var(--lt-color-fg-secondary,#5a5c63);text-decoration:none}' +
    '.lt-shell-footer-list a:hover{text-decoration:underline}'

  function injectChrome() {
    if (document.getElementById('lt-shell-style')) return
    var style = document.createElement('style')
    style.id = 'lt-shell-style'
    style.textContent = CHROME_STYLE
    document.head.appendChild(style)
    defineVersionSwitcher()
    document.body.insertBefore(buildHeader(), document.body.firstChild)
    document.body.appendChild(buildFooter())
    refreshPagePorts()
    manifest.then(function (data) {
      if (!data || data.schema !== 1) return
      portDefaults = data.defaultVersion || {}
      document.querySelectorAll('[data-port-home]').forEach(function (link) {
        var port = PORTS.find(function (entry) { return entry.slug === link.dataset.portHome })
        if (port) link.href = portHome(port)
      })
    })
    fetch(siteRoot + '/page-links.json')
      .then(function (response) { return response.ok ? response.json() : null })
      .then(function (data) {
        if (data && data.schema === 1) {
          pageLinks = data
          refreshPagePorts()
        }
      })
      .catch(function () { /* Keep unavailable entries disabled when the manifest cannot load. */ })
    window.addEventListener('hashchange', refreshPagePorts)
  }

  // ---------------------------------------------------------------------
  // Dark-mode shim (design-token-bridge.md §4: shim, don't replace).
  //
  // Canonical key: `libtmux-theme`. notes/research/00-DECISIONS.md §7.13
  // leaves this an open decision ("pick one before shell.js ships"); this
  // file makes the call and records it here rather than in a separate
  // document. Furo's own key (`theme`) stays authoritative for Furo's own
  // toggle and paint logic — this shim only mirrors the *resolved* value
  // onto html[data-theme], which is the attribute tokens.css reads, and
  // writes the canonical key through so a future non-Furo generator (or
  // the Astro shell, if it ever adopts this key — see the open question in
  // the same section) can agree on "what did the reader last choose"
  // without re-deriving it from Furo's storage format.
  // ---------------------------------------------------------------------
  var CANONICAL_KEY = 'libtmux-theme'
  var FURO_KEY = 'theme' // gp-furo-theme's furo.ts: localStorage.setItem('theme', mode)

  function systemPrefersDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  }

  function readPreference() {
    // Furo's own key is authoritative for what actually painted this page
    // (its inline pre-paint script already ran); fall back to the
    // canonical key, then "auto".
    try {
      var native = localStorage.getItem(FURO_KEY)
      if (native === 'light' || native === 'dark' || native === 'auto') return native
    } catch (e) {
      /* storage disabled */
    }
    try {
      var canonical = localStorage.getItem(CANONICAL_KEY)
      if (canonical === 'light' || canonical === 'dark' || canonical === 'auto') return canonical
    } catch (e) {
      /* storage disabled */
    }
    return 'auto'
  }

  function applyResolvedTheme() {
    var pref = readPreference()
    var resolved = pref === 'auto' ? (systemPrefersDark() ? 'dark' : 'light') : pref

    // html[data-theme] is what tokens.css keys off. "auto" is never
    // written here — the fallback in tokens.css already tracks the media
    // query on its own, so an explicit attribute would only fight it on
    // the next OS-level change.
    if (pref === 'auto') {
      document.documentElement.removeAttribute('data-theme')
    } else {
      document.documentElement.setAttribute('data-theme', resolved)
    }

    // Write through the canonical key so it never drifts from what Furo's
    // own toggle just decided.
    try {
      localStorage.setItem(CANONICAL_KEY, pref)
    } catch (e) {
      /* storage disabled */
    }
  }

  function watchNativeToggle() {
    // Furo's toggle button mutates document.body's data-theme attribute
    // directly with no event of its own — observe that instead of
    // reimplementing its click handler, which is the fork this bridge is
    // built to avoid (design-token-bridge.md §4).
    if (!window.MutationObserver || !document.body) return
    new MutationObserver(applyResolvedTheme).observe(document.body, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
  }

  function watchSystemPreference() {
    if (!window.matchMedia) return
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      if (readPreference() === 'auto') applyResolvedTheme()
    })
  }

  function watchCrossTab() {
    window.addEventListener('storage', function (e) {
      if (e.key === FURO_KEY || e.key === CANONICAL_KEY) applyResolvedTheme()
    })
  }

  // ---------------------------------------------------------------------
  // Boot.
  // ---------------------------------------------------------------------
  function boot() {
    applyResolvedTheme()
    watchNativeToggle()
    watchSystemPreference()
    watchCrossTab()
    injectChrome()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
