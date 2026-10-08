import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { normalizeNativeShell } from '../../scripts/normalize-native-shell.mjs'
import { nativeArticle, nativeHash } from '../../scripts/native-shell-context.mjs'
import { recordBuild, verifyBuild } from '../../scripts/publication-provenance.mjs'

describe('native shell URL normalization', () => {
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

  it('splices compiled regions without rewriting native content, links, metadata or credits', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'native-sphinx-'))
    try {
      const native = join(directory, 'native')
      const shell = join(directory, 'shell')
      mkdirSync(join(native, 'api/pane'), { recursive: true })
      mkdirSync(join(shell, 'api/api/pane'), { recursive: true })
      const page = join(native, 'api/pane/index.html')
      const article = '<h2 id="capture">Pane &amp; capture</h2>\n<pre>  $ printf &quot;ok&quot;\n</pre><a href="#capture">Capture</a>'
      const baseline = `<html class="no-js"><head><title>Native title</title><link rel="canonical" href="https://native.example/pane/"><link href="../../_static/theme.css" rel="stylesheet"><link href="../../_static/libtmux-org.css?v=old" rel="stylesheet"><script src="/_shell/shell.js"></script></head><body><header class="mobile-header">Old</header><article role="main">${article}</article><footer><a href="../session/">Next</a><p>Native attribution</p><div class="page-source"><code>docs/pane.md</code></div></footer></body></html>`
      writeFileSync(page, baseline)
      const context = {
        schema: 1, port: 'py', version: 'v0.62.0', root: '/pr-42/en/', base: '/pr-42/en/py/v0.62.0/api/',
        pages: [{ file: 'api/pane/index.html', htmlSha256: nativeHash(baseline), articleSha256: nativeHash(article) }],
      }
      const contextFile = join(directory, 'context.json')
      writeFileSync(contextFile, JSON.stringify(context))
      const envelope = `<html data-native-shell-export><head data-native-shell-assets><link rel="stylesheet" href="/pr-42/en/py/v0.62.0/_astro/shell.css"><script type="module" src="/pr-42/en/py/v0.62.0/_astro/shell.js"></script></head><body><template data-native-boundary="header-start"></template><header class="site-header">Shared header</header><template data-native-boundary="header-end"></template><template data-native-boundary="footer-start"></template><footer class="shared-footer">Shared footer</footer><template data-native-boundary="footer-end"></template></body></html>`
      writeFileSync(join(shell, 'api/api/pane/index.html'), envelope)
      const options = { sphinxPort: 'py', version: 'v0.62.0', contextFile, shellDirectory: shell }
      await normalizeNativeShell(native, '/pr-42/en', options)
      const html = readFileSync(page, 'utf8')
      expect(nativeArticle(html)).toBe(article)
      expect(html).toContain('<title>Native title</title><link rel="canonical" href="https://native.example/pane/">')
      expect(html).toContain('href="../../_static/theme.css"')
      expect(html).toContain('<a href="../session/">Next</a><p>Native attribution</p>')
      expect(html).toContain('data-pagefind-body data-pagefind-filter="port:Python"')
      expect(html).toContain('data-theme="python" data-brand="python"')
      expect(html).toContain('src="/pr-42/en/py/v0.62.0/_astro/shell.js"')
      expect(html).not.toContain('src="/pr-42/en/_shell/shell.js"')
      expect(html).not.toMatch(/libtmux-org|mobile-header|data-native-shell-export|data-native-boundary|docs\/pane.md/)
      expect(html.indexOf('class="site-header"')).toBeLessThan(html.indexOf('<article'))
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
