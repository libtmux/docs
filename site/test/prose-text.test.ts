import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { labelParts, memberReference } from '../src/lib/api-labels'
import { loadAstroTemplate, renderAstroTemplate, withoutScope } from './astro-templates'

const apiCss = readFileSync(new URL('../src/styles/api.css', import.meta.url), 'utf8')
const windows: Window[] = []
afterEach(async () => { for (const win of windows.splice(0)) await win.happyDOM.abort() })

/** The mention decision for each span: the resolver itself is not under test, so a JDK member and a plain symbol link to fixed targets. */
const TARGETS: Record<string, string> = {
  'java.lang.AutoCloseable#close': 'https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/AutoCloseable.html#close()',
  'java.lang.AutoCloseable': 'https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/AutoCloseable.html',
  Server: '/reference/server/',
  'C#': '/reference/c-sharp/',
}
const decideMention = (text: string) => TARGETS[text]
  ? { kind: 'link', port: 'java', href: TARGETS[text], title: `${text}: Java`, external: text.startsWith('java.') }
  : { kind: 'skip', why: 'not a mention' }

async function render(text: string, linkColour = '#6f1a24') {
  const { decideMention: _real, ...api } = await import('@libtmux/api-model')
  const template = await loadAstroTemplate('components/ProseText.astro', { modules: { '@libtmux/api-model': { ...api, decideMention } } })
  const win = new Window({ url: 'https://libtmux.org/en/' })
  windows.push(win)
  win.document.head.innerHTML = `<style>:root { --color-link: ${linkColour}; --color-foreground-primary: #202830; --color-background-border: #d6dce3; }${apiCss}</style>`
  win.document.body.innerHTML = withoutScope(await renderAstroTemplate(template, { props: { text, port: 'java' } }))
  return win
}

describe('a member reference in a sentence', () => {
  it('reads a member reference as ApiDoc does, so a hash is marked the same way in both', () => {
    const doc = readFileSync(new URL('../src/components/api/ApiDoc.astro', import.meta.url), 'utf8')
    expect(doc).toContain(`const memberReference = ${memberReference.toString()}`)
    expect(labelParts('java.lang.AutoCloseable#close', true)).toEqual(['java.lang.AutoCloseable', '#', 'close'])
    expect(labelParts('C#', false)).toEqual(['C#'])
  })

  it('marks the hash of a linked Owner#member, keeping its text and its link', async () => {
    const win = await render('Call `java.lang.AutoCloseable#close` first.')
    const link = win.document.querySelector('a.api-mention')!
    const code = link.querySelector('code.api-literal--link')!
    expect(code.textContent).toBe('java.lang.AutoCloseable#close')
    expect(link.getAttribute('href')).toBe(TARGETS['java.lang.AutoCloseable#close'])
    expect([...code.querySelectorAll('.api-reference-separator')].map((node) => node.textContent)).toEqual(['#'])
    expect(win.document.body.textContent!.replace(/\s+/g, ' ').trim()).toBe('Call java.lang.AutoCloseable#close first.')
  })

  it('draws the hash in the port palette, so it follows the link colour of the port it is on', async () => {
    const colours: string[] = []
    for (const link of ['#6f1a24', '#1e415e']) {
      const win = await render('`java.lang.AutoCloseable#close`', link)
      colours.push(win.getComputedStyle(win.document.querySelector('.api-reference-separator')!).color)
    }
    expect(colours).toEqual(['#6f1a24', '#1e415e'])
  })

  it('leaves other hashes, unlinked code and a plain symbol alone', async () => {
    const win = await render('`Server` `java.lang.AutoCloseable` `C#` `# comment` `#{pane_id}` `Owner#unlinked`')
    expect(win.document.querySelectorAll('.api-reference-separator')).toHaveLength(0)
    // A linked name that merely ends in a hash is not a member reference.
    expect([...win.document.querySelectorAll('a.api-mention code')].map((node) => node.textContent)).toEqual(['Server', 'java.lang.AutoCloseable', 'C#'])
    expect(win.document.body.textContent).toContain('# comment #{pane_id} Owner#unlinked')
  })
})
