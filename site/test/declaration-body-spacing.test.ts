import { readFileSync } from 'node:fs'
import { Window, type Element } from 'happy-dom'
import { afterEach, expect, it } from 'vitest'

const api = readFileSync(new URL('../src/styles/api.css', import.meta.url), 'utf8')
// Mount the sheets in the order the reference pages import them: owned, then vendored.
const css = api + readFileSync(new URL('../src/styles/vendor/gp-sphinx-api.css', import.meta.url), 'utf8')
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
function margin(element: Element, side: 'Top' | 'Bottom') {
  const value = win.getComputedStyle(element)[`margin${side}`]
  return value === '0' ? '0px' : value
}

const description = '<div class="gp-sphinx-api-description"><h2 class="rubric">Description</h2><p>Prose.</p></div>'
const parameters = '<div class="gp-sphinx-api-parameters"><dl class="field-list simple"><dt>Parameters</dt><dd><ul class="simple api-parameters"><li><p class="api-parameter-heading">name</p></li></ul></dd></dl></div>'
const examples = '<div class="gp-sphinx-api-examples"><h2 class="rubric">Examples</h2><div class="gp-sphinx-api-example"><div class="expressive-code"><pre>server.sessions()</pre></div></div></div>'
const elsewhere = '<details class="api-elsewhere"><summary>In other ports</summary><ul><li>Go</li></ul></details>'
const mentions = '<p class="gp-sphinx-api-mentions">Discussed in <a href="#guide">Guide</a></p>'

it('trims the first and last child of a body and of the wrappers inside it', () => {
  const [prose, fields, example, other, links] = mount([description, parameters, examples, elsewhere, mentions])
  const rubric = prose!.querySelector('.rubric')!
  expect(margin(rubric, 'Top')).toBe('0px')
  expect(margin(prose!.querySelector('.gp-sphinx-api-description > p')!, 'Bottom')).toBe('0px')
  const list = win.getComputedStyle(fields!.querySelector('dl.field-list')!)
  expect([list.marginTop, list.paddingTop, list.borderTopWidth]).toEqual(['0px', '0px', '0px'])
  expect(margin(fields!.querySelector('.api-parameter-heading')!, 'Bottom')).toBe('0px')
  expect(margin(example!.querySelector('.rubric')!, 'Top')).toBe('0px')
  expect(margin(example!.querySelector('.expressive-code')!, 'Bottom')).toBe('0px')
  expect(margin(other!.firstElementChild!, 'Top')).toBe('0px')
  expect(margin(links!.firstElementChild!, 'Top')).toBe('0px')
  expect(margin(links!.firstElementChild!, 'Bottom')).toBe('0px')
  for (const body of [prose, fields, example, other, links]) {
    const style = win.getComputedStyle(body!)
    expect([style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft]).toEqual(['12px', '16px', '12px', '16px'])
  }
})

it('preserves spacing between siblings and inside later sections', () => {
  const [body] = mount([
    `<p class="gp-sphinx-api-summary">Summary.</p><div class="gp-sphinx-api-description"><h2 class="rubric">Description</h2><p>First.</p><h3 class="rubric">Interior heading</h3><p>Last.</p></div>${examples}${mentions}${elsewhere}`,
  ])
  const prose = body!.querySelector('.gp-sphinx-api-description')!
  const [heading, interior] = prose.querySelectorAll('.rubric')
  expect(margin(heading!, 'Top')).toBe('16px')
  expect(margin(heading!, 'Bottom')).toBe('8px')
  expect(margin(interior!, 'Top')).toBe('16px')
  expect(margin(interior!, 'Bottom')).toBe('8px')
  const [first, last] = prose.querySelectorAll('p')
  expect(margin(first!, 'Bottom')).toBe('8px')
  expect(margin(last!, 'Bottom')).toBe('8px')
  expect(margin(body!.querySelector('.gp-sphinx-api-examples > .rubric')!, 'Top')).toBe('16px')
  expect(margin(body!.querySelector('.gp-sphinx-api-mentions')!, 'Top')).toBe('8px')
  expect(margin(body!.querySelector('.api-elsewhere')!, 'Top')).toBe('8px')
})

it('keeps the divider and heading gap of a field list that follows other content', () => {
  const [body] = mount([`${description}${parameters}${mentions}`])
  const list = win.getComputedStyle(body!.querySelector('dl.field-list')!)
  expect([list.marginTop, list.paddingTop]).toEqual(['8px', '8px'])
  expect(list.borderTopWidth).not.toBe('0px')
  expect(margin(body!.querySelector('.api-parameter-heading')!, 'Bottom')).toBe('6.4px')
})
