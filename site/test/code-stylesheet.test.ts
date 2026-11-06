import { describe, expect, it } from 'vitest'
import { hoistCodeStylesheet } from '../src/integrations/code-stylesheet'

const link = '<link rel="stylesheet" href="/en/ts/latest/_astro/ec.amq6k.css">'
const page = (head: string, body: string) => `<!doctype html><html><head><title>t</title>${head}</head><body>${body}</body></html>`
const frame = (extra = '') => `<div class="expressive-code">${extra}<figure class="frame"><pre><code>x</code></pre></figure></div>`

describe('code stylesheet', () => {
  it('moves the link from the first code frame to the end of the head', () => {
    const html = hoistCodeStylesheet(page('<link rel="stylesheet" href="/_astro/a.css">', `<main>${frame(link)}</main>`))
    expect(html).toBe(page(`<link rel="stylesheet" href="/_astro/a.css">${link}`, `<main>${frame()}</main>`))
  })

  it('leaves a page without code frames as it came', () => {
    const html = page('<link rel="stylesheet" href="/_astro/a.css">', '<main>text</main>')
    expect(hoistCodeStylesheet(html)).toBe(html)
  })

  it('keeps one link when a page emits the link more than once', () => {
    const html = hoistCodeStylesheet(page('', `${frame(link)}<p>between</p>${frame(link)}`))
    expect(html.match(/ec\.amq6k\.css/g)).toHaveLength(1)
    expect(html.indexOf(link)).toBeLessThan(html.indexOf('</head>'))
    expect(html.slice(html.indexOf('<body'))).not.toContain('<link')
  })

  it('reads the self-closing form of the link', () => {
    const closed = '<link rel="stylesheet" href="/_astro/ec.ln3sc.css"/>'
    const html = hoistCodeStylesheet(page('', frame(closed)))
    expect(html).toBe(page(closed, frame()))
  })

  it('does not touch the page stylesheets, nor a link the head already carries', () => {
    const head = `<link rel="stylesheet" href="/_astro/BaseLayout.D6CqMg1D.css">${link}`
    const html = page(head, `<main><link rel="stylesheet" href="/_astro/late.css">${frame()}</main>`)
    expect(hoistCodeStylesheet(html)).toBe(html)
  })

  it('does not read code shown as text', () => {
    const html = page('', `<pre><code>&lt;link rel="stylesheet" href="/_astro/ec.amq6k.css"&gt;</code></pre>`)
    expect(hoistCodeStylesheet(html)).toBe(html)
  })
})
