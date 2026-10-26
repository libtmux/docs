import { Window } from 'happy-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createLinkPreviewPolicy, initializeLinkPreviewPaint } from '../src/lib/link-preview-paint'

let win: Window
let showPopover: ReturnType<typeof vi.fn>
beforeEach(() => {
  win = new Window({ url: 'https://libtmux.org/en/julia/latest/reference/libtmux-server/' })
  for (const [name, value] of Object.entries({ window: win, document: win.document, location: win.location,
    Element: win.Element, HTMLElement: win.HTMLElement, MutationObserver: win.MutationObserver })) vi.stubGlobal(name, value)
  Object.defineProperty(win.document, 'readyState', { value: 'loading', configurable: true })
  win.document.documentElement.setAttribute('data-reference-previews', '')
  showPopover = vi.fn()
  Object.assign(win.HTMLElement.prototype, { showPopover })
})
afterEach(async () => {
  await win.happyDOM.abort()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
const policy = () => createLinkPreviewPolicy()
const anchor = (id: string) => win.document.getElementById(id)!
const marked = (id: string) => anchor(id).hasAttribute('data-link-preview')
const append = (html: string) => win.document.body.insertAdjacentHTML('beforeend', html)
const parsed = () => win.happyDOM.waitUntilComplete()

it('shares endpoint rules with deferred behavior, including protocol objects', () => {
  const { target } = policy()
  const origin = win.location.origin
  for (const path of ['/en/ts/latest/reference/type/', '/en/ts/latest/mcp/tools/create_session/',
    '/en/ts/latest/mcp/prompts/review/', '/en/ts/latest/mcp/resources/tmux-capabilities/',
    '/en/ts/latest/mcp/resources/templates/session/']) expect(target(path, origin)?.endpoint).toBe(`${path.slice(0, -1)}.preview.json`)
  for (const path of ['/en/ts/latest/reference/', '/en/ts/latest/mcp/resources/templates/', '/guide/',
    '/en/ts/latest/reference/type/?q=1', 'https://elsewhere.test/reference/type/', 'javascript:alert(1)']) expect(target(path, origin)).toBeUndefined()
})

it('marks parser-added eligible links without fetching or binding interactions', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  initializeLinkPreviewPaint(policy())
  append('<p><a id="python" href="/en/py/v0.46.2/reference/libtmux-server/">Python</a><a id="from-env" href="../libtmux-from_env/">from_env</a></p>')
  await parsed()
  expect(marked('python')).toBe(true)
  expect(marked('from-env')).toBe(true)
  const click = new win.MouseEvent('click', { bubbles: true, cancelable: true })
  anchor('python').dispatchEvent(click)
  expect(click.defaultPrevented).toBe(false)
  expect(fetch).not.toHaveBeenCalled()
  expect(showPopover).not.toHaveBeenCalled()
})

it('does not repeatedly scan existing or overlapping parser subtrees', async () => {
  const rules = policy(); const candidate = vi.spyOn(rules, 'candidate')
  initializeLinkPreviewPaint(rules)
  const section = win.document.createElement('section'); win.document.body.append(section)
  const paragraph = win.document.createElement('p'); section.append(paragraph)
  paragraph.innerHTML = '<a id="first" href="../libtmux-from_env/">from_env</a>'
  await parsed()
  expect(candidate).toHaveBeenCalledTimes(1)
  append('<p><a id="second" href="../libtmux-from_env/">from_env</a></p>')
  await parsed()
  expect(candidate).toHaveBeenCalledTimes(2)
})

it.each([
  '<nav><a id="excluded" href="../libtmux-from_env/">nav</a></nav>',
  '<footer><a id="excluded" href="../libtmux-from_env/">footer</a></footer>',
  '<div data-doc-picker><a id="excluded" href="../libtmux-from_env/">picker</a></div>',
  '<div class="api-index-card"><p><a id="excluded" href="../libtmux-from_env/" data-link-preview>inline</a></p></div>',
  '<div class="reference-link-preview"><a id="excluded" href="../libtmux-from_env/">preview</a></div>',
  '<a id="excluded" data-preview-skip href="../libtmux-from_env/">skip</a>',
  '<a id="excluded" class="api-index-card__link" href="../libtmux-from_env/">card</a>',
  '<a id="excluded" class="doc-card" href="../libtmux-from_env/">card</a>',
  '<a id="excluded" href="../libtmux-from_env/"><h3>Runtime support</h3><p>Requirements and behavior.</p></a>',
  '<a id="excluded" class="api-heading-link" href="../libtmux-from_env/">heading</a>',
  '<a id="excluded" class="headerlink" href="../libtmux-from_env/">permalink</a>',
  '<a id="excluded" href="#from_env">fragment</a>',
  '<a id="excluded" href="../libtmux-from_env/?q=1">query</a>',
  '<a id="excluded" href="https://elsewhere.test/reference/from-env/">external</a>',
])('preserves the preview exclusion: %s', async (html) => {
  initializeLinkPreviewPaint(policy()); append(html); await parsed()
  expect(marked('excluded')).toBe(false)
})

it('unmarks a link that gains block content after the parser marked it', async () => {
  let relayout = () => {}
  Object.assign(win, { __libtmuxAppearance: { layout: (callback: () => void) => { relayout = callback } } })
  initializeLinkPreviewPaint(policy())
  append('<a id="late" href="../libtmux-from_env/"></a>')
  await parsed(); expect(marked('late')).toBe(true)
  anchor('late').innerHTML = '<h3>Runtime support</h3><p>Requirements and behavior.</p>'
  relayout()
  expect(marked('late')).toBe(false)
})

it('replaces native glossary tooltips while preserving the link name and destination', async () => {
  initializeLinkPreviewPaint(policy())
  append('<span title="Enclosing tooltip"><a id="badge" class="api-badge" href="../glossary/#struct" data-link-preview title="struct" aria-label="Read the struct definition"><span class="api-badge__label" title="struct">struct</span></a></span>')
  await parsed()
  expect(marked('badge')).toBe(true)
  expect(anchor('badge').getAttribute('title')).toBe('')
  expect(anchor('badge').querySelector('[title]')).toBeNull()
  expect(anchor('badge').textContent).toBe('struct')
  expect(anchor('badge').getAttribute('aria-label')).toBe('Read the struct definition')
  expect(anchor('badge').getAttribute('href')).toBe('../glossary/#struct')
  anchor('badge').insertAdjacentHTML('beforeend', '<span title="Later parsed child"> extra</span>')
  await parsed()
  expect(anchor('badge').querySelector('[title]')).toBeNull()
  expect(anchor('badge').parentElement!.getAttribute('title')).toBe('Enclosing tooltip')
})

it('retains native tooltips on links without previews', async () => {
  initializeLinkPreviewPaint(policy())
  append('<nav><a id="nav" href="../libtmux-from_env/" title="Navigation">from_env</a></nav><div class="api-index-card"><a id="card" href="../libtmux-from_env/" title="Card">from_env</a></div>')
  await parsed()
  expect(anchor('nav').getAttribute('title')).toBe('Navigation')
  expect(anchor('card').getAttribute('title')).toBe('Card')
})

it('drains and disconnects the parser observer at DOMContentLoaded', async () => {
  initializeLinkPreviewPaint(policy())
  append('<a id="pending" href="../libtmux-from_env/">pending</a>')
  win.document.dispatchEvent(new win.Event('DOMContentLoaded'))
  expect(marked('pending')).toBe(true)
  append('<a id="later" href="../libtmux-from_env/">later</a>')
  await parsed()
  expect(marked('later')).toBe(false)
})

it('initializes an API document before swapping from NativeShell, resolving its destination URL', async () => {
  win.document.documentElement.removeAttribute('data-reference-previews')
  initializeLinkPreviewPaint(policy())
  append('<a id="native" href="../libtmux-from_env/">native</a>')
  await parsed(); expect(marked('native')).toBe(false)
  const next = win.document.implementation.createHTMLDocument()
  next.documentElement.setAttribute('data-reference-previews', '')
  next.body.innerHTML = '<a id="incoming" href="../libtmux-from_env/" title="from_env">from_env</a><a id="fragment" href="#member">fragment</a>'
  const event = new win.Event('astro:before-swap')
  Object.assign(event, { newDocument: next, to: new URL('https://libtmux.org/en/julia/latest/reference/libtmux-server/') })
  win.document.dispatchEvent(event)
  expect(next.getElementById('incoming')!.hasAttribute('data-link-preview')).toBe(true)
  expect(next.getElementById('incoming')!.getAttribute('title')).toBe('')
  expect(next.getElementById('fragment')!.hasAttribute('data-link-preview')).toBe(false)
  expect(win.document.getElementById('incoming')).toBeNull()
})

it('preserves unsupported-popover fallback', async () => {
  Object.defineProperty(win.HTMLElement.prototype, 'showPopover', { value: undefined, configurable: true })
  initializeLinkPreviewPaint(policy())
  append('<a id="ordinary" href="../libtmux-from_env/" title="Ordinary fallback">ordinary</a>')
  await parsed(); expect(marked('ordinary')).toBe(false)
  expect(anchor('ordinary').getAttribute('title')).toBe('Ordinary fallback')
})

it('runs the exact self-contained serialized initializer without module globals', async () => {
  win.eval(`(${initializeLinkPreviewPaint.toString()})((${createLinkPreviewPolicy.toString()})());`)
  append('<a id="serialized" href="../libtmux-from_env/">from_env</a>')
  await parsed(); expect(marked('serialized')).toBe(true)
})
