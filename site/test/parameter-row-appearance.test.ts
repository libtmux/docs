import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { afterEach, expect, it } from 'vitest'

const sheet = (name: string) => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), 'utf8')
// Owned sheets first, then the vendored one, as the reference pages import them.
const css = `:root { --color-muted: #53606d; }${sheet('api-kinds.css')}${sheet('api.css')}${sheet('vendor/gp-sphinx-api.css')}`
let win: Window
afterEach(async () => { await win?.happyDOM.abort() })

// The row the entry renders for a typed parameter, inside the field list its Parameters label heads.
const row = `<span class="api-parameter-signature"><strong><a href="#name"><code>name</code></a></strong> (<span class="api-type"><span class="api-punct">&amp;</span><a class="api-type-link" href="#str">str</a></span>)</span>`
const mount = (body = `<div class="gp-sphinx-api-parameters"><dl class="field-list simple"><dt>Parameters</dt><dd><ul class="simple api-parameters"><li><p>${row}</p></li></ul></dd></dl></div>`) => {
  win = new Window({ settings: { disableCSSFileLoading: true, disableJavaScriptEvaluation: true } })
  win.document.head.innerHTML = `<style>${css}</style>`
  win.document.body.innerHTML = `<dl class="py gp-sphinx-api-container"><dt>Declaration</dt><dd>${body}</dd></dl>
    <i id="name-ink" style="color: var(--api-ink-name)"></i><i id="type-ink" style="color: var(--api-ink-type)"></i><i id="muted" style="color: var(--color-muted)"></i>`
  const style = (selector: string) => win.getComputedStyle(win.document.querySelector(selector)!)
  return { style, ink: (id: string) => win.getComputedStyle(win.document.getElementById(id)!).color }
}

it('draws the parameter name in the name ink and its type names in the type ink', () => {
  const { style, ink } = mount()
  expect(ink('name-ink')).not.toBe(ink('type-ink'))
  expect(style('.api-parameter-signature strong code').color).toBe(ink('name-ink'))
  expect(style('.api-type-link').color).toBe(ink('type-ink'))
})

it('mutes the punctuation around a type name', () => {
  const { style, ink } = mount()
  expect(style('.api-type').color).toBe(ink('muted'))
  expect(style('.api-punct').color).toBe(ink('muted'))
})

it('leaves an MCP or a command parameter as it was: its name, its type text and its type links', () => {
  const heading = (name: string) => `<p class="api-parameter-heading"><span class="api-parameter-signature"><strong><a href="#${name}"><code>${name}</code></a></strong>
    (<span class="api-type"><span class="api-punct">&amp;</span><a class="api-type-link" href="#str">str</a></span>)</span></p>`
  const { style, ink } = mount(`<div class="gp-sphinx-api-parameters"><dl class="field-list simple"><dt>Parameters</dt><dd>
    <ul class="simple api-command-parameters"><li id="command">${heading('-Name')}</li></ul></dd></dl></div>
    <ul class="simple api-parameters mcp-parameters"><li id="mcp">${heading('name')}</li></ul>`)
  for (const list of ['#command', '#mcp']) {
    expect(style(`${list} code`).color, `${list}: name`).not.toBe(ink('name-ink'))
    expect(style(`${list} .api-type`).color, `${list}: type text`).not.toBe(ink('muted'))
    expect(style(`${list} .api-type-link`).color, `${list}: type link`).not.toBe(ink('type-ink'))
  }
})
