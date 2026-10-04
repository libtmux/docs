import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { pageBrand, PORTS } from '../src/lib/ports'
import { branding, documentationTitle, jsonLd, palettes, tmuxDocumentationTitle } from '../src/lib/branding'
import { nativeBrandHead } from '../../scripts/brand-native-pages.mjs'

const publicFile = (path: string) => fileURLToPath(new URL(`../public${path}`, import.meta.url))
const luminance = (hex: string) => {
  const c = [1, 3, 5].map((n) => Number.parseInt(hex.slice(n, n + 2), 16) / 255)
    .map((x) => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
  return c[0]! * .2126 + c[1]! * .7152 + c[2]! * .0722
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + .05) / (lo! + .05)
}

describe('route branding', () => {
  it('identifies tmux pages by their section and hosting site', () => {
    expect(tmuxDocumentationTitle('Getting started', 'tmux/guides/getting-started')).toBe('Getting started | Guides | tmux | libtmux.org')
    expect(tmuxDocumentationTitle('Guides', 'tmux/guides')).toBe('Guides | tmux | libtmux.org')
    expect(tmuxDocumentationTitle('capture-pane', 'tmux/3.7c/manual/capture-pane')).toBe('capture-pane | Manual | tmux | libtmux.org')
    expect(tmuxDocumentationTitle('Just tmux', 'tmux')).toBe('tmux | libtmux.org')
  })
  it('uses project titles independently of package names and shared source repositories', () => {
    const names = {
      py: 'libtmux', ruby: 'libtmux-ruby', lua: 'libtmux-lua', ts: 'libtmux-ts',
      rs: 'libtmux-rs', go: 'libtmux-go', java: 'libtmux-java', kotlin: 'libtmux-kotlin',
      scala: 'libtmux-scala', dotnet: 'libtmux-dotnet', fsharp: 'libtmux-fsharp',
      cxx: 'libtmux-cxx', swift: 'libtmux-swift',
    }
    expect(Object.fromEntries(PORTS.map((port) => [port.slug, branding(port.slug).projectName]))).toEqual(names)
    expect(branding('java', 'reference/libtmux-scala-cats').projectName).toBe('libtmux-scala')
    expect(branding('dotnet', 'reference/LibTmux.FSharp').projectName).toBe('libtmux-fsharp')
    expect(branding().projectName).toBe('libtmux')
    expect(documentationTitle('Server', 'libtmux-scala')).toBe('Server | libtmux-scala')
    expect(documentationTitle('Server | libtmux', 'libtmux-dotnet')).toBe('Server | libtmux-dotnet')
    expect(documentationTitle('Server | libtmux-dotnet', 'libtmux-dotnet')).toBe('Server | libtmux-dotnet')
    expect(documentationTitle('libtmux', 'libtmux')).toBe('libtmux')
    expect(documentationTitle('libtmux-scala', 'libtmux-scala')).toBe('libtmux-scala')
  })
  it('publishes the size and digest of every catalogued asset', () => {
    const catalog = JSON.parse(readFileSync(publicFile('/brand/catalog.json'), 'utf8')) as {
      fileCount: number
      assets: { files: { file: string; bytes: number; sha256: string }[] }[]
    }
    const files = catalog.assets.flatMap((asset) => asset.files)
    expect(files.length).toBeGreaterThan(0)
    expect(files).toHaveLength(catalog.fileCount)
    for (const file of files) {
      const bytes = readFileSync(publicFile(`/brand/${file.file}`))
      expect(bytes.length, file.file).toBe(file.bytes)
      expect(createHash('sha256').update(bytes).digest('hex'), file.file).toBe(file.sha256)
    }
  })
  it('defaults the shared site to the Python cog and follows reference languages', () => {
    expect(pageBrand()).toEqual({ language: 'python', variant: 'library' })
    expect(pageBrand(undefined, 'reference/ts/Server')).toEqual({ language: 'typescript', variant: 'library' })
    expect(pageBrand('java', 'reference/libtmux-scala-cats')).toEqual({ language: 'scala', variant: 'library' })
    expect(pageBrand('java', 'reference/libtmux-kotlin')).toEqual({ language: 'kotlin', variant: 'library' })
    expect(pageBrand('dotnet', 'reference/LibTmux.FSharp')).toEqual({ language: 'fsharp', variant: 'library' })
  })
  it('uses product overlays without changing unrelated library pages', () => {
    expect(pageBrand('ts', 'mcp/tools/')).toEqual({ language: 'typescript', variant: 'mcp' })
    expect(pageBrand('go', 'workspace/reference/')).toEqual({ language: 'go', variant: 'workspace' })
    expect(pageBrand('ruby', 'topics/sessions/').variant).toBe('library')
    expect(pageBrand(undefined, 'mcp/').variant).toBe('mcp')
  })
  it('keeps preview and locale prefixes on all artwork URLs', () => {
    expect(branding('rs', 'workspace/', '/pr-42/ja/').asset('logo.svg'))
      .toBe('/pr-42/ja/brand/rust/workspace/logo.svg')
  })
  it('ships raster and vector fallbacks for every port and product', () => {
    for (const port of PORTS) for (const product of ['', 'mcp/', 'workspace/']) {
      const brand = branding(port.slug, product)
      for (const file of ['logo.svg', 'favicon.ico', 'logo-32.png', 'logo-512.png', 'apple-touch-icon-light.png', 'opengraph-light.png', 'twitter-light.png', 'site.webmanifest']) {
        expect(existsSync(publicFile(brand.asset(file))), brand.asset(file)).toBe(true)
      }
      const png = readFileSync(publicFile(brand.asset('opengraph-light.png')))
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630])
      const manifest = JSON.parse(readFileSync(publicFile(brand.asset('site.webmanifest')), 'utf8'))
      for (const icon of manifest.icons) {
        expect(existsSync(publicFile(brand.asset(icon.src))), icon.src).toBe(true)
      }
    }
  })
  it('keeps text and links readable on light and dark surfaces', () => {
    for (const [language, palette] of Object.entries(palettes)) for (const mode of ['light', 'dark'] as const) {
      expect(palette[mode].onSolid).toBe('#ffffff')
      expect(contrast(palette[mode].solid, palette[mode].onSolid), `${language} ${mode} filled surface`).toBeGreaterThanOrEqual(4.5)
      for (const foreground of ['text', 'muted', 'link'] as const) for (const background of ['background', 'surface', 'hover'] as const) {
        expect(contrast(palette[mode][foreground], palette[mode][background]), `${language} ${mode} ${foreground}/${background}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
  it.each(['light', 'dark'] as const)('keeps %s surfaces and body text neutral across languages', (mode) => {
    for (const role of ['background', 'surface', 'hover', 'border', 'text', 'muted'] as const) {
      const colors = new Set(Object.values(palettes).map((palette) => palette[mode][role]))
      expect(colors.size, role).toBe(1)
      const [red, green, blue] = [1, 3, 5].map((i) => Number.parseInt([...colors][0]!.slice(i, i + 2), 16))
      expect(red).toBeLessThanOrEqual(green!)
      expect(green).toBeLessThanOrEqual(blue!)
    }
    expect(new Set(Object.values(palettes).map((palette) => palette[mode].link)).size).toBeGreaterThan(1)
  })
  it('escapes script delimiters while preserving JSON-LD values', () => {
    const value = { headline: '</script><script>alert(1)</script>' }
    const output = jsonLd(value)
    expect(output).not.toContain('<')
    expect(JSON.parse(output)).toEqual(value)
  })
})

describe('native metadata', () => {
  it('replaces the native Sphinx suffix with one project title', () => {
    const source = '<html><head><title>Servers - libtmux 0.62.0 documentation</title></head><body>Servers</body></html>'
    const options = { port: 'py', pagePath: 'api/libtmux.server/', root: '/en' }
    const html = nativeBrandHead(source, options)
    expect(html).toContain('<title>Servers | libtmux</title>')
    expect(html).toContain('<meta property="og:title" content="Servers | libtmux">')
    expect(html).toContain('<meta name="twitter:title" content="Servers | libtmux">')
    expect(nativeBrandHead(html, options)).toBe(html)
  })

  it.each(PORTS)('normalizes $slug page and social titles without changing canonical policy', (port) => {
    const source = '<html><head><title>Server &amp; &quot;Clients&quot; | libtmux</title><meta property="og:title" content="Old"><meta property="og:site_name" content="libtmux"><meta name="twitter:title" content="Old"><link rel="canonical" href="https://libtmux.org/unchanged/"><meta name="robots" content="noindex, follow"></head><body>Server</body></html>'
    const options = { port: port.slug, pagePath: 'reference/server/', root: '/en' }
    const html = nativeBrandHead(source, options)
    const title = `Server &amp; &quot;Clients&quot; | ${port.projectName}`
    expect(html).toContain(`<title>${title}</title>`)
    expect(html).toContain(`<meta property="og:title" content="${title}">`)
    expect(html).toContain(`<meta name="twitter:title" content="${title}">`)
    expect(html).toContain(`<meta property="og:site_name" content="${port.projectName}">`)
    expect(html.match(/<title>/g)).toHaveLength(1)
    expect(html.match(/property="og:title"/g)).toHaveLength(1)
    expect(html).toContain('href="https://libtmux.org/unchanged/"')
    expect(html).toContain('content="noindex, follow"')
    expect(html).toContain(`"name":"${port.projectName}"`)
    expect(nativeBrandHead(html, options)).toBe(html)
  })
  it('uses current artwork for both native sidebar schemes without changing content images', () => {
    const source = '<html><head></head><body><img class="sidebar-logo only-light" src="old-light.svg"><img src="old-dark.svg" class="only-dark sidebar-logo" srcset="old-dark@2x.png 2x"/><img src="guide.png" alt="Example"></body></html>'
    const options = { port: 'py', pagePath: 'api/server/', root: '/pr-42/en' }
    const html = nativeBrandHead(source, options)
    expect(html.match(/src="\/pr-42\/en\/brand\/python\/library\/logo.svg"/g)).toHaveLength(2)
    expect(html).not.toContain('old-')
    expect(html).toContain('<img src="guide.png" alt="Example">')
    expect(nativeBrandHead(html, options)).toBe(html)
  })
  it('replaces legacy image tags, preserves policy, and is idempotent', () => {
    const source = '<html lang="en"><head><title>Server</title><link rel="canonical" href="https://libtmux.org/en/py/stable/api/server/"><meta name="robots" content="noindex, follow"><link rel="icon" href="old.ico"><meta property="og:image" content="old.png"></head><body>Server API</body></html>'
    const options = { port: 'py', pagePath: 'api/server/', root: '/pr-42/en' }
    const html = nativeBrandHead(source, options)
    expect(html).toContain('data-brand="python"')
    expect(html).toContain('https://libtmux.org/pr-42/en/brand/python/library/opengraph-light.png')
    expect(html).toContain('<meta name="robots" content="noindex, follow">')
    expect(html).toContain('href="https://libtmux.org/en/py/stable/api/server/"')
    expect(html).not.toContain('old.png')
    expect(html).not.toContain('old.ico')
    expect(html).toContain('href="/pr-42/en/brand/python/library/site.webmanifest"')
    expect(html.match(/name="theme-color"/g)).toHaveLength(2)
    expect(html.match(/property="og:image"/g)).toHaveLength(1)
    expect(nativeBrandHead(html, options)).toBe(html)
  })
  it('leaves redirect stubs alone', () => {
    const html = '<html><head><meta http-equiv="refresh" content="0;url=/reference/"></head></html>'
    expect(nativeBrandHead(html, { port: 'py', pagePath: '', root: '/en' })).toBe(html)
  })
})
