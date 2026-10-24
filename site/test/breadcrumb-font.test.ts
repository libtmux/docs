import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window, type Element } from 'happy-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { loadAstroTemplate, renderAstroTemplate, withoutScope } from './astro-templates'

/**
 * The breadcrumb trail is set in the shell's sans-serif face wherever it appears: the root shell and every port outlet draw it
 * through one component, nothing in it or around it changes the family, and the native outlets name the same face as the shell.
 * A symbol crumb keeps its break points as plain text, not as a code face.
 */
const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const files = (directory: string, extension: string): string[] => readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => entry.isDirectory() ? files(join(directory, entry.name), extension) : entry.name.endsWith(extension) ? [join(directory, entry.name)] : [])

const windows: Window[] = []
afterEach(async () => { for (const win of windows.splice(0)) await win.happyDOM.abort() })

async function trail() {
  const template = await loadAstroTemplate('components/PageToolbar.astro', { real: ['components/api/SymbolName.astro'] })
  const win = new Window({ url: 'https://libtmux.org/en/scala/latest/reference/' })
  windows.push(win)
  win.document.body.innerHTML = withoutScope(await renderAstroTemplate(template, { props: { breadcrumbs: [
    { name: 'Scala', url: '/en/scala/latest/' },
    { name: 'Queries' },
    { name: 'PaneFields', url: '/en/scala/latest/reference/panefields/', symbol: true },
    { name: 'LibTmux.Server#list_sessions', symbol: true },
  ] } }))
  return win.document
}

describe('the breadcrumb trail', () => {
  it('draws a linked, a group and a current symbol crumb as plain text in the inherited face', async () => {
    const document = await trail()
    const crumbs = [...document.querySelectorAll('nav[aria-label="Breadcrumb"] [data-breadcrumb-item]')]
    expect(crumbs.map((crumb) => [crumb.tagName, crumb.hasAttribute('href'), crumb.getAttribute('aria-current')])).toEqual([
      ['A', true, null], ['SPAN', false, null], ['A', true, null], ['SPAN', false, 'page'],
    ])
    // The symbol crumb breaks where a name breaks, and is otherwise text.
    expect(crumbs[3]!.innerHTML).toContain('<wbr>')
    expect(crumbs[3]!.innerHTML.replaceAll('<wbr>', '')).toBe('LibTmux.Server#list_sessions')
    expect([...crumbs[3]!.children].map((child) => child.tagName)).toEqual(Array(crumbs[3]!.children.length).fill('WBR'))
    for (const crumb of crumbs) {
      for (let node: Element | null = crumb; node && node.tagName !== 'BODY'; node = node.parentElement) {
        expect(node.tagName, `${crumb.textContent} sits in ${node.tagName}`).not.toMatch(/^(CODE|KBD|SAMP|PRE|TT)$/)
        expect(node.getAttribute('class') ?? '', crumb.textContent!).not.toMatch(/(^|\s)font-(?!sans\b)[^\s]*/)
        expect(node.hasAttribute('style'), crumb.textContent!).toBe(false)
      }
      expect(crumb.querySelector('code, kbd, samp, pre, tt'), crumb.textContent!).toBeNull()
    }
  })

  it('has one implementation, so the root shell and each port outlet draw the same trail', () => {
    // The badge demo sketches a trail of its own, which no reader's page reaches.
    const owners = files(SRC, '.astro').map((file) => relative(SRC, file)).filter((file) => !file.startsWith('pages/demo/'))
      .filter((file) => /aria-label=["']Breadcrumb["']/.test(readFileSync(join(SRC, file), 'utf8')))
    expect(owners).toEqual(['components/PageToolbar.astro'])
  })

  it('sets no font family on the trail or the toolbar that holds it, except the shell sans', () => {
    const styles = (file: string) => {
      const source = readFileSync(file, 'utf8')
      return file.endsWith('.astro') ? [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(([, css]) => css!).join('\n') : source
    }
    const sheets = [...files(SRC, '.css'), ...files(SRC, '.astro'), fileURLToPath(new URL('../public/_shell/external-links.css', import.meta.url))]
    const rules = sheets.flatMap((file) => [...styles(file).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map(([, selector, body]) => ({ file: relative(SRC, file), selector: selector!.trim().replace(/\s+/g, ' '), body: body! })))
    const toolbar = rules.filter(({ selector }) => /breadcrumb|page-toolbar|page-ports|page-control/i.test(selector))
    // The search finds the toolbar's own rules, so an empty answer means the trail is untouched and not that the search missed.
    expect(toolbar.map(({ selector }) => selector)).toContain('.page-toolbar-controls--reference select')
    for (const { file, selector, body } of toolbar) {
      // `font` sets the family too.
      for (const [, declaration] of body.matchAll(/(?:^|;)\s*(?:font-family|font)\s*:\s*([^;]+)/g)) expect(declaration!.trim(), `${file}: ${selector}`).toMatch(/var\(--font-sans\b/)
    }
  })

  it('names the same sans face in the shell and in the native outlets', () => {
    const shell = read('../src/styles/global.css').match(/@theme\s*\{[^}]*--font-sans:\s*([^;]+);/)?.[1]
    const native = read('../src/styles/native-sphinx.css').match(/html\[data-native-shell\]\s*\{[^}]*--font-sans:\s*([^;]+);/)?.[1]
    expect(shell).toBe('var(--font-ibm-plex-sans)')
    expect(native).toBe(shell)
    expect(read('../src/styles/global.css')).toMatch(/body\s*\{\s*@apply[^;]*font-\[var\(--font-sans\)\]/)
  })
})
