import { afterEach, describe, expect, it } from 'vitest'
import { Window } from 'happy-dom'
import { installExternalLinks } from '../public/_shell/external-links.js'

const disposals: (() => void)[] = []
afterEach(() => disposals.splice(0).forEach((dispose) => dispose()))
function page() {
  const win = new Window({ url: 'https://libtmux.org/en/powershell/latest/reference/example/' })
  win.document.body.innerHTML = `<a id="external" href="https://learn.microsoft.com/dotnet/api/example"><code>Example</code></a>
    <a id="relative" href="/en/csharp/latest/reference/server/">Server</a>
    <a id="absolute" href="https://libtmux.org/en/py/latest/">Python</a>
    <a id="fragment" href="#parameter">Parameter</a><a id="mail" href="mailto:example@example.com">Mail</a>
    <a id="protocol" href="//docs.python.org/3/" title="Python reference" aria-description="More detail">Python</a>`
  const dispose = installExternalLinks(win as unknown as typeof window)
  disposals.push(dispose, () => { void win.happyDOM.abort() })
  return { win, doc: win.document, dispose }
}
describe('shared external link hints', () => {
  it('keeps external metadata on icon links without adding a second visual glyph', async () => {
    const { doc, win } = page()
    const fixtures = doc.createElement('div')
    fixtures.innerHTML = `<a id="svg-icon" href="https://github.com/libtmux/docs" aria-label="GitHub"><svg><title>GitHub</title><path /></svg></a>
      <a id="image-icon" href="https://example.com/" aria-label="Example"><img alt="Example" src="icon.svg" /><span class="sr-only">Example</span></a>
      <a id="mixed-icon" href="https://example.com/"><svg aria-hidden="true"><path /></svg><span>Documentation</span></a>
      <a id="labelled-text" href="https://example.com/" aria-label="Documentation">Documentation</a>`
    doc.body.append(fixtures)
    await win.happyDOM.waitUntilComplete()
    for (const id of ['svg-icon', 'image-icon']) {
      const link = doc.getElementById(id)!
      expect(link.hasAttribute('data-external-link-icon')).toBe(true)
      expect(link.getAttribute('aria-label')).toBe(id === 'svg-icon' ? 'GitHub' : 'Example')
      expect(link.getAttribute('aria-description')).toMatch(/^External site:/)
      expect(link.hasAttribute('target')).toBe(false)
    }
    for (const id of ['mixed-icon', 'labelled-text']) {
      expect(doc.getElementById(id)!.hasAttribute('data-external-link')).toBe(true)
      expect(doc.getElementById(id)!.hasAttribute('data-external-link-icon')).toBe(false)
    }
    const icon = doc.getElementById('svg-icon')!
    icon.insertAdjacentHTML('beforeend', '<span>GitHub</span>')
    await win.happyDOM.waitUntilComplete()
    expect(icon.hasAttribute('data-external-link-icon')).toBe(false)
    icon.querySelector('span')!.remove()
    await win.happyDOM.waitUntilComplete()
    expect(icon.hasAttribute('data-external-link-icon')).toBe(true)
    icon.setAttribute('href', '/en/')
    await win.happyDOM.waitUntilComplete()
    expect(icon.hasAttribute('data-external-link-icon')).toBe(false)
    expect(icon.hasAttribute('data-external-link')).toBe(false)
  })
  it('marks outside HTTP destinations without changing labels, code, or internal links', () => {
    const { doc } = page()
    const link = doc.getElementById('external')!
    expect(link.getAttribute('title')).toBe('View on learn.microsoft.com')
    expect(link.getAttribute('aria-description')).toBe('External site: learn.microsoft.com')
    expect(link.innerHTML).toBe('<code>Example</code>')
    expect(link.hasAttribute('target')).toBe(false)
    for (const id of ['relative', 'absolute', 'fragment', 'mail']) expect(doc.getElementById(id)!.hasAttribute('data-external-link')).toBe(false)
    expect(doc.getElementById('protocol')!.getAttribute('title')).toBe('View on docs.python.org — Python reference')
  })
  it('handles changed hrefs and dynamically inserted links, and restores original metadata', async () => {
    const { doc, win, dispose } = page()
    const first = doc.getElementById('external')!
    first.setAttribute('href', '/en/reference/')
    const next = doc.createElement('a')
    next.href = 'https://example.com/documentation'
    next.textContent = 'Documentation'
    doc.body.append(next)
    await win.happyDOM.waitUntilComplete()
    expect(first.hasAttribute('data-external-link')).toBe(false)
    expect(first.hasAttribute('title')).toBe(false)
    expect(next.title).toBe('View on example.com')
    const protocol = doc.getElementById('protocol')!
    protocol.removeAttribute('href')
    await win.happyDOM.waitUntilComplete()
    expect(protocol.hasAttribute('data-external-link')).toBe(false)
    expect(protocol.getAttribute('title')).toBe('Python reference')
    expect(protocol.getAttribute('aria-description')).toBe('More detail')
    dispose()
    expect(doc.querySelectorAll('[data-external-link]')).toHaveLength(0)
    expect(doc.getElementById('protocol')!.getAttribute('title')).toBe('Python reference')
    expect(doc.getElementById('protocol')!.getAttribute('aria-description')).toBe('More detail')
  })
  it('can reinstall for client navigation without duplicating hints', () => {
    const { win, doc, dispose } = page()
    dispose()
    const cleanup = installExternalLinks(win as unknown as typeof window)
    disposals.push(cleanup)
    expect(doc.getElementById('protocol')!.getAttribute('title')).toBe('View on docs.python.org — Python reference')
    expect(doc.getElementById('protocol')!.getAttribute('aria-description')).toBe('More detail. External site: docs.python.org')
  })
})
