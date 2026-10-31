import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { crossHighlight } from '../src/lib/cross-highlight'

/**
 * Pointing at a name lights every other link to the same page. The module is what the reference pages run, so these
 * drive it in happy-dom against the four kinds of link it watches, and read the components for where it is loaded.
 */
const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const css = source('styles/api.css')

const PANE = '/en/ts/latest/reference/pane-pane/'
const page = `<main>
  <p>Call <a id="prose" class="api-xref api-mention api-doc-link" href="${PANE}kill/"><code>Pane.kill()</code></a> or <a id="other" class="api-xref api-mention api-doc-link" href="${PANE}id/"><code>Pane.id</code></a>.</p>
  <dl class="api-directory"><dd><a id="chip" class="api-xref api-mention api-mention--chip api-doc-link" href="${PANE}kill/"><code>kill()</code></a></dd></dl>
  <ul><li><a id="member" class="api-member-link" href="${PANE}kill/">kill</a> <a id="id-member" class="api-member-link" href="${PANE}id/">id</a></li></ul>
  <p id="words">Words, and <a id="plain" href="${PANE}kill/">a plain link</a>, <a id="markdown" class="api-mention" href="${PANE}kill/">a Markdown mention</a> and
    <a id="abroad" class="api-doc-link" href="https://elsewhere.test${PANE}kill/">the same path elsewhere</a>.</p>
</main>
<nav class="api-nav"><ul>
  <li><a id="nav" class="api-nav__row api-nav__leaf" href="${PANE}kill/#details"><span class="api-nav__label">kill</span></a></li>
  <li id="branch"><div id="branch-row" class="api-nav__row"><a id="branch-label" class="api-nav__label" href="${PANE}kill/">kill</a></div><ul></ul></li>
  <li><a id="elsewhere" class="api-nav__row api-nav__leaf" href="/en/ts/latest/reference/server-server/">Server</a></li>
</ul></nav>`

let win: Window
afterEach(async () => { await win.happyDOM.abort() })

function mount(html = page) {
  win = new Window({ url: `https://libtmux.org${PANE}` })
  win.document.body.innerHTML = html
  crossHighlight(win.document as unknown as Document)
  const at = (id: string) => win.document.getElementById(id)!
  const lit = () => [...win.document.querySelectorAll('.is-cross-lit')].map((element) => element.id)
  const fire = (id: string, type: string, related?: string) => {
    const init = { bubbles: true, relatedTarget: related ? at(related) : undefined }
    at(id).dispatchEvent(type.startsWith('focus') ? new win.FocusEvent(type, init) : new win.MouseEvent(type, init))
  }
  return { at, lit, fire }
}

describe('cross-highlighting', () => {
  it('lights every other link to the same page when a name is hovered: the chip, the member list, the sidebar and a branch row', () => {
    const { lit, fire } = mount()
    fire('prose', 'pointerover')
    expect(lit()).toEqual(['chip', 'member', 'nav', 'branch-row'])
  })

  it('lights a branch row, not the label inside it, and lights from the label of a branch row', () => {
    const { lit, fire, at } = mount()
    fire('prose', 'pointerover')
    expect(at('branch-label').classList.contains('is-cross-lit')).toBe(false)
    expect(at('branch-row').classList.contains('is-cross-lit')).toBe(true)
    fire('prose', 'pointerout', 'words')
    fire('branch-label', 'pointerover')
    expect(lit()).toEqual(['prose', 'chip', 'member', 'nav'])
  })

  it('leaves the hovered link, other pages, other kinds of link and other origins unlit', () => {
    const { lit, fire } = mount()
    fire('prose', 'pointerover')
    for (const id of ['prose', 'other', 'elsewhere', 'plain', 'markdown', 'abroad']) expect(lit(), id).not.toContain(id)
  })

  it('lights from a descendant of the link, as when the pointer is over its code', () => {
    const { lit, at } = mount()
    at('prose').querySelector('code')!.dispatchEvent(new win.MouseEvent('pointerover', { bubbles: true }))
    expect(lit()).toEqual(['chip', 'member', 'nav', 'branch-row'])
  })

  it('lights nothing from a link on another origin, though other links share its path', () => {
    const { lit, fire } = mount()
    fire('abroad', 'pointerover')
    expect(lit()).toEqual([])
  })

  it('clears when the pointer leaves for something that is not a link', () => {
    const { lit, fire } = mount()
    fire('prose', 'pointerover')
    fire('prose', 'pointerout', 'words')
    expect(lit()).toEqual([])
  })

  it('moves to the other page when the pointer passes to another link', () => {
    const { lit, fire } = mount()
    fire('prose', 'pointerover')
    fire('prose', 'pointerout', 'other')
    fire('other', 'pointerover')
    expect(lit()).toEqual(['id-member'])
  })

  it('does the same for keyboard focus', () => {
    const { lit, fire } = mount()
    fire('member', 'focusin')
    expect(lit()).toEqual(['prose', 'chip', 'nav', 'branch-row'])
    fire('member', 'focusout')
    expect(lit()).toEqual([])
  })

  it('lights nothing for a link no other link repeats, or for text that is not a link', () => {
    const { lit, fire } = mount()
    fire('elsewhere', 'pointerover')
    expect(lit()).toEqual([])
    fire('words', 'pointerover')
    expect(lit()).toEqual([])
  })

  it('works on a page with no prose at all: the member list against the sidebar', () => {
    const { lit, fire } = mount(`<ul><li><a id="member" class="api-member-link" href="${PANE}kill/">kill</a></li></ul>
      <nav class="api-nav"><a id="nav" class="api-nav__row api-nav__leaf" href="${PANE}kill/"><span class="api-nav__label">kill</span></a></nav>`)
    fire('member', 'pointerover')
    expect(lit()).toEqual(['nav'])
  })

  it('sees a row the tree adds after the first hover, whether it opens a new path or repeats a known one', async () => {
    const { lit, fire, at } = mount()
    fire('prose', 'pointerover')
    fire('prose', 'pointerout', 'words')
    const group = at('branch').querySelector('ul')!
    group.innerHTML = `<li><a id="late" class="api-nav__row api-nav__leaf" href="${PANE}kill/"><span class="api-nav__label">kill</span></a></li>
      <li><a id="late-id" class="api-nav__row api-nav__leaf" href="${PANE}id/"><span class="api-nav__label">id</span></a></li>`
    // The first hover after the change is a path the map already holds: the tree's mutation has marked it stale.
    await new Promise((resolve) => setTimeout(resolve))
    fire('prose', 'pointerover')
    expect(lit()).toContain('late')
    fire('prose', 'pointerout', 'words')
    fire('other', 'pointerover')
    expect(lit()).toEqual(['id-member', 'late-id'])
  })

  it('rebuilds on a miss, for links added outside the tree\'s own subtree', () => {
    const { lit, fire } = mount()
    fire('prose', 'pointerover')
    fire('prose', 'pointerout', 'words')
    win.document.body.insertAdjacentHTML('beforeend', `<a id="added" class="api-member-link" href="${PANE}new/">new</a><a id="added-too" class="api-member-link" href="${PANE}new/">new</a>`)
    fire('added', 'pointerover')
    expect(lit()).toEqual(['added-too'])
  })

  it('wires a page once, however many components ask', () => {
    const { lit, fire } = mount()
    const listen = vi.spyOn(win.document, 'addEventListener')
    crossHighlight(win.document as unknown as Document)
    expect(listen).not.toHaveBeenCalled()
    fire('member', 'pointerover')
    expect(lit()).toEqual(['prose', 'chip', 'nav', 'branch-row'])
  })
})

describe('where cross-highlighting is loaded and drawn', () => {
  it('is loaded by the components every reference page renders, not by ApiProse, which many pages never render', () => {
    expect(source('components/api/ApiReference.astro')).toMatch(/<script>\s*import \{ crossHighlight \} from '\.\.\/\.\.\/lib\/cross-highlight'/)
    expect(source('components/api/ProductApiPage.astro')).toMatch(/<script>\s*import \{ crossHighlight \} from '\.\.\/\.\.\/lib\/cross-highlight'/)
    expect(source('components/api/ApiProse.astro')).not.toContain('<script')
  })

  it('paints the tint of a lit name on the code box inside its link, which is the text, and not on the taller link box', () => {
    const rule = (selector: string) => css.slice(css.indexOf(selector), css.indexOf('}', css.indexOf(selector)))
    const link = 'a.api-doc-link.is-cross-lit:not(.api-mention--chip)'
    expect(rule(`${link} .api-literal--link {`)).toMatch(/background:\s*color-mix\(.*18%/)
    expect(rule(`${link} .api-literal--link {`)).toMatch(/box-shadow:/)
    expect(rule(`${link} {`)).not.toMatch(/background|box-shadow/)
    // A link with no code inside has no box to hold the tint but its own.
    expect(rule(`${link}:not(:has(.api-literal--link)) {`)).toMatch(/background:\s*color-mix\(.*18%/)
  })

  it('has a rule in the stylesheet for each kind of link it lights, the branch row of the tree included', () => {
    const watched = source('lib/cross-highlight.ts').match(/const LINKS = '([^']+)'/)![1].split(',').map((selector) => selector.trim().replace(/\[href\]$/, ''))
    expect(watched).toEqual(['a.api-doc-link', 'a.api-member-link', 'a.api-nav__row', '.api-nav__row > a.api-nav__label'])
    for (const rule of ['a.api-doc-link.is-cross-lit', 'a.api-member-link.is-cross-lit', '.api-nav__row.is-cross-lit']) expect(css, rule).toContain(rule)
  })
})
