import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { API_MODELS } from '../src/lib/api-models'
import { markNativeXrefs } from '../src/lib/native-xrefs'

/**
 * The cross-references of a native Sphinx article lead with their kind, as a guide's mentions do. The article is
 * Sphinx's own markup: `a.reference.internal > code.xref.py-<role>`, a signature in `dt.sig`, a field list, an
 * intersphinx reference that leaves the site. The kind is the target's: `kinds` is what the native context records
 * from the declaration Sphinx wrote, here the kinds of the Python model's own declarations and a module anchor.
 */
const kinds: Record<string, string> = {
  ...Object.fromEntries(API_MODELS.py.symbols.map((symbol) => [symbol.publicId ?? symbol.id, symbol.kind])),
  'module-libtmux.exc': 'module',
}
const xref = (role: string, target: string, label: string, href = `../api/${target.split('.').slice(0, 2).join('.').toLowerCase()}/#${target}`) =>
  `<a class="reference internal" href="${href}" title="${target}"><code class="xref py ${role} docutils literal notranslate"><span class="pre">${label}</span></code></a>`
const external = '<a class="reference external" href="https://docs.python.org/3/library/os.html#os.environ"><code class="xref py py-data docutils literal notranslate"><span class="pre">os.environ</span></code></a>'
const ARTICLE = `<article role="main" id="furo-main-content">
  <h1>Quickstart</h1>
  <p>${xref('py-class', 'libtmux.Server', 'Server')} owns ${xref('py-class', 'libtmux.Session', 'Session')}; ${xref('py-class', 'libtmux.Server', 'Server')} again, then ${external}.</p>
  <p>${xref('py-meth', 'libtmux.Pane.from_env', 'Pane.from_env()')} raises ${xref('py-class', 'libtmux.exc.LibTmuxException', 'LibTmuxException')}; ${xref('py-attr', 'libtmux.Window.panes', 'panes')}, ${xref('py-func', 'libtmux.common.get_version_str', 'get_version_str()')}, ${xref('py-data', 'libtmux.common.TMUX_MAX_VERSION', 'TMUX_MAX_VERSION')}, ${xref('py-mod', 'libtmux.exc', 'libtmux.exc', '#module-libtmux.exc')}.</p>
  <p>${xref('py-obj', 'libtmux.Pane', 'Pane')} ${xref('py-fixture', 'libtmux.nonesuch', 'nonesuch')}</p>
  <dl><dt class="sig sig-object py" id="libtmux.Foo.run"><span class="sig-name">run</span>(${xref('py-class', 'libtmux.Server', 'Server')})</dt></dl>
  <dl class="field-list simple"><dt class="field-odd">Parameters</dt><dd class="field-odd"><p><strong>window</strong> (${xref('py-class', 'libtmux.Window', 'Window')}) – a window</p></dd></dl>
  <h2>About ${xref('py-class', 'libtmux.Server', 'Server')}</h2>
  <p>${xref('py-class', 'libtmux.Server', 'Server')} and ${xref('py-class', 'libtmux.Server', 'Server')}</p>
</article>`
const window = new Window()
afterEach(() => { window.document.body.innerHTML = '' })

function article() {
  window.document.body.innerHTML = ARTICLE
  return window.document.querySelector('article')! as unknown as Element
}

const links = (root: Element, scope = 'a.reference.internal') => [...root.querySelectorAll<HTMLAnchorElement>(scope)]
const marked = (link: Element) => Boolean(link.querySelector(':scope > .api-link-kind'))
const kindOf = (link: Element) => link.querySelector(':scope > .api-link-kind')?.getAttribute('data-api-kind')
const target = (link: HTMLAnchorElement) => { const href = link.getAttribute('href') ?? ''; return href.includes('#') ? decodeURIComponent(href.slice(href.indexOf('#') + 1)) : '' }

/** What is wrong with how an article leads its cross-references, so a control can show the check is able to fail. */
function problems(root: Element): string[] {
  const found: string[] = []
  let seen = new Set<string>()
  for (const node of root.querySelectorAll<HTMLAnchorElement>('h1, h2, h3, h4, h5, h6, a.reference.internal')) {
    if (/^H[1-6]$/.test(node.tagName)) { seen = new Set(); continue }
    const code = node.querySelector('code.xref')
    if (!code || node.closest('dt.sig') || !(target(node) in kinds)) continue
    const later = !node.closest('h1, h2, h3, h4, h5, h6') && seen.has(node.href)
    if (!node.closest('h1, h2, h3, h4, h5, h6')) seen.add(node.href)
    if (!node.classList.contains('api-mention')) found.push(`${node.href}: not a mention`)
    if (later && marked(node)) found.push(`${node.href}: a later mention is marked`)
    if (!later && !marked(node)) found.push(`${node.href}: the first mention is plain`)
    if (later && !(node.getAttribute('aria-label') && node.dataset.apiKind)) found.push(`${node.href}: a later mention lost its kind`)
  }
  return found
}

describe('native Sphinx cross-references', () => {
  it('lead with the kind of the declaration they point at, the first time in a section', () => {
    const root = article()
    expect(markNativeXrefs(root, kinds)).toBe(14)
    const led = links(root).filter(marked).map((link) => [link.querySelector('code')!.textContent, kindOf(link)])
    expect(led).toEqual([
      ['Server', 'class'], ['Session', 'class'], ['Pane.from_env()', 'method'], ['LibTmuxException', 'exception'], ['panes', 'property'],
      ['get_version_str()', 'function'], ['TMUX_MAX_VERSION', 'constant'], ['libtmux.exc', 'module'], ['Pane', 'class'],
      ['Window', 'class'], ['Server', 'class'], ['Server', 'class'],
    ])
    expect(problems(root)).toEqual([])
  })

  it('takes a property for a property and an exception for an exception, whatever role named them', () => {
    expect(kinds['libtmux.Window.panes']).toBe('property')
    expect(kinds['libtmux.exc.LibTmuxException']).toBe('exception')
    const root = article()
    markNativeXrefs(root, kinds)
    const panes = links(root).find((link) => target(link) === 'libtmux.Window.panes')!
    expect(kindOf(panes)).toBe('property')
    expect(panes.querySelector('.api-badge__label')!.textContent).toBe('p')
    const exception = links(root).find((link) => target(link) === 'libtmux.exc.LibTmuxException')!
    expect(exception.querySelector('code')!.classList.contains('py-class')).toBe(true)
    expect(kindOf(exception)).toBe('exception')
    expect(exception.querySelector('.api-badge__label')!.textContent).toBe('!')
  })

  it('leaves a target that has no declaration, however the role names it', () => {
    const root = article()
    markNativeXrefs(root, kinds)
    const unknown = links(root).find((link) => target(link) === 'libtmux.nonesuch')!
    expect(unknown.classList.contains('api-mention')).toBe(false)
    expect(markNativeXrefs(article(), {})).toBe(0)
  })

  it('writes the markup a Markdown mention has', () => {
    const root = article()
    markNativeXrefs(root, kinds)
    const link = links(root)[0]!
    expect(link.matches('a.reference.internal.api-mention')).toBe(true)
    const badge = link.querySelector(':scope > .api-link-kind.api-nav__kind.api-badge--kind-class')!
    expect(badge.getAttribute('aria-hidden')).toBe('true')
    expect(badge.getAttribute('title')).toBe('class')
    expect(badge.getAttribute('data-pagefind-ignore')).toBe('all')
    expect(badge.querySelector('.api-badge__label')!.getAttribute('data-mark')).toBe('cap')
    expect(badge.textContent).toBe('C')
    expect(link.querySelector(':scope > .api-symbol-link__name > code.xref.py-class')!.textContent).toBe('Server')
    expect(link.getAttribute('title')).toBe('libtmux.Server')
  })

  it('keeps the kind of a later mention in its tooltip and accessible name, and marks again after a heading', () => {
    const root = article()
    markNativeXrefs(root, kinds)
    const body = links(root).filter((link) => link.querySelector('code')!.textContent === 'Server' && !link.closest('dt, h2'))
    expect(body.map(marked)).toEqual([true, false, true, false])
    expect(body[1]!.getAttribute('aria-label')).toBe('class: Server')
    expect(body[1]!.dataset.apiKind).toBe('class')
    expect(body[1]!.getAttribute('title')).toBe('libtmux.Server')
  })

  it('marks a heading\'s mention without using up the section\'s first', () => {
    const root = article()
    markNativeXrefs(root, kinds)
    const heading = links(root, 'h2 a.reference.internal')[0]!
    expect(marked(heading)).toBe(true)
    const [first, later] = links(root).filter((link) => !link.closest('h2')).slice(-2)
    expect([marked(first!), marked(later!)]).toEqual([true, false])
  })

  it('leads a type in a field list, which Sphinx writes as a code reference like the rest', () => {
    const root = article()
    markNativeXrefs(root, kinds)
    const field = links(root, 'dd.field-odd a.reference.internal')
    expect(field.map((link) => [link.querySelector('code')!.textContent, kindOf(link)])).toEqual([['Window', 'class']])
  })

  it('leaves a reference that leaves the site and a signature', () => {
    const root = article()
    markNativeXrefs(root, kinds)
    expect(root.querySelector('a.reference.external')!.classList.contains('api-mention')).toBe(false)
    expect(root.querySelector('dt.sig .api-link-kind')).toBeNull()
  })

  it('does nothing the second time', () => {
    const root = article()
    markNativeXrefs(root, kinds)
    const once = root.innerHTML
    expect(markNativeXrefs(root, kinds)).toBe(0)
    expect(root.innerHTML).toBe(once)
  })

  it('is caught when a reference stays plain or takes the kind of its role, so the check above can fail', () => {
    expect(problems(article())).toContain(`${links(article())[0]!.href}: not a mention`)
    const root = article()
    markNativeXrefs(root, kinds)
    links(root)[0]!.querySelector('.api-link-kind')!.remove()
    expect(problems(root)).toEqual([`${links(root)[0]!.href}: the first mention is plain`])
    // Reading the kind off the role would call the property an attribute: the target's kind is what the page must say.
    const byRole = article()
    markNativeXrefs(byRole, { ...kinds, 'libtmux.Window.panes': 'attribute' })
    expect(kindOf(links(byRole).find((link) => target(link) === 'libtmux.Window.panes')!)).not.toBe(kinds['libtmux.Window.panes'])
  })
})

describe('the native shell script', () => {
  const script = readFileSync(new URL('../src/components/docs/NativeSphinxScript.astro', import.meta.url), 'utf8')
  const guarded = /try \{[^}]*markNativeXrefs\([^}]*\}\s*catch/

  it('marks the cross-references inside a guard, so a failure leaves its navigation and scroll tracking running', () => {
    expect(script).toMatch(guarded)
  })

  it('is caught when the call is not guarded, so the check above can fail', () => {
    expect(script.replace(/try \{/, '{').replace(/\} catch \(error\) \{[^}]*\}/, '}')).not.toMatch(guarded)
  })
})
