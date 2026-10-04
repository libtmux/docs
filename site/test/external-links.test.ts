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
  disposals.push(dispose, () => {
    void win.happyDOM.abort()
  })
  return { win, doc: win.document, dispose }
}
describe('shared external link hints', () => {
  it('marks outside HTTP destinations without changing labels, code, or internal links', () => {
    const { doc } = page()
    const link = doc.getElementById('external')!
    expect(link.getAttribute('title')).toBe('View on learn.microsoft.com')
    expect(link.getAttribute('aria-description')).toBe('External site: learn.microsoft.com')
    expect(link.innerHTML).toBe('<code>Example</code>')
    expect(link.hasAttribute('target')).toBe(false)
    for (const id of ['relative', 'absolute', 'fragment', 'mail'])
      expect(doc.getElementById(id)!.hasAttribute('data-external-link')).toBe(false)
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
    expect(doc.getElementById('protocol')!.getAttribute('aria-description')).toBe(
      'More detail. External site: docs.python.org',
    )
  })
})
