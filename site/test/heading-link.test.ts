import { createMarkdownProcessor, rehypeHeadingIds } from '@astrojs/markdown-remark'
import { experimental_AstroContainer } from 'astro/container'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { bindHeadingLinks, HEADING_LINK_AUTOLINK } from '../src/lib/heading-link'
import { loadAstroTemplate, withoutScope } from './astro-templates'

const windows: Window[] = []
afterEach(async () => { for (const win of windows.splice(0)) await win.happyDOM.abort() })

describe('the heading link every page family draws', () => {
  it('replaces the pilcrow on a Markdown heading with the link icon', async () => {
    const processor = await createMarkdownProcessor({ syntaxHighlight: false, rehypePlugins: [rehypeHeadingIds, [rehypeAutolinkHeadings, HEADING_LINK_AUTOLINK]] })
    const { code } = await processor.render('## Sending keys')
    expect(code).toMatch(/<h2 id="sending-keys">Sending keys<a [^>]*class="heading-link"[^>]*href="#sending-keys"[^>]*><svg [^>]*class="heading-link__icon"/)
    expect(code).toContain('aria-label="Link to this section"')
    expect(code).toContain('data-pagefind-ignore="all"')
    expect(code).not.toContain('¶')
  })

  it('is the same markup from the component that draws API, glossary, catalog and protocol headings', async () => {
    const template = await loadAstroTemplate('components/HeadingLink.astro', {})
    const container = await experimental_AstroContainer.create()
    const html = withoutScope(await container.renderToString(template as Parameters<typeof container.renderToString>[0], { props: { href: '#api-members', label: 'Link to Members' } }))
    expect(html).toMatch(/^<a class="heading-link" href="#api-members" aria-label="Link to Members" data-pagefind-ignore="all"><svg class="heading-link__icon"/)
    expect(html).not.toContain('>#<')
  })
})

/** A page with a heading link, a listener on its document and a clipboard that keeps what it is given. */
function mount({ clipboard = true } = {}) {
  const win = new Window({ url: 'https://libtmux.org/en/go/latest/reference/pane/?v=1' })
  windows.push(win)
  win.document.body.innerHTML = '<h2 id="api-members">Members<a class="heading-link" href="#api-members" aria-label="Link to Members"><svg></svg></a></h2><a id="other" href="#x">x</a>'
  const copied: string[] = []
  Object.defineProperty(win.navigator, 'clipboard', { value: clipboard
    ? { writeText: async (text: string) => { copied.push(text) } }
    : { writeText: async () => { throw new Error('denied') } } })
  // Without the async clipboard the handler falls back to a selected scratch field.
  win.document.execCommand = () => false
  const stop = bindHeadingLinks(win.document as unknown as Document)
  const link = win.document.querySelector('a.heading-link')! as unknown as HTMLAnchorElement
  const click = (init: MouseEventInit = {}, target: Element = link) => target.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }))
  const region = () => win.document.getElementById('heading-link-status')
  return { win, link, click, copied, region, stop }
}

describe('copying a section link', () => {
  it('copies the section URL of the page the reader is on, shows Copied and announces it politely', async () => {
    const { link, click, copied, region } = mount()
    click()
    await Promise.resolve()
    await Promise.resolve()
    expect(copied).toEqual(['https://libtmux.org/en/go/latest/reference/pane/?v=1#api-members'])
    expect(link.dataset.copied).toBe('true')
    expect(region()?.getAttribute('aria-live')).toBe('polite')
    expect(region()?.getAttribute('role')).toBe('status')
    expect(region()?.textContent).toBe('Link copied')
  })

  it('announces a repeated copy as a change, and a failed one as a failure', async () => {
    const { click, region } = mount()
    click(); await Promise.resolve(); await Promise.resolve()
    click(); await Promise.resolve(); await Promise.resolve()
    expect(region()?.textContent).toBe('Link copied ')
    const failing = mount({ clipboard: false })
    failing.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(failing.link.dataset.copied).toBe('false')
    expect(failing.region()?.textContent).toBe('Copy failed')
  })

  it('leaves the navigation to the browser and ignores modified clicks and other links', async () => {
    const { win, link, click, copied } = mount()
    expect(click()).toBe(true)
    expect(click({ metaKey: true })).toBe(true)
    expect(click({ ctrlKey: true })).toBe(true)
    expect(click({ shiftKey: true })).toBe(true)
    expect(click({ button: 1 })).toBe(true)
    click({}, win.document.getElementById('other')!)
    await Promise.resolve(); await Promise.resolve()
    expect(copied).toHaveLength(1)
    expect(link.dataset.copied).toBe('true')
  })

  it('copies when the router has already cancelled the link\'s own navigation to scroll to it itself', async () => {
    const { win, click, copied } = mount()
    win.document.addEventListener('click', (event) => event.preventDefault())
    expect(click()).toBe(false)
    await Promise.resolve(); await Promise.resolve()
    expect(copied).toHaveLength(1)
  })
})
