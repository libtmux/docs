import { readFileSync } from 'node:fs'
import { Window, type Element } from 'happy-dom'
import { afterEach, expect, it } from 'vitest'

const globalCss = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8')
// Exercise the ordinary unlayered edge rule without asking Happy DOM to compile Tailwind directives.
const edgeRules = globalCss.slice(globalCss.indexOf('/* Body padding'), globalCss.indexOf('/* Font-face'))
const css = edgeRules + readFileSync(new URL('../src/styles/vendor/gp-sphinx-api.css', import.meta.url), 'utf8')
let win: Window
afterEach(async () => { await win?.happyDOM.abort() })

function mount(bodies: string[]) {
  win = new Window({ settings: { disableCSSFileLoading: true, disableJavaScriptEvaluation: true } })
  win.document.documentElement.style.fontSize = '16px'
  win.document.head.innerHTML = `<style>${css}</style>`
  win.document.body.innerHTML = bodies.map((body, index) =>
    `<dl class="py gp-sphinx-api-container"><dt>Declaration ${index}</dt><dd>${body}</dd></dl>`).join('')
  return [...win.document.querySelectorAll('dl.py > dd')]
}

// Happy DOM exposes logical and physical margins separately; box geometry belongs to browser acceptance.
function start(element: Element) {
  const style = win.getComputedStyle(element)
  const value = style.marginBlockStart || style.marginTop
  return value === '0' ? '0px' : value
}

it('lets body padding own a true first heading or paragraph inside an owned section', () => {
  const bodies = mount([
    '<div class="gp-sphinx-api-description" id="Server.description"><h2 class="rubric">Description</h2><p>Swift Server.</p></div>',
    '<div class="gp-sphinx-api-examples" id="Server.examples"><h2 class="rubric">Examples</h2><p class="gp-sphinx-api-example-intro">Run this.</p><div class="gp-sphinx-api-example"><pre>server.sessions()</pre></div></div>',
    '<div class="gp-sphinx-api-description"><p>Paragraph-first prose.</p><h2 class="rubric">Later heading</h2></div>',
    '<div class="gp-sphinx-api-examples"><p class="gp-sphinx-api-example-intro">Paragraph-first example.</p><div class="gp-sphinx-api-example"><pre>server.sessions()</pre></div></div>',
  ])
  for (const body of bodies) {
    const first = body.firstElementChild!.firstElementChild!
    expect(start(first)).toBe('0px')
    expect(win.getComputedStyle(first).marginBottom).toBe('8px')
    const intro = body.querySelector('.gp-sphinx-api-example-intro')
    if (intro?.previousElementSibling) expect(start(intro)).toBe('12px')
    const style = win.getComputedStyle(body)
    expect([style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft]).toEqual(['12px', '16px', '12px', '16px'])
  }
})

it('preserves later section headings, prose and example-introduction spacing', () => {
  const [body] = mount([
    '<p class="gp-sphinx-api-summary">Summary before sections.</p><div class="gp-sphinx-api-description"><h2 class="rubric">Description</h2><p>First paragraph.</p><h3 class="rubric">Interior heading</h3><p>Later paragraph.</p></div><div class="gp-sphinx-api-examples"><h2 class="rubric">Examples</h2><p class="gp-sphinx-api-example-intro">Example introduction.</p><div class="gp-sphinx-api-example"><pre>server.sessions()</pre></div></div>',
  ])
  for (const heading of body!.querySelectorAll('.rubric')) {
    expect(start(heading)).toBe('16px')
    expect(win.getComputedStyle(heading).marginBottom).toBe('8px')
  }
  for (const paragraph of body!.querySelectorAll('.gp-sphinx-api-description p')) {
    expect(start(paragraph)).toBe('0px')
    expect(win.getComputedStyle(paragraph).marginBottom).toBe('8px')
  }
  expect(start(body!.querySelector('.gp-sphinx-api-example-intro')!)).toBe('12px')
})

it('keeps compact metadata and excludes wrapped, later and unowned content from the edge reset', () => {
  const [metadata, wrapped, firstProse, unowned] = mount([
    '<p class="gp-sphinx-api-mentions">Discussed in <a href="#guide">Guide</a></p><p class="gp-sphinx-api-mentions">In other ports.</p>',
    '<div class="backlinks"><p class="gp-sphinx-api-mentions">Wrapped backlinks.</p></div>',
    '<div class="gp-sphinx-api-description"><p>Real prose precedes the heading.</p><h2 class="rubric">Interior heading</h2></div>',
    '<div class="native-description"><h2 class="rubric">Native-owned heading</h2></div>',
  ])
  expect(start(metadata!.firstElementChild!)).toBe('0px')
  expect(start(metadata!.lastElementChild!)).toBe('8px')
  expect(start(wrapped!.querySelector('.gp-sphinx-api-mentions')!)).toBe('8px')
  expect(start(firstProse!.querySelector('.rubric')!)).toBe('16px')
  expect(start(unowned!.querySelector('.rubric')!)).toBe('16px')
})
