import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { Window } from 'happy-dom'
import { describe, expect, it } from 'vitest'
import { normalizeNativeShell } from '../../scripts/normalize-native-shell.mjs'
import { nativeArticle, nativeHash } from '../../scripts/native-shell-context.mjs'
import { recordBuild, verifyBuild } from '../../scripts/publication-provenance.mjs'
import { installAnchorNavigation } from '../public/_shell/anchors.js'

/** Compose the pinned native widget and actual shell arrival callbacks. */
async function nativeLayout(coordinated = true, sharedFirst = false) {
  const directory = mkdtempSync(join(tmpdir(), 'native-layout-'))
  const win = new Window({ url: 'https://libtmux.org/en/py/latest/api/#parameter' })
  let cleanup = () => {}
  try {
    mkdirSync(join(directory, '_static/js'), { recursive: true })
    const file = join(directory, '_static/js/layout.js')
    writeFileSync(file, readFileSync(new URL('./fixtures/native-layout.js', import.meta.url)))
    const contextFile = join(directory, 'context.json')
    writeFileSync(contextFile, JSON.stringify({ port: 'py', version: 'latest', root: '/en/', pages: [] }))
    const options = { sphinxPort: 'py', contextFile }
    await normalizeNativeShell(directory, '/en', options)
    const layouts: (() => void)[] = []
    const frames = new Map<number, FrameRequestCallback>()
    const timers = new Map<number, { work: () => void; delay: number | undefined }>()
    let sequence = 0
    const scrolled: { id: string; hidden: boolean }[] = []
    if (coordinated) Object.assign(win, {
      __libtmuxAppearance: { layout: (work: () => void) => layouts.push(work) },
    })
    Object.assign(win, {
      requestAnimationFrame: (work: FrameRequestCallback) => { frames.set(++sequence, work); return sequence },
      cancelAnimationFrame: (id: number) => frames.delete(id),
      setTimeout: (work: () => void, delay?: number) => {
        // Happy DOM's history bookkeeping queues a task without a delay.
        expect([undefined, 2600]).toContain(delay)
        const id = ++sequence
        timers.set(id, { work, delay })
        return id
      },
      clearTimeout: (id: number) => timers.delete(id),
    })
    win.document.documentElement.classList.add('fonts-pending', 'link-hints-pending')
    win.document.body.innerHTML = '<div class="gp-sphinx-api-header"><div class="gp-sphinx-api-signature"><button class="gp-sphinx-api-signature-toggle" aria-controls="expanded" aria-expanded="false"></button><div id="expanded" class="gp-sphinx-api-signature-expanded" hidden><span id="parameter">Parameter</span></div></div></div><h2 id="other">Other</h2>'
    win.HTMLElement.prototype.scrollIntoView = function () {
      scrolled.push({ id: this.id, hidden: Boolean(this.closest('[hidden]')) })
    }
    win.HTMLElement.prototype.getBoundingClientRect = () => new win.DOMRect(0, 200, 100, 30)
    const shared = () => { cleanup = installAnchorNavigation(win as unknown as typeof window) }
    if (coordinated && sharedFirst) shared()
    win.eval(readFileSync(file, 'utf8'))
    if (coordinated && !sharedFirst) shared()
    const shell = readFileSync(new URL('../src/components/docs/NativeSphinxScript.astro', import.meta.url), 'utf8')
    const start = shell.lastIndexOf('  layoutBeforeAppearance(() => {')
    const end = shell.indexOf('\n</script>', start)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    // Run the real final automatic event, not the unrelated native picker/ToC.
    win.eval(`(function (layoutBeforeAppearance) {${shell.slice(start, end)}\n})(function (work) { if (window.__libtmuxAppearance) window.__libtmuxAppearance.layout(work); else work(); });`)
    const prepare = () => {
      for (let pass = 0; layouts.length; pass++) {
        expect(pass).toBeLessThan(4)
        layouts.splice(0).forEach((work) => work())
      }
    }
    const flush = () => { const work = [...frames.values()]; frames.clear(); work.forEach((fn) => fn(0)) }
    return { win, scrolled, prepare, flush, timers, file, directory, options,
      dispose: async () => { cleanup(); await win.happyDOM.abort(); rmSync(directory, { recursive: true, force: true }) } }
  } catch (error) {
    cleanup(); await win.happyDOM.abort(); rmSync(directory, { recursive: true, force: true }); throw error
  }
}

describe('native shell URL normalization', () => {
  it('records browser bookkeeping without allowing a delayed native scroll', async () => {
    const p = await nativeLayout()
    try {
      p.win.history.replaceState(null, '', '#other')
      const pending = [...p.timers.values()]
      expect(pending).toHaveLength(1)
      expect(pending[0]?.delay).toBeUndefined()
      expect(p.scrolled).toEqual([])
      expect(() => p.win.setTimeout(() => {}, 50)).toThrow()
      p.prepare()
      expect(p.scrolled).toEqual([])
      expect(p.win.location.hash).toBe('#other')
    } finally { await p.dispose() }
  })

  it.each([false, true])('expands native panels before shared startup arrival (shared first: %s)', async (sharedFirst) => {
    const p = await nativeLayout(true, sharedFirst)
    try {
      p.win.document.documentElement.setAttribute('data-anchor-startup', p.win.location.href)
      p.prepare()
      expect(p.win.document.querySelector('#expanded')?.hasAttribute('hidden')).toBe(false)
      expect(p.scrolled).toEqual([{ id: 'parameter', hidden: false }])
      expect(await normalizeNativeShell(p.directory, '/en', p.options)).toBe(0)
    } finally { await p.dispose() }
  })

  it.each(['wheel', 'touchstart', 'pointerdown', 'PageDown', 'Tab'])('cannot recover cancelled initial scroll through either native entry: %s', async (input) => {
    const p = await nativeLayout()
    try {
      p.win.document.documentElement.setAttribute('data-anchor-startup', p.win.location.href)
      p.win.document.dispatchEvent(['PageDown', 'Tab'].includes(input)
        ? new p.win.KeyboardEvent('keydown', { key: input, bubbles: true })
        : new p.win.Event(input, { bubbles: true }))
      p.prepare()
      expect(p.win.document.querySelector('#expanded')?.hasAttribute('hidden')).toBe(false)
      expect(p.scrolled).toEqual([])
    } finally { await p.dispose() }
  })

  it.each([null, { index: 1, scrollY: 480 }])('keeps an unowned/history reading position through both native entries: %j', async (state) => {
    const p = await nativeLayout()
    try {
      p.win.history.replaceState(state, '')
      p.prepare()
      expect(p.scrolled).toEqual([])
      expect(p.win.history.state).toEqual(state)
    } finally { await p.dispose() }
  })

  it('does not turn a changed startup URL into native scroll intent', async () => {
    const p = await nativeLayout()
    try {
      p.win.document.documentElement.setAttribute('data-anchor-startup', p.win.location.href)
      p.win.history.replaceState(null, '', '#other')
      p.prepare()
      expect(p.scrolled).toEqual([])
      expect(p.win.location.hash).toBe('#other')
    } finally { await p.dispose() }
  })

  it('drops a queued native hash scroll after its URL changes again', async () => {
    const p = await nativeLayout()
    try {
      p.prepare()
      p.win.document.documentElement.classList.remove('fonts-pending', 'link-hints-pending')
      p.win.dispatchEvent(new p.win.HashChangeEvent('hashchange'))
      p.win.history.replaceState(null, '', '#other')
      p.prepare()
      expect(p.scrolled).toEqual([])
      expect(p.win.location.hash).toBe('#other')
    } finally { await p.dispose() }
  })

  it('retains later native hash, explicit navigation and signature controls', async () => {
    const p = await nativeLayout()
    try {
      p.prepare()
      p.win.document.documentElement.classList.remove('fonts-pending', 'link-hints-pending')
      const button = p.win.document.querySelector('button')!
      button.click()
      expect(p.win.document.querySelector('#expanded')?.hasAttribute('hidden')).toBe(true)
      p.win.dispatchEvent(new p.win.HashChangeEvent('hashchange'))
      p.prepare()
      expect(p.win.document.querySelector('#expanded')?.hasAttribute('hidden')).toBe(false)
      expect(p.scrolled).toEqual([{ id: 'parameter', hidden: false }])
      p.win.document.dispatchEvent(new p.win.CustomEvent('gp-sphinx:navigated', { detail: { url: p.win.location.href } }))
      p.prepare()
      expect(p.scrolled).toHaveLength(2)
      button.click()
      expect(button.getAttribute('aria-expanded')).toBe('false')
    } finally { await p.dispose() }
  })

  it('preserves standalone native startup when no coordinator exists', async () => {
    const p = await nativeLayout(false)
    try {
      const before = p.scrolled.length
      p.win.document.dispatchEvent(new p.win.Event('DOMContentLoaded'))
      expect(p.win.document.querySelector('#expanded')?.hasAttribute('hidden')).toBe(false)
      expect(p.scrolled).toHaveLength(before + 1)
      expect(p.scrolled.at(-1)).toEqual({ id: 'parameter', hidden: false })
    } finally { await p.dispose() }
  })

  it('completes pinned Sphinx highlighting during appearance layout without a timer', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'native-highlight-'))
    const win = new Window({ url: 'https://libtmux.org/en/py/stable/api/?highlight=window' })
    try {
      mkdirSync(join(directory, '_static'))
      const file = join(directory, '_static/sphinx_highlight.js')
      writeFileSync(file, readFileSync(new URL('./fixtures/sphinx_highlight.js', import.meta.url)))
      const contextFile = join(directory, 'context.json')
      writeFileSync(contextFile, JSON.stringify({ port: 'py', version: 'latest', root: '/en/', pages: [] }))
      const options = { sphinxPort: 'py', contextFile }
      await normalizeNativeShell(directory, '/en', options)
      const layouts: (() => void)[] = []
      Object.assign(win, {
        __libtmuxAppearance: { layout: (work: () => void) => layouts.push(work) },
        DOCUMENTATION_OPTIONS: { ENABLE_SEARCH_SHORTCUTS: false },
        _ready: () => { throw Error('Startup escaped appearance layout') },
        setTimeout: () => { throw Error('Highlighting escaped into a timer') },
      })
      win.document.body.innerHTML = '<div class="body">A tmux window</div>'
      win.eval(readFileSync(file, 'utf8'))
      expect(win.document.querySelector('.highlighted')).toBeNull()
      expect(layouts).toHaveLength(1)
      layouts[0]!()
      expect(win.document.querySelector('.highlighted')?.textContent).toBe('window')
      expect(win.location.search).toBe('')
      expect(await normalizeNativeShell(directory, '/en', options)).toBe(0)
      const digest = nativeHash(readFileSync(file)).slice(0, 12)
      expect(readFileSync(join(directory, `_astro/sphinx_highlight.${digest}.js`), 'utf8')).toBe(readFileSync(file, 'utf8'))
    } finally { await win.happyDOM.abort(); rmSync(directory, { recursive: true, force: true }) }
  })

  it.each(['copybutton.js', 'design-tabs.js', 'doctools.js'])('rejects an unrecognized native widget before adapting %s', async (name) => {
    const directory = mkdtempSync(join(tmpdir(), 'native-widget-'))
    try {
      mkdirSync(join(directory, '_static'))
      writeFileSync(join(directory, '_static', name), 'Changed native widget')
      const contextFile = join(directory, 'context.json')
      writeFileSync(contextFile, JSON.stringify({ port: 'py', version: 'latest', root: '/en/', pages: [] }))
      await expect(normalizeNativeShell(directory, '/en', { sphinxPort: 'py', contextFile })).rejects.toThrow('Native widget changed')
      expect(readFileSync(join(directory, '_static', name), 'utf8')).toBe('Changed native widget')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it.each(['search.html', 'search/index.html'])('routes native %s to scoped search with the query intact', async (name) => {
    const directory = mkdtempSync(join(tmpdir(), 'native-search-'))
    try {
      mkdirSync(join(directory, 'search'), { recursive: true })
      const page = join(directory, name)
      writeFileSync(page, '<html><head><title>Search</title></head><body><script>window.location.replace("/search/")</script></body></html>')
      await normalizeNativeShell(directory, '/pr-42/en', { sphinxPort: 'py', version: 'v0.62.0' })
      const html = readFileSync(page, 'utf8')
      const target = '/pr-42/en/py/v0.62.0/search/'
      expect(html).toContain(`<meta http-equiv="refresh" content="0; url=${target}">`)
      expect(html).toContain(`<a href="${target}">Search the Python documentation</a>`)
      expect(html).not.toContain('data-pagefind-body')
      let destination = ''
      runInNewContext(html.match(/<script>(.*?)<\/script>/)![1]!, {
        window: { location: { search: '?q=Server%20panes', hash: '#results', replace: (href: string) => { destination = href } } },
      })
      expect(destination).toBe(`${target}?q=Server%20panes#results`)
      expect(await normalizeNativeShell(directory, '/pr-42/en', { sphinxPort: 'py', version: 'v0.62.0' })).toBe(0)
      writeFileSync(join(directory, 'index.html'), '<html><head></head><body>Missing article</body></html>')
      await expect(normalizeNativeShell(directory, '/pr-42/en', { sphinxPort: 'py' })).rejects.toThrow('no compiled context')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it.each([false, true])('splices compiled regions and handles legacy tabs references (asset present: %s)', async (tabsPresent) => {
    const directory = mkdtempSync(join(tmpdir(), 'native-sphinx-'))
    try {
      const native = join(directory, 'native')
      const shell = join(directory, 'shell')
      mkdirSync(join(native, 'api/pane'), { recursive: true })
      mkdirSync(join(native, '_static'), { recursive: true })
      mkdirSync(join(native, '_static/js'), { recursive: true })
      writeFileSync(join(native, '_static/js/layout.js'), readFileSync(new URL('./fixtures/native-layout.js', import.meta.url)))
      if (tabsPresent) writeFileSync(join(native, '_static/tabs.js'), '/* retained tabs extension */')
      mkdirSync(join(shell, 'api/api/pane'), { recursive: true })
      const page = join(native, 'api/pane/index.html')
      const article = '<h2 id="capture">Pane &amp; capture</h2>\n<pre>  $ printf &quot;ok&quot;\n</pre><a href="#capture">Capture</a>'
      const tabs = '<script src="../../_static/tabs.js?v=legacy"></script>'
      const otherScripts = '<script src="../../_static/js/layout.js?v=old"></script><script src="../../_static/design-tabs.js"></script><script src="https://other.example/_static/tabs.js"></script><script src="../../_static/missing.js"></script>'
      const baseline = `<html class="no-js"><head><title>Native title</title><link rel="canonical" href="https://native.example/pane/"><link href="../../_static/theme.css" rel="stylesheet"><link href="../../_static/libtmux-org.css?v=old" rel="stylesheet"><script src="/_shell/shell.js"></script>${tabs}${otherScripts}</head><body><header class="mobile-header">Old</header><aside class="sidebar-drawer">Old navigation</aside><article role="main">${article}</article><footer><a href="../session/">Next</a><p>Native attribution</p><div class="page-source"><code>docs/pane.md</code></div></footer></body></html>`
      writeFileSync(page, baseline)
      const context = {
        schema: 1, port: 'py', version: 'v0.62.0', root: '/pr-42/en/', base: '/pr-42/en/py/v0.62.0/api/',
        pages: [{ file: 'api/pane/index.html', htmlSha256: nativeHash(baseline), articleSha256: nativeHash(article) }],
      }
      const contextFile = join(directory, 'context.json')
      writeFileSync(contextFile, JSON.stringify(context))
      const envelope = `<html data-native-shell-export><head data-native-shell-assets><link rel="stylesheet" href="/pr-42/en/py/v0.62.0/_astro/shell.css"><script type="module" src="/pr-42/en/py/v0.62.0/_astro/shell.js"></script></head><body><template data-native-boundary="header-start"></template><header class="site-header">Shared header</header><template data-native-boundary="header-end"></template><template data-native-boundary="sidebar-start"></template><div class="api-nav-column">Selectable sidebar $&amp; $$</div><template data-native-boundary="sidebar-end"></template><template data-native-boundary="footer-start"></template><footer class="shared-footer">Shared footer</footer><template data-native-boundary="footer-end"></template></body></html>`
      writeFileSync(join(shell, 'api/api/pane/index.html'), envelope)
      writeFileSync(join(shell, 'api/tree.json'), '{"port":"py","buckets":[],"members":{}}')
      const options = { sphinxPort: 'py', version: 'v0.62.0', contextFile, shellDirectory: shell }
      await normalizeNativeShell(native, '/pr-42/en', options)
      const html = readFileSync(page, 'utf8')
      expect(nativeArticle(html)).toBe(article)
      expect(html).toContain('<div class="api-nav-column">Selectable sidebar $&amp; $$</div>')
      expect(html).not.toContain('class="sidebar-drawer"')
      expect(readFileSync(join(native, 'tree.json'), 'utf8')).toBe('{"port":"py","buckets":[],"members":{}}')
      expect(html).toContain('<title>Native title</title><link rel="canonical" href="https://native.example/pane/">')
      expect(html).toContain('href="/pr-42/en/py/v0.62.0/api/_static/theme.css"')
      expect(html.includes('src="/pr-42/en/py/v0.62.0/api/_static/tabs.js?v=legacy"')).toBe(tabsPresent)
      expect(html).toContain('src="/pr-42/en/py/v0.62.0/api/_static/design-tabs.js"')
      const layoutDigest = nativeHash(readFileSync(join(native, '_static/js/layout.js'))).slice(0, 12)
      expect(html).toContain(`src="/pr-42/en/py/v0.62.0/api/_astro/js/layout.${layoutDigest}.js"`)
      expect(html).toContain('src="https://other.example/_static/tabs.js"')
      expect(html).toContain('src="/pr-42/en/py/v0.62.0/api/_static/missing.js"')
      expect(html).toContain('<a href="../session/">Next</a><p>Native attribution</p>')
      expect(html).toContain('data-pagefind-body data-pagefind-filter="port:Python"')
      expect(html).toContain('data-theme="python" data-brand="python"')
      expect(html).toContain('src="/pr-42/en/py/v0.62.0/_astro/shell.js"')
      expect(html).not.toContain('src="/pr-42/en/_shell/shell.js"')
      expect(html).not.toMatch(/libtmux-org|mobile-header|data-native-shell-export|data-native-boundary|docs\/pane.md/)
      expect(html.indexOf('class="site-header"')).toBeLessThan(html.indexOf('<article'))
      expect(html.indexOf('<!-- libtmux-native-head -->')).toBeLessThan(html.indexOf('_static/theme.css'))
      expect(await normalizeNativeShell(native, '/pr-42/en/', options)).toBe(0)
      expect(readFileSync(page, 'utf8')).toBe(html)

      writeFileSync(page, html.replace('Pane &amp; capture', 'Changed article'))
      await expect(normalizeNativeShell(native, '/pr-42/en', options)).rejects.toThrow('article changed')
      writeFileSync(page, baseline)
      writeFileSync(join(shell, 'api/api/pane/index.html'), envelope.replace('footer-end', 'missing'))
      await expect(normalizeNativeShell(native, '/pr-42/en', options)).rejects.toThrow('one footer region')
      await expect(normalizeNativeShell(native, '/en', options)).rejects.toThrow('assembly identity')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('normalizes nested HTML/CSS for previews without changing other URLs', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'native-shell-'))
    try {
      mkdirSync(join(directory, '_static'))
      writeFileSync(join(directory, 'index.html'), '<script src="/_shell/shell.js"></script><a href="/unchanged/">Guide</a>')
      writeFileSync(join(directory, '_static/theme.css'), "@import url('https://libtmux.org/_shell/tokens.css'); .logo{background:url(https://other.example/_shell/logo.svg)}")
      await normalizeNativeShell(directory, '/pr-42/en/')
      await normalizeNativeShell(directory, '/pr-42/en')
      expect(readFileSync(join(directory, 'index.html'), 'utf8')).toBe('<script src="/pr-42/en/_shell/shell.js"></script><a href="/unchanged/">Guide</a>')
      expect(readFileSync(join(directory, '_static/theme.css'), 'utf8')).toBe("@import url('/pr-42/en/_shell/tokens.css'); .logo{background:url(https://other.example/_shell/logo.svg)}")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

it('normalizes native HTML and CSS before hashing and preserves those bytes when publishing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'native-publish-'))
  try {
    mkdirSync(join(directory, 'dist'))
    const html = join(directory, 'dist/index.html')
    const css = join(directory, 'dist/theme.css')
    writeFileSync(html, '<script src="/_shell/shell.js"></script>')
    writeFileSync(css, "@import url('https://libtmux.org/_shell/tokens.css');")
    const sourceSha = 'a'.repeat(40), docsSha = 'b'.repeat(40)
    recordBuild(join(directory, 'dist'), {
      schema: 1, port: 'go', version: 'latest', locale: 'en',
      docs: { repository: 'libtmux/docs', sha: docsSha, dirty: false },
      sources: [{ product: 'core', repository: 'libtmux/libtmux-go', sha: sourceSha, dirty: false }],
    })
    expect(readFileSync(html, 'utf8')).toContain('<script src="/en/_shell/shell.js"></script>')
    expect(readFileSync(css, 'utf8')).toBe("@import url('/en/_shell/tokens.css');")
    const before = [readFileSync(html, 'utf8'), readFileSync(css, 'utf8')]
    verifyBuild(join(directory, 'dist'), {
      port: 'go', version: 'latest', locale: 'en', prefix: 'en/go/latest',
      publisherRepository: 'libtmux/docs', publisherSha: docsSha, repository: 'libtmux/libtmux-go', sourceSha,
    })
    expect([readFileSync(html, 'utf8'), readFileSync(css, 'utf8')]).toEqual(before)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
