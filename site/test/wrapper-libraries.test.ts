import { afterEach, describe, expect, it, vi } from 'vitest'
import { PORTS, PORT_BY_SLUG, portSourceUrl, productAvailable } from '../src/lib/ports'
import { documentationAreas } from '../src/lib/port-documentation'
import { LANG_TO_PORT, remarkPortCode } from '../src/plugins/remark-port-code.mjs'
import { QUICKSTARTS } from '../src/lib/quickstarts'
import EXAMPLE_SOURCES from '../src/data/example-sources.json'
import { installsFor, registryFor } from '../src/lib/registry'
import { docsEntryAvailable } from '../src/lib/page-port-links'
import { SITE_BUILT, SITE_PREFIX, sitePath, publishedPath } from './site-root'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'

afterEach(() => vi.unstubAllEnvs())

describe('wrapper library identities', () => {
  const wrappers = [
    { slug: 'kotlin', parent: 'java', runtime: 'JVM', packageName: 'io.github.libtmux:libtmux-kotlin' },
    { slug: 'scala', parent: 'java', runtime: 'JVM', packageName: 'io.github.libtmux:libtmux-scala_3' },
    { slug: 'fsharp', parent: 'dotnet', runtime: '.NET', packageName: 'LibTmux.FSharp' },
  ]

  it('keeps wrappers beside their parent with distinct packages and artwork', () => {
    const slugs = PORTS.map((port) => port.slug)
    expect(slugs.slice(slugs.indexOf('java'), slugs.indexOf('java') + 3)).toEqual(['java', 'kotlin', 'scala'])
    expect(slugs.slice(slugs.indexOf('dotnet'), slugs.indexOf('dotnet') + 2)).toEqual(['dotnet', 'fsharp'])
    for (const { slug, parent, runtime, packageName } of wrappers) {
      const port = PORT_BY_SLUG[slug]
      expect(port, slug).toBeDefined()
      expect(port.parentLibrary).toEqual({ slug: parent, runtime })
      expect(port.packageName).toBe(packageName)
      expect(port.logoLanguage).toBe(slug)
      for (const key of ['repo', 'checkout', 'worktree', 'tagGrammar', 'tagPrefix'] as const) {
        expect(port[key], `${slug}.${key}`).toEqual(PORT_BY_SLUG[parent][key])
      }
      expect(LANG_TO_PORT[slug]).toBe(slug)
    }
  })

  it('exposes only the library for wrapper languages', () => {
    for (const { slug } of wrappers) {
      const port = PORT_BY_SLUG[slug]
      expect(port, slug).toBeDefined()
      expect(port.workspaceCli).toBeUndefined()
      expect(productAvailable(port, 'mcp')).toBe(false)
      expect(productAvailable(port, 'workspace')).toBe(false)
      expect(documentationAreas(slug).every((area) => !area.product)).toBe(true)
    }
  })

  it.each(['kotlin', 'scala'])('opens the %s source directory without changing its repository identity', (slug) => {
    const port = PORT_BY_SLUG[slug]
    const root = `https://github.com/libtmux/libtmux-java/tree/`
    const path = `/libtmux-${slug}`
    expect(port.repo).toBe('libtmux/libtmux-java')
    expect(portSourceUrl(port)).toBe(`${root}master${path}`)
    expect(portSourceUrl(port, 'v0.0.1-alpha.17')).toBe(`${root}v0.0.1-alpha.17${path}`)
    for (const version of ['latest', 'stable', 'next', 'pr-42', 'v0.0.1-alpha.17']) {
      expect(portSourceUrl(port, version, 'a'.repeat(40))).toBe(`${root}${'a'.repeat(40)}${path}`)
    }
    for (const version of ['stable', 'next', 'pr-42']) {
      expect(portSourceUrl(port, version)).toBe(`${root}master${path}`)
    }
    expect(portSourceUrl(port, 'latest', 'feature/source-links')).toBe(`${root}feature%2Fsource-links${path}`)
    expect(portSourceUrl(PORT_BY_SLUG.java, 'v0.0.1-alpha.17', 'a'.repeat(40))).toBe('https://github.com/libtmux/libtmux-java')
  })

  it('supplies native examples and registry versions in the library installer', () => {
    for (const { slug } of wrappers) {
      const port = PORT_BY_SLUG[slug]
      const version = registryFor(port).version
      expect(version, slug).toBeTruthy()
      const commands = installsFor(port)
      expect(commands.length).toBeGreaterThan(0)
      for (const command of commands) {
        expect(command.code, slug).toContain(version)
        expect(command.code).not.toContain('{version}')
      }
      const example = QUICKSTARTS[slug]
      expect(example?.lang).toBe(slug)
      expect(example?.code.length).toBeGreaterThan(100)
    }
  })

  it('keeps parent-language examples in wrapper-owned guides', () => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'fsharp')
    const sample = () => ({ type: 'root', children: [
      { type: 'code', lang: 'fsharp', value: 'open LibTmux.FSharp' },
      { type: 'code', lang: 'csharp', value: 'using LibTmux;' },
    ] })
    const owned = sample()
    remarkPortCode()(owned, { data: { astro: { frontmatter: { port: 'fsharp' } } } })
    expect(owned.children).toHaveLength(2)
    const shared = sample()
    remarkPortCode()(shared, {})
    expect(shared.children.map((node) => node.lang)).toEqual(['fsharp'])
  })

  it('limits translated wrapper prose to authored guides and shared concepts', () => {
    expect(docsEntryAvailable({ id: 'ja/concepts/model', data: {} }, 'fsharp')).toBe(true)
    expect(docsEntryAvailable({ id: 'ja/topics/control', data: {} }, 'fsharp')).toBe(false)
    expect(docsEntryAvailable({ id: 'guides', data: { port: 'scala', route: 'guides' } }, 'scala')).toBe(true)
  })
})

describe('quickstart display formatting', () => {
  const columns = (line: string) => [...line].reduce(
    (column, char) => column + (char === '\t' ? 8 - column % 8 : 1), 0,
  )
  // Keep quoted literals whole: ignoring all whitespace would also hide changed strings.
  const tokens = (code: string) => code.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_][A-Za-z0-9_']*|\d+(?:\.\d*)?|[^\s]/g)
  const luaSource = EXAMPLE_SOURCES['lua:examples/quickstart.lua'].content
    .split('-- docs:begin main\n')[1].split('-- docs:end main')[0]
  const fsharpSource = EXAMPLE_SOURCES['fsharp:examples/LibTmux.FSharp.Quickstart/Program.fs'].content
    .replace(/^\/\/ fsharp-snippet: Quickstart\n/, '').replace(/\n\/\/ endfsharp-snippet\n?$/, '')

  it.each(PORTS)('$slug fits 88 columns, including expanded tabs', ({ slug }) => {
    const code = QUICKSTARTS[slug]?.code
    expect(code, slug).toBeTruthy()
    for (const [index, line] of code!.split('\n').entries()) {
      expect(columns(line), `${slug}:${index + 1} ${line}`).toBeLessThanOrEqual(88)
    }
  })

  it.each([
    { slug: 'lua', source: luaSource },
    { slug: 'fsharp', source: fsharpSource },
  ])('$slug reflows its source without changing tokens or string contents', ({ slug, source }) => {
    expect(tokens(QUICKSTARTS[slug]!.code)).toEqual(tokens(source))
    expect(QUICKSTARTS[slug]!.source).toContain('Line breaks adjusted for display.')
  })

  it('counts tab stops and keeps whitespace inside quoted literals significant', () => {
    expect(columns('\t' + 'x'.repeat(81))).toBe(89)
    expect(columns('x\t' + 'y'.repeat(80))).toBe(88)
    expect(tokens('let value')).not.toEqual(tokens('letvalue'))
    expect(tokens('print(\n  "two words"\n)')).toEqual(tokens('print("two words")'))
    expect(tokens('print("two words")')).not.toEqual(tokens('print("twowords")'))
    expect(tokens('print("two words")')).not.toEqual(tokens('other("two words")'))
    expect(tokens('print("two words")')).not.toEqual(tokens('print("two words", 1)'))
  })
})

describe.skipIf(!SITE_BUILT)('published wrapper pages', () => {
  it.each(PORTS.filter((port) => port.parentLibrary))('$slug has complete library routes and metadata', async (port) => {
    const root = `${port.slug}/latest`
    const prefix = `/${SITE_PREFIX}${root}/`
    for (const product of ['mcp', 'workspace']) expect(existsSync(sitePath(root, product)), `${port.slug}/${product}`).toBe(false)
    for (const route of ['', 'guides', 'examples', 'reference']) {
      const window = new Window({
        url: `https://libtmux.org${prefix}${route}/`,
        settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
      })
      try {
        const document = window.document
        document.write(readFileSync(sitePath(root, route, 'index.html'), 'utf8'))
        expect(document.querySelectorAll('h1'), `${port.slug}/${route}`).toHaveLength(1)
        expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(`https://libtmux.org${prefix}${route ? `${route}/` : ''}`)
        expect(document.querySelector('meta[property="og:image"]')?.getAttribute('content')).toContain(`/brand/${port.logoLanguage}/library/`)
        expect(document.querySelector('link[rel="manifest"]')?.getAttribute('href')).toContain(`/brand/${port.logoLanguage}/library/`)
        for (const anchor of document.querySelectorAll('main a[href], nav[aria-label="Documentation"] a[href], nav[aria-label="Port documentation"] a[href]')) {
          const path = new URL(anchor.getAttribute('href')!, `https://libtmux.org${prefix}${route}/`).pathname
          if (!path.startsWith(prefix)) continue
          expect(path).not.toMatch(/\/(?:mcp|workspace)(?:\/|$)/)
          expect(existsSync(publishedPath(decodeURIComponent(path))) || existsSync(publishedPath(decodeURIComponent(path), 'index.html')), path).toBe(true)
        }
        if (!route) {
          const logo = document.querySelector('main img')
          expect(logo?.getAttribute('src')).toContain(`/brand/${port.logoLanguage}/library/logo.svg`)
          expect(logo?.getAttribute('width')).toBe('88')
          expect(document.querySelector('main')?.textContent).toContain(PORT_BY_SLUG[port.parentLibrary!.slug].name)
          expect(document.querySelector('.port-links a')?.getAttribute('href')).toBe(portSourceUrl(port))
          expect(document.querySelector('footer a[aria-label="GitHub"]')?.getAttribute('href')).toBe(`${portSourceUrl(port)}${port.source ? '' : '/'}`)
        }
      } finally { await window.happyDOM.close() }
    }
    const manifest = JSON.parse(readFileSync(sitePath(root, 'docs.json'), 'utf8'))
    const identity = manifest.ports.find((entry: { slug: string }) => entry.slug === port.slug)
    expect(identity.parentLibrary).toEqual(port.parentLibrary)
    expect(identity.products).toEqual([])
    expect(manifest.sourceRepository).toBe(`https://github.com/${port.repo}`)
    for (const page of manifest.pages) {
      const path = new URL(page.url).pathname
      if (path.startsWith(prefix)) expect(existsSync(join(publishedPath(path), 'index.html')), page.url).toBe(true)
    }
  })
})
