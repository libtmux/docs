import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeNativeShell } from '../../scripts/normalize-native-shell.mjs'

describe('native shell URL normalization', () => {
  it('adds the Sphinx shell to old sources and preserves nested links and redirects', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'native-sphinx-'))
    try {
      mkdirSync(join(directory, 'api/pane'), { recursive: true })
      const page = join(directory, 'api/pane/index.html')
      writeFileSync(page, '<html><head><link rel="stylesheet" href="../../_static/theme.css"></head><body><article><a href="#capture">Capture</a><h2 id="capture">Pane</h2></article></body></html>')
      const redirect = '<html><head><meta http-equiv="refresh" content="0;url=/search/"></head></html>'
      writeFileSync(join(directory, 'index.html'), redirect)
      await normalizeNativeShell(directory, '/pr-42/en', { sphinxPort: 'py', version: 'v0.62.0' })
      const html = readFileSync(page, 'utf8')
      expect(html).toContain('href="../../_static/libtmux-org.css"')
      expect(html).toContain('data-pagefind-body data-pagefind-filter="port:Python"')
      expect(html).toContain('<script defer src="/pr-42/en/_shell/shell.js"></script>')
      expect(html).toContain('href="../../_static/theme.css"')
      expect(html).toContain('<a href="#capture">Capture</a>')
      expect(html.indexOf('id="lt-shell-style"')).toBeLessThan(html.indexOf('</head>'))
      expect(html.indexOf('data-lt-shell="header"')).toBeLessThan(html.indexOf('<article'))
      expect(html).toContain('data-current="v0.62.0"')
      expect(html).toContain('href="/pr-42/en/py/v0.62.0/api/api/pane/"')
      expect(html.match(/data-lt-shell="header"/g)).toHaveLength(1)
      expect(html.match(/data-lt-shell="footer"/g)).toHaveLength(1)
      expect(readFileSync(join(directory, '_static/libtmux-org.css'), 'utf8')).toContain("url('/pr-42/en/_shell/tokens.css')")
      expect(readFileSync(join(directory, 'index.html'), 'utf8')).toBe(redirect)
      expect(await normalizeNativeShell(directory, '/pr-42/en/', { sphinxPort: 'py', version: 'v0.62.0' })).toBe(0)
      expect(readFileSync(page, 'utf8')).toBe(html)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('replaces source-owned integration without duplicate scripts or styles', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'native-sphinx-'))
    try {
      const page = join(directory, 'index.html')
      writeFileSync(page, '<html><head><link href="_static/libtmux-org.css?v=old" rel="stylesheet"><script src="/_shell/shell.js" defer="defer"></script></head><body><article>Reference</article></body></html>')
      await normalizeNativeShell(directory, '/en', { sphinxPort: 'py' })
      const html = readFileSync(page, 'utf8')
      expect(html.match(/shell\.js/g)).toHaveLength(1)
      expect(html.match(/libtmux-org\.css/g)).toHaveLength(1)
      expect(html).not.toContain('?v=old')
      writeFileSync(page, '<html><body>Truncated source</body></html>')
      await expect(normalizeNativeShell(directory, '/en', { sphinxPort: 'py' })).rejects.toThrow('no closing head')
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

it('normalizes a native artifact in the reusable publisher without a docs checkout', async () => {
  const { execFileSync } = await import('node:child_process')
  const workflow = readFileSync(new URL('../../.github/workflows/reusable-deploy.yml', import.meta.url), 'utf8')
  const inline = /python3 - <<'PY'\n([\s\S]*?)\n\s+PY/.exec(workflow)?.[1]
  expect(inline, 'publisher includes native URL normalization').toBeTruthy()
  const lines = inline!.split('\n')
  const indent = Math.min(...lines.filter((line) => line.trim()).map((line) => /^ */.exec(line)![0].length))
  const script = lines.map((line) => line.slice(indent)).join('\n')
  const directory = mkdtempSync(join(tmpdir(), 'native-publish-'))
  try {
    mkdirSync(join(directory, 'dist'))
    const html = join(directory, 'dist/index.html')
    const css = join(directory, 'dist/theme.css')
    writeFileSync(html, '<script src="/_shell/shell.js"></script>')
    writeFileSync(css, "@import url('https://libtmux.org/_shell/tokens.css');")
    execFileSync('python3', ['-'], { input: script, cwd: directory, env: { ...process.env, PREFIX: 'en/py/latest' } })
    expect(readFileSync(html, 'utf8')).toBe('<script src="/en/_shell/shell.js"></script>')
    expect(readFileSync(css, 'utf8')).toBe("@import url('/en/_shell/tokens.css');")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
