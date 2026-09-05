/**
 * libtmux.org shell — runtime chrome for foreign generators.
 *
 * Served from a stable URL (/_shell/shell.js) and loaded via each foreign
 * generator's own script-injection flag (Sphinx: html_js_files; the same
 * mechanism works for rustdoc's --html-in-header, Dokka's templatesDir, and
 * DocC's header.html/footer.html if this bridge is ever extended to them —
 * see notes/research/03-design-token-bridge.md). Vanilla JS, no framework,
 * no build step, so it runs unmodified inside whatever HTML each generator
 * emits.
 *
 * Three jobs, matching notes/status.md's "Python and C++ are unskinned
 * islands" glitch exactly:
 *
 *   1. Inject a header (port switcher + version switcher + search link) and
 *      footer (port list) so a Sphinx page reads as the same site as the
 *      Astro-rendered ports, not a different website.
 *   2. The version switcher: a <libtmux-version-switcher> custom element
 *      with the IDENTICAL contract as
 *      site/src/components/VersionSwitcher.astro — same element name, same
 *      dataset keys, same /versions.json shape, same path-preserving
 *      navigation, same ecosystem-port suppression. Kept in sync by hand;
 *      if that component's contract changes, this must change with it.
 *   3. A dark-mode shim: shim, don't replace (design-token-bridge.md §4).
 *      Furo keeps its own toggle, its own `theme` localStorage key, and its
 *      own body[data-theme] attribute — this only mirrors the *resolved*
 *      value onto html[data-theme], which is the attribute tokens.css
 *      reads (see tokens.css's own header comment for why :root/html, not
 *      body).
 *
 * PORTS below is a literal, hand-kept-in-sync copy of the fields this file
 * needs from site/src/lib/ports.ts (name, referenceMode, and — for
 * ecosystem ports — the exact ecosystemHost URL, copied verbatim, never
 * invented). A runtime script has no bundler and cannot import that
 * module; ThemeScript.astro already accepts the identical trade-off for
 * theme-config.ts, with the same comment shape, for the same reason.
 */
;(function () {
  'use strict'

  /** Keep in sync with site/src/lib/ports.ts. */
  var PORTS = [
    { slug: 'py', name: 'Python', mode: 'self-hosted' },
    { slug: 'ts', name: 'TypeScript', mode: 'self-hosted' },
    { slug: 'rs', name: 'Rust', mode: 'ecosystem', home: 'https://docs.rs/libtmux' },
    {
      slug: 'go',
      name: 'Go',
      mode: 'ecosystem',
      home: 'https://pkg.go.dev/github.com/libtmux/libtmux-go/tmux',
    },
    {
      slug: 'java',
      name: 'Java',
      mode: 'ecosystem',
      home: 'https://javadoc.io/doc/io.github.libtmux/libtmux',
    },
    { slug: 'dotnet', name: '.NET', mode: 'self-hosted' },
    { slug: 'cxx', name: 'C++', mode: 'self-hosted' },
    { slug: 'swift', name: 'Swift', mode: 'self-hosted' },
  ]

  // ---------------------------------------------------------------------
  // Where are we? The site's own URL scheme (ports.ts, versions.ts) is
  // /<port>/<version>/..., which every self-hosted port's build uses
  // uniformly — so parsing location.pathname is sufficient and needs no
  // per-generator config plumbed through conf.py.
  // ---------------------------------------------------------------------
  var routeMatch = /^\/([a-z]+)\/([^/]+)\//.exec(location.pathname)
  var currentPort = routeMatch ? routeMatch[1] : null
  var currentVersion = routeMatch ? routeMatch[2] : null
  var portMeta = null
  for (var i = 0; i < PORTS.length; i++) {
    if (PORTS[i].slug === currentPort) {
      portMeta = PORTS[i]
      break
    }
  }

  // ---------------------------------------------------------------------
  // Version switcher — identical contract to VersionSwitcher.astro.
  // ---------------------------------------------------------------------
  function defineVersionSwitcher() {
    if (customElements.get('libtmux-version-switcher')) return

    class LibtmuxVersionSwitcher extends HTMLElement {
      connectedCallback() {
        var select = this.querySelector('select')
        var port = this.dataset.port
        var current = this.dataset.current
        if (!select || !port) return

        fetch('/versions.json', { cache: 'no-cache' })
          .then(function (res) {
            if (!res.ok) return null
            return res.json()
          })
          .then(function (manifest) {
            // Offline, or the manifest is not deployed yet: the baked-in
            // single option (current version) stays, which is correct
            // rather than empty — same fallback VersionSwitcher.astro takes.
            if (!manifest || manifest.schema !== 1) return

            var entries = (manifest.ports[port] || []).filter(function (e) {
              return e.supported
            })
            if (entries.length === 0) return

            select.innerHTML = ''
            for (var j = 0; j < entries.length; j++) {
              var entry = entries[j]
              var opt = document.createElement('option')
              opt.value = entry.slug
              opt.textContent = entry.eol ? entry.label + ' (end of life)' : entry.label
              if (entry.slug === current) opt.selected = true
              select.appendChild(opt)
            }

            select.addEventListener('change', function () {
              var next = select.value
              if (!next || next === current) return
              // Keep the reader on the same page across the version jump
              // when that page exists; the 404 handler sends them to the
              // version root when it does not.
              var path = location.pathname
              var marker = '/' + port + '/' + current + '/'
              var rest = path.indexOf(marker) === 0 ? path.slice(marker.length) : ''
              location.href = '/' + port + '/' + next + '/' + rest
            })
          })
          .catch(function () {
            /* offline or manifest missing — baked-in option stands */
          })
      }
    }
    customElements.define('libtmux-version-switcher', LibtmuxVersionSwitcher)
  }

  function buildVersionSwitcher(port, version) {
    // Ecosystem ports have no local version tree on this site — their
    // versions live on docs.rs / pkg.go.dev / javadoc.io. Offering a
    // switcher here would navigate to a /rs/<version>/ prefix that never
    // existed. Mirrors VersionSwitcher.astro's own guard exactly. Not
    // reachable for py/cxx today (both self-hosted); kept so this file
    // needs no change if it is later loaded on an ecosystem host's page
    // (e.g. docs.rs via [package.metadata.docs.rs] rustdoc-args).
    if (!port || port.mode === 'ecosystem') return null

    var el = document.createElement('libtmux-version-switcher')
    el.dataset.port = port.slug
    el.dataset.current = version
    el.className = 'lt-shell-version'

    var label = document.createElement('label')
    label.className = 'lt-shell-sr-only'
    label.setAttribute('for', 'libtmux-version')
    label.textContent = 'Version'

    var select = document.createElement('select')
    select.id = 'libtmux-version'
    select.setAttribute('aria-label', 'Version of the ' + port.name + ' documentation')

    var opt = document.createElement('option')
    opt.value = version
    opt.textContent = version
    opt.selected = true
    select.appendChild(opt)

    el.appendChild(label)
    el.appendChild(select)
    return el
  }

  // ---------------------------------------------------------------------
  // Header + footer injection.
  // ---------------------------------------------------------------------
  function buildHeader() {
    var header = document.createElement('div')
    header.className = 'lt-shell-header'
    header.setAttribute('data-lt-shell', 'header')

    var brand = document.createElement('a')
    brand.className = 'lt-shell-brand'
    // Root-relative, like every other link this file builds (SiteHeader.astro
    // uses href="/" too) — an absolute libtmux.org URL would jump a PR
    // preview or local build to production instead of staying on it.
    brand.href = '/'
    brand.textContent = 'libtmux'
    header.appendChild(brand)

    var nav = document.createElement('nav')
    nav.className = 'lt-shell-nav'
    nav.setAttribute('aria-label', 'Language')
    for (var i = 0; i < PORTS.length; i++) {
      var p = PORTS[i]
      var a = document.createElement('a')
      var active = p.slug === currentPort
      // Mirrors PortSwitcher.astro exactly: the active port links to its
      // own version root (portHomeUrl()), every other port to its bare
      // landing page — ecosystem ports always leave the site.
      if (p.mode === 'ecosystem') a.href = p.home
      else if (active) a.href = '/' + p.slug + '/' + currentVersion + '/'
      else a.href = '/' + p.slug + '/'
      a.textContent = p.name
      a.className = 'lt-shell-nav-link' + (active ? ' lt-shell-nav-link--active' : '')
      if (active) a.setAttribute('aria-current', 'page')
      if (p.mode === 'ecosystem') {
        var ext = document.createElement('span')
        ext.className = 'lt-shell-external'
        ext.title = 'API reference hosted on ' + p.name + "'s ecosystem host"
        ext.textContent = '↗'
        a.appendChild(document.createTextNode(' '))
        a.appendChild(ext)
      }
      nav.appendChild(a)
    }
    header.appendChild(nav)

    if (portMeta && currentVersion) {
      var vs = buildVersionSwitcher(portMeta, currentVersion)
      if (vs) header.appendChild(vs)
    }

    var search = document.createElement('a')
    search.className = 'lt-shell-search-link'
    search.href = '/search/'
    search.setAttribute('aria-label', 'Search the documentation')
    search.textContent = 'Search'
    header.appendChild(search)

    return header
  }

  function buildFooter() {
    var footer = document.createElement('div')
    footer.className = 'lt-shell-footer'
    footer.setAttribute('data-lt-shell', 'footer')

    var list = document.createElement('ul')
    list.className = 'lt-shell-footer-list'
    for (var i = 0; i < PORTS.length; i++) {
      var p = PORTS[i]
      var li = document.createElement('li')
      var a = document.createElement('a')
      a.href = p.mode === 'ecosystem' ? p.home : '/' + p.slug + '/'
      a.textContent = p.name
      li.appendChild(a)
      list.appendChild(li)
    }
    var noticesLi = document.createElement('li')
    var noticesA = document.createElement('a')
    noticesA.href = '/third-party-notices/'
    noticesA.textContent = 'Third-party notices'
    noticesLi.appendChild(noticesA)
    list.appendChild(noticesLi)

    footer.appendChild(list)
    return footer
  }

  var CHROME_STYLE =
    '.lt-shell-header,.lt-shell-footer{font-family:var(--lt-font-sans,sans-serif);' +
    'font-size:0.875rem;background:var(--lt-color-bg,#fff);color:var(--lt-color-fg,#000);' +
    'box-sizing:border-box}' +
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
    '.lt-shell-external{font-size:0.75rem;opacity:0.6}' +
    '.lt-shell-version select{border:1px solid var(--lt-color-border,#eeebee);' +
    'border-radius:var(--lt-radius,0.375rem);padding:0.2rem 0.4rem;font-size:0.85rem;' +
    'background:var(--lt-color-bg,#fff);color:var(--lt-color-fg,#000)}' +
    '.lt-shell-search-link{padding:0.25rem 0.6rem;border:1px solid var(--lt-color-border,#eeebee);' +
    'border-radius:var(--lt-radius,0.375rem);color:var(--lt-color-fg,#000);text-decoration:none}' +
    '.lt-shell-search-link:hover{background:var(--lt-color-bg-hover,#efeff4)}' +
    '.lt-shell-footer{margin-top:2rem;padding:1.5rem 1rem;' +
    'border-top:1px solid var(--lt-color-border,#eeebee)}' +
    '.lt-shell-footer-list{list-style:none;display:flex;flex-wrap:wrap;' +
    'gap:0 1rem;margin:0;padding:0}' +
    '.lt-shell-footer-list a{color:var(--lt-color-fg-secondary,#5a5c63);text-decoration:none}' +
    '.lt-shell-footer-list a:hover{text-decoration:underline}' +
    '.lt-shell-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;' +
    'overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}'

  function injectChrome() {
    if (document.getElementById('lt-shell-style')) return // idempotent

    var style = document.createElement('style')
    style.id = 'lt-shell-style'
    style.textContent = CHROME_STYLE
    document.head.appendChild(style)

    defineVersionSwitcher()

    if (document.body.firstChild) {
      document.body.insertBefore(buildHeader(), document.body.firstChild)
    } else {
      document.body.appendChild(buildHeader())
    }
    document.body.appendChild(buildFooter())
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
