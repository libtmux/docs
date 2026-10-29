import { readFileSync } from 'node:fs'
import { experimental_AstroContainer } from 'astro/container'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { parameterId, symbolsForProduct, type ApiSymbol, type Param } from '@libtmux/api-model'
import { API_MODELS } from '../src/lib/api-models'
import { productApiRoots } from '../src/lib/product-api'
import { productAvailable, PORTS, type DocProduct } from '../src/lib/ports'
import { loadAstroTemplate } from './astro-templates'

const style = (name: string) => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), 'utf8')

interface Rule { media: string[]; selectors: string[]; declarations: Record<string, string> }

/**
 * The style rules of a stylesheet with the `@media` conditions around each.
 * Comments go first; quotes and parentheses keep a `;` or `{` inside a string or `url()` out of the split.
 */
function parseRules(source: string): Rule[] {
  const rules: Rule[] = []
  const stack: { prelude: string; declarations: Record<string, string> }[] = [{ prelude: '', declarations: {} }]
  let buffer = ''
  let quote = ''
  let parens = 0
  const declare = () => {
    const at = buffer.indexOf(':')
    if (at > 0 && stack.length > 1) stack.at(-1)!.declarations[buffer.slice(0, at).trim()] = buffer.slice(at + 1).trim()
    buffer = ''
  }
  for (const char of source.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (quote) { if (char === quote) quote = ''; buffer += char; continue }
    if (char === '"' || char === "'") { quote = char; buffer += char; continue }
    if (char === '(') parens++
    if (char === ')') parens--
    if (char === '{' && parens === 0) { stack.push({ prelude: buffer.trim(), declarations: {} }); buffer = '' }
    else if (char === '}' && parens === 0) {
      declare()
      const done = stack.pop()!
      if (Object.keys(done.declarations).length > 0) {
        const selectors: string[] = []
        let depth = 0
        let start = 0
        for (let i = 0; i < done.prelude.length; i++) {
          const c = done.prelude[i]
          if (c === '(' || c === '[') depth++
          if (c === ')' || c === ']') depth--
          if (c === ',' && depth === 0) { selectors.push(done.prelude.slice(start, i).trim()); start = i + 1 }
        }
        selectors.push(done.prelude.slice(start).trim())
        rules.push({
          media: stack.map((frame) => frame.prelude).filter((prelude) => prelude.startsWith('@media'))
            .map((prelude) => prelude.slice('@media'.length).replace(/\s+/g, ' ').trim()),
          selectors, declarations: done.declarations,
        })
      }
    } else if (char === ';' && parens === 0) declare()
    else buffer += char
  }
  return rules
}

const inFinePointer = (rule: Rule) => rule.media.some((media) => /\(hover: hover\)/.test(media) && /\(pointer: fine\)/.test(media))
const inMedia = (rule: Rule, feature: string) => rule.media.some((media) => media.includes(feature))
const hides = (rule: Rule) => rule.declarations.opacity === '0'
const shows = (rule: Rule) => rule.declarations.opacity === '1'

/** What a permalink revealed on a fine pointer owes touch, forced colours, focus and assistive technology. */
function revealViolations(css: string, owner: string, options: { rest: RegExp; focus: RegExp }): string[] {
  const rules = parseRules(css).filter((rule) => rule.selectors.some((selector) => selector.includes(owner)))
  const found: string[] = []
  const quiet = rules.filter((rule) => hides(rule) && rule.selectors.some((selector) => options.rest.test(selector)))
  if (quiet.length === 0) found.push('nothing hides the permalink at rest')
  if (rules.some((rule) => hides(rule) && !inFinePointer(rule))) found.push('the permalink is hidden outside a fine-pointer query')
  const revealing = rules.filter((rule) => shows(rule) && inFinePointer(rule)).flatMap((rule) => rule.selectors)
  for (const state of [':hover', ':focus-within', ':target']) {
    if (!revealing.some((selector) => selector.includes(state))) found.push(`a fine pointer does not reveal it on ${state}`)
  }
  if (!revealing.some((selector) => options.focus.test(selector))) found.push('a fine pointer does not reveal it on its own :focus-visible')
  if (!rules.some((rule) => shows(rule) && inMedia(rule, '(hover: none)'))) found.push('touch does not keep it visible')
  if (!rules.some((rule) => shows(rule) && inMedia(rule, '(forced-colors: active)'))) found.push('forced colours do not keep it visible')
  return found
}

/** The API heading hash: the contract above plus the ways a hash can be hidden from the keyboard. */
function headingViolations(css: string): string[] {
  const found = revealViolations(css, '.api-heading-link', { rest: /^\.api-heading-link$/, focus: /\.api-heading-link:focus-visible$/ })
  const rules = parseRules(css).filter((rule) => rule.selectors.some((selector) => selector.includes('.api-heading-link')))
  const revealing = rules.filter((rule) => shows(rule) && inFinePointer(rule)).flatMap((rule) => rule.selectors)
  // A section wrapper owns the id in ApiEntry, so the target is one level above the heading.
  if (!revealing.some((selector) => /:target\s*>\s*[^>]+>\s*\.api-heading-link$/.test(selector))) found.push('a target on a section wrapper does not reach its heading')
  for (const rule of rules) {
    if (rule.declarations.display === 'none') found.push('display: none takes the permalink out of the tab order')
    if (rule.declarations.visibility === 'hidden') found.push('visibility: hidden takes the permalink out of the tab order')
    if (rule.declarations['pointer-events'] === 'none') found.push('pointer-events: none blocks the permalink')
    if (rule.declarations.transition && !inMedia(rule, '(prefers-reduced-motion: no-preference)')) found.push('a transition runs under reduced motion')
  }
  return [...new Set(found)]
}

/** The prose permalinks: a section-row paragraph sign and the table-row link. */
function rowViolations(css: string): string[] {
  return [
    ...revealViolations(css, '.row-label-link::after', { rest: /\.row-label-link::after$/, focus: /\.row-label-link:focus-visible::after$/ }),
    ...revealViolations(css, '.row-anchor-link', { rest: /\.row-anchor-link$/, focus: /\.row-anchor-link:focus-visible$/ }),
  ]
}

/** The row rules of global.css. */
const rowRules = (css: string) => css.slice(css.indexOf('.prose .row-label-link {'), css.indexOf('/*\n * Top-nav chips'))

// The stylesheets as they stood before permalinks were revealed on demand.
const MAIN_HEADINGS = `/* Shared API and glossary permalinks stay beside the heading label. */
.api-heading-link {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-inline-size: 1.5rem;
  min-block-size: 1.5rem;
  margin-inline-start: 0.25rem;
  padding: 0.2rem 0.35rem;
  color: var(--color-muted);
  font-size: 0.875rem;
  font-weight: 400;
  text-decoration: none;
}
.api-heading-link:hover { color: var(--color-link); }
.api-heading-link:focus-visible { outline: 2px solid var(--focus-ring-color); outline-offset: 2px; }
`
const MAIN_ROWS = `.prose .row-label-link { position: relative; display: inline-block; color: inherit; text-decoration: none; }
.prose .row-label-link:hover { text-decoration: underline; }
.prose .row-label-link::after {
  content: '¶';
  position: absolute;
  left: calc(100% + .25rem);
  top: 0;
  font-weight: 400;
  opacity: 0;
}
.anchored-entry:is(:hover, :target, :focus-within) .row-label-link::after { opacity: 1; }
.prose .row-anchor-link {
  position: absolute;
  margin-inline-start: .3em;
  padding-inline: .2em;
  color: var(--theme-primary);
  font-weight: 400;
  text-decoration: none;
  opacity: 0;
}
.anchored-entry:is(:hover, :target, :focus-within) .row-anchor-link { opacity: 1; }
`

const headings = style('api-headings.css')
const rows = rowRules(style('global.css'))

/** `css` with `from` replaced by `to`; the edit must land, or the control proves nothing. */
const edit = (css: string, from: string | RegExp, to: string) => {
  const changed = css.replace(from, to)
  expect(changed, `${from} is in the stylesheet`).not.toBe(css)
  return changed
}

describe('API heading permalinks', () => {
  it('reveal on a fine pointer and stay in view everywhere else', () => {
    expect(headingViolations(headings)).toEqual([])
  })

  it('sit at opacity 0 only inside the fine-pointer query', () => {
    const quiet = parseRules(headings).filter(hides)
    expect(quiet.length).toBeGreaterThan(0)
    for (const rule of quiet) expect(inFinePointer(rule), rule.selectors.join()).toBe(true)
  })

  it('reveal on hover, focus within, own focus and target', () => {
    const revealing = parseRules(headings).filter((rule) => shows(rule) && inFinePointer(rule)).flatMap((rule) => rule.selectors).join('\n')
    for (const state of [':hover', ':focus-within', ':target', '.api-heading-link:focus-visible']) expect(revealing).toContain(state)
  })

  it('force the hash visible under hover: none and forced colours', () => {
    const forced = parseRules(headings).filter(shows)
    expect(forced.some((rule) => inMedia(rule, '(hover: none)'))).toBe(true)
    expect(forced.some((rule) => inMedia(rule, '(forced-colors: active)'))).toBe(true)
  })

  it('never takes the link out of the tab order', () => {
    for (const rule of parseRules(headings)) {
      expect(rule.declarations.display, rule.selectors.join()).not.toBe('none')
      expect(rule.declarations.visibility, rule.selectors.join()).not.toBe('hidden')
      expect(rule.declarations['pointer-events'], rule.selectors.join()).not.toBe('none')
    }
  })

  describe('controls', () => {
    it('fail against the stylesheet before permalinks were revealed', () => {
      expect(headingViolations(MAIN_HEADINGS)).toEqual([
        'nothing hides the permalink at rest',
        'a fine pointer does not reveal it on :hover',
        'a fine pointer does not reveal it on :focus-within',
        'a fine pointer does not reveal it on :target',
        'a fine pointer does not reveal it on its own :focus-visible',
        'touch does not keep it visible',
        'forced colours do not keep it visible',
        'a target on a section wrapper does not reach its heading',
      ])
    })

    it.each([
      ['hiding it on every pointer', (css: string) => edit(css, '@media (hover: hover) and (pointer: fine) {', '@media screen {'),
        'the permalink is hidden outside a fine-pointer query'],
      ['no reveal on hover', (css: string) => edit(css, ':is(:hover, :focus-within, :target) >', ':is(:focus-within, :target) >'),
        'a fine pointer does not reveal it on :hover'],
      ['no reveal on focus within', (css: string) => edit(css, ':is(:hover, :focus-within, :target) >', ':is(:hover, :target) >'),
        'a fine pointer does not reveal it on :focus-within'],
      ['no reveal on target', (css: string) => edit(edit(css, ':is(:hover, :focus-within, :target) >', ':is(:hover, :focus-within) >'), /\s*:target > :is\(h2, h3, p\) > \.api-heading-link/, ''),
        'a fine pointer does not reveal it on :target'],
      ['no reveal through a wrapper target', (css: string) => edit(css, /,\s*:target > :is\(h2, h3, p\) > \.api-heading-link/, ''),
        'a target on a section wrapper does not reach its heading'],
      ['no reveal on its own focus', (css: string) => edit(css, '.api-heading-link:focus-visible,\n  :is(', ':is('),
        'a fine pointer does not reveal it on its own :focus-visible'],
      ['hiding it from touch', (css: string) => edit(css, '@media (hover: none), (forced-colors: active)', '@media (forced-colors: active)'),
        'touch does not keep it visible'],
      ['hiding it from forced colours', (css: string) => edit(css, '@media (hover: none), (forced-colors: active)', '@media (hover: none)'),
        'forced colours do not keep it visible'],
      ['display: none at rest', (css: string) => `${css}\n.api-heading-link { display: none }`,
        'display: none takes the permalink out of the tab order'],
      ['visibility: hidden at rest', (css: string) => `${css}\n.api-heading-link { visibility: hidden }`,
        'visibility: hidden takes the permalink out of the tab order'],
      ['pointer-events: none at rest', (css: string) => `${css}\n.api-heading-link { pointer-events: none }`,
        'pointer-events: none blocks the permalink'],
      ['a transition that ignores reduced motion', (css: string) => `${css}\n.api-heading-link { transition: opacity .2s }`,
        'a transition runs under reduced motion'],
    ])('fail with %s', (_name, mutate, violation) => {
      expect(headingViolations(mutate(headings))).toContain(violation)
    })

    it('accept a fade that waits for motion to be allowed', () => {
      const faded = `${headings}\n@media (prefers-reduced-motion: no-preference) { .api-heading-link { transition: opacity .15s } }`
      expect(headingViolations(faded)).toEqual([])
    })

    it('read the media condition around a rule, not the rule text', () => {
      const [rule] = parseRules('@media (hover: hover) and (pointer: fine) { a, b:is(c, d) { opacity: 0; content: "};" } }')
      expect(rule).toEqual({ media: ['(hover: hover) and (pointer: fine)'], selectors: ['a', 'b:is(c, d)'],
        declarations: { opacity: '0', content: '"};"' } })
    })
  })
})

describe('prose row permalinks', () => {
  it('reveal on a fine pointer and stay in view everywhere else', () => {
    expect(rowViolations(rows)).toEqual([])
  })

  it('keep the touch path for both the section sign and the table-row link', () => {
    const touch = parseRules(rows).filter((rule) => shows(rule) && inMedia(rule, '(hover: none)')).flatMap((rule) => rule.selectors).join('\n')
    expect(touch).toContain('.row-label-link::after')
    expect(touch).toContain('.row-anchor-link')
  })

  describe('controls', () => {
    it('fail against the stylesheet before touch had a path', () => {
      const found = rowViolations(MAIN_ROWS)
      expect(found).toContain('the permalink is hidden outside a fine-pointer query')
      expect(found).toContain('touch does not keep it visible')
      expect(found).toContain('forced colours do not keep it visible')
      expect(found).toContain('a fine pointer does not reveal it on its own :focus-visible')
    })

    it.each([
      ['hiding both on every pointer', (css: string) => edit(css, '@media (hover: hover) and (pointer: fine) {', '@media screen {'),
        'the permalink is hidden outside a fine-pointer query'],
      ['no touch path', (css: string) => edit(css, '@media (hover: none), (forced-colors: active)', '@media (forced-colors: active)'),
        'touch does not keep it visible'],
      ['no reveal on the link\'s own focus', (css: string) => edit(css, /,\s*\.prose \.row-anchor-link:focus-visible \{ opacity: 1; \}/, ' {}'),
        'a fine pointer does not reveal it on its own :focus-visible'],
    ])('fail with %s', (_name, mutate, violation) => {
      expect(rowViolations(mutate(rows))).toContain(violation)
    })
  })
})

const windows: Window[] = []
afterEach(async () => { for (const win of windows.splice(0)) await win.happyDOM.abort() })

/** The fragment each permalink in `html` names and the element that owns the id. */
function permalinks(html: string) {
  const win = new Window({ url: 'https://libtmux.org/en/py/latest/reference/' })
  windows.push(win)
  win.document.body.innerHTML = html
  const ids = [...win.document.querySelectorAll('[id]')].map((node) => node.id)
  const links = [...win.document.querySelectorAll('a.api-heading-link')].map((link) => ({
    href: link.getAttribute('href')!, label: link.getAttribute('aria-label')!, owner: link.closest('[id]')?.id,
    resolves: ids.filter((id) => id === decodeURIComponent(link.getAttribute('href')!.slice(1))).length,
  }))
  return { ids, links }
}

describe('repeated fragments', () => {
  it('give every glossary heading its own id and a link that resolves to it alone', async () => {
    const template = await loadAstroTemplate('components/api/ApiGlossaryContent.astro')
    const container = await experimental_AstroContainer.create()
    const contexts = ['/en/reference/glossary/', ...PORTS.map((port) => `/en/${port.slug}/latest/reference/glossary/`),
      ...PORTS.filter((port) => productAvailable(port, 'mcp')).map((port) => `/en/${port.slug}/latest/mcp/reference/glossary/`)]
    for (const contextPath of contexts) {
      const { ids, links } = permalinks(await container.renderToString(template as never, { props: { contextPath } }))
      expect(links.length, contextPath).toBeGreaterThan(0)
      expect(new Set(ids).size, `${contextPath}: ids are unique`).toBe(ids.length)
      expect(new Set(links.map((link) => link.href)).size, `${contextPath}: links are unique`).toBe(links.length)
      for (const link of links) {
        expect(link.resolves, `${contextPath}: ${link.href} reaches one element`).toBe(1)
        expect(link.owner, `${contextPath}: ${link.label} sits in the heading it names`).toBe(link.href.slice(1))
      }
    }
  }, 60_000)

  it('keeps one id for a parameter name that repeats and points every permalink at it', async () => {
    const template = await loadAstroTemplate('components/api/ApiCommandParameters.astro')
    const container = await experimental_AstroContainer.create()
    const symbol: ApiSymbol = { id: 'demo.Get-Thing', name: 'Get-Thing', kind: 'function', modifiers: [], signatures: [], source: { file: 'demo.ps1' } }
    const parameter = (name: string, type: string): Param => ({ name, type })
    // A name that repeats across overloads is one parameter to the reader.
    const params = [parameter('Name', 'string'), parameter('Path', 'string'), parameter('Name', 'string[]')]
    const { ids, links } = permalinks(await container.renderToString(template as never, { props: { params, symbol, index: undefined, first: undefined } }))
    expect(links.map((link) => link.href)).toEqual(params.map((p) => `#${encodeURIComponent(parameterId(symbol, p.name))}`))
    expect(ids.filter((id) => id === parameterId(symbol, 'Name'))).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    for (const link of links) expect(link.resolves, link.href).toBe(1)
  })
})

/** A product's root declaration that lists members on its page. */
function productWithMembers() {
  for (const port of PORTS) {
    const model = API_MODELS[port.slug]
    if (!model) continue
    for (const product of ['mcp', 'workspace'] as DocProduct[]) {
      if (!productAvailable(port, product)) continue
      for (const symbol of productApiRoots(model, product)) {
        const members = symbolsForProduct(model, product).filter((entry) => entry.parent === symbol.id)
        if (members.length > 0) return { model, symbol, members }
      }
    }
  }
  throw new Error('no product page lists members')
}

describe('product reference pages', () => {
  it('give their Members heading the permalink and count of an API section heading', async () => {
    const { model, symbol, members } = productWithMembers()
    const template = await loadAstroTemplate('components/api/ProductApiPage.astro')
    const container = await experimental_AstroContainer.create()
    const win = new Window({ url: 'https://libtmux.org/en/' })
    windows.push(win)
    win.document.body.innerHTML = await container.renderToString(template as never, {
      props: { model, symbol, version: 'latest' }, request: new Request('https://libtmux.org/en/'),
    })
    const heading = win.document.querySelector('h2#api-members')!
    expect(heading, 'the Members heading has an id').not.toBeNull()
    expect(heading.classList.contains('api-section-heading')).toBe(true)
    expect(heading.firstChild?.textContent).toBe('Members')
    expect(heading.querySelector('.api-section-count')?.textContent).toBe(String(members.length))
    const link = heading.querySelector('a.api-heading-link')!
    expect(link.getAttribute('href')).toBe('#api-members')
    expect(link.getAttribute('aria-label')).toBe('Link to Members')
    // The count sits between the label and the hash, as it does on a type page.
    expect([...heading.children].map((child) => child.className)).toEqual(['api-section-count', 'api-heading-link'])
  }, 60_000)
})
