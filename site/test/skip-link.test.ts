import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { beforeAll, describe, expect, it } from 'vitest'
import { installSkipLink } from '../src/lib/skip-link'
import { loadHeaderTemplates, parseHtml, renderPage, type HeaderTemplates } from './header-page'

/** Record 0077: the first tab stop on every page is "Skip to content", and following it moves focus into `main#content`. */
let templates: HeaderTemplates
beforeAll(async () => {
  templates = await loadHeaderTemplates()
})

const FOCUSABLE = 'a[href], button, summary, input, select, textarea, [tabindex]:not([tabindex="-1"])'

describe('the skip link', () => {
  it('is the first focusable element of a rendered page, ahead of the header, and names main#content', async () => {
    const html = await renderPage(templates.baseLayout, '/en/go/latest/', { pagePath: '', portSlug: 'go' })
    const { document } = parseHtml(html)
    const first = document.body.querySelector(FOCUSABLE)!
    expect(first.className).toBe('skip-link')
    expect(first.textContent!.trim()).toBe('Skip to content')
    expect(first.getAttribute('href')).toBe('#content')
    expect(first.compareDocumentPosition(document.querySelector('header')!) & 4, 'it precedes the header').toBeTruthy()
  })

  it('gives every main of a shell page the id and tab index the link needs', () => {
    const root = fileURLToPath(new URL('../src', import.meta.url))
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? walk(path) : path.endsWith('.astro') ? [path] : []
    })
    const mains = walk(root).flatMap((file) => [...readFileSync(file, 'utf8').replace(/\{\/\*[\s\S]*?\*\/\}|<!--[\s\S]*?-->/g, '').matchAll(/<main\b[^>]*>/g)].map((match) => ({ file, tag: match[0] })))
    expect(mains.length).toBeGreaterThan(10)
    // The sidebar demo's preview is an embedded frame with its own target.
    const bare = mains.filter(({ tag, file }) => !(tag.includes('id="content"') && tag.includes('tabindex="-1"')) && !file.includes('demo/sidebar/preview'))
    expect(bare.map(({ file }) => file)).toEqual([])
  })

  it('gives every BaseLayout page a main, its own or one a component draws', () => {
    const root = fileURLToPath(new URL('../src', import.meta.url))
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? walk(path) : path.endsWith('.astro') ? [path] : []
    })
    const files = walk(root).map((file) => ({ file, text: readFileSync(file, 'utf8').replace(/\{\/\*[\s\S]*?\*\/\}|<!--[\s\S]*?-->/g, '') }))
    const drawsMain = (text: string) => /<main\b/.test(text)
    const providers = files.filter(({ file, text }) => drawsMain(text) && !file.includes('/pages/')).map(({ file }) => file.split('/').pop()!.replace(/\.astro$/, ''))
    const pages = files.filter(({ text }) => /<BaseLayout\b/.test(text))
    expect(pages.length).toBeGreaterThan(5)
    const bare = pages.filter(({ text }) => !drawsMain(text) && !providers.some((name) => new RegExp(`<${name}\\b`).test(text)))
    expect(bare.map(({ file }) => file.slice(root.length + 1))).toEqual([])
  })

  describe('followed', () => {
    const mount = (body: string) => {
      const win = new Window({ url: 'https://libtmux.org/en/go/latest/' })
      win.document.body.innerHTML = body
      installSkipLink(win.document as unknown as Document)
      return win
    }
    const follow = (win: Window) => {
      const link = win.document.querySelector('a.skip-link')!
      link.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }))
    }

    it('moves focus into main, which can take it without joining the tab order', () => {
      const win = mount('<a class="skip-link" href="#content">Skip to content</a><header><a href="/">libtmux</a></header><main id="content" tabindex="-1"><a href="#x">in page</a></main>')
      follow(win)
      expect(win.document.activeElement?.id).toBe('content')
    })

    it('follows a native page\'s article, which keeps its own id', () => {
      const win = mount('<a class="skip-link" href="#content">Skip to content</a><article role="main" id="furo-main-content"><h1>Page</h1></article>')
      const link = win.document.querySelector('a.skip-link')!
      expect(link.getAttribute('href')).toBe('#furo-main-content')
      follow(win)
      expect(win.document.activeElement?.id).toBe('furo-main-content')
    })

    it('has a control: a page with no link to follow moves nothing', () => {
      const win = mount('<main id="content" tabindex="-1"><a href="#x">in page</a></main>')
      win.document.querySelector('a')!.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }))
      expect(win.document.activeElement?.id).not.toBe('content')
    })
  })
})
