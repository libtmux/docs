import { readFileSync } from 'node:fs'
import { experimental_AstroContainer } from 'astro/container'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { parameterId, symbolsForProduct, type ApiSymbol, type Param } from '@libtmux/api-model'
import { API_MODELS } from '../src/lib/api-models'
import { splitFieldMembers } from '../src/lib/api-sections'
import { productApiHref, productApiRoots } from '../src/lib/product-api'
import { symbolMarkdown } from '../src/lib/symbol-markdown'
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

/**
 * The elements a selector names as holding `owner`, with whether the owner is their child.
 * The state belongs to the holder: `:is(:hover) > .link` reveals the link while its heading is hovered,
 * and `.link:is(:hover)` would reveal it only while the pointer is on the hash itself.
 */
function holders(selectors: string[], owner: string) {
  return selectors.flatMap((selector) => {
    if (!selector.endsWith(owner)) return []
    const before = selector.slice(0, -owner.length)
    const combinator = /\s*[>+~]\s*$|\s+$/.exec(before)
    return combinator ? [{ holder: before.slice(0, combinator.index), child: combinator[0].includes('>') }] : []
  })
}

/** What a permalink revealed on a fine pointer owes touch, forced colours, focus and assistive technology. */
function revealViolations(css: string, owner: string, options: { rest: RegExp; focus: RegExp; child?: boolean }): string[] {
  const rules = parseRules(css).filter((rule) => rule.selectors.some((selector) => selector.includes(owner)))
  const found: string[] = []
  const quiet = rules.filter((rule) => hides(rule) && rule.selectors.some((selector) => options.rest.test(selector)))
  if (quiet.length === 0) found.push('nothing hides the permalink at rest')
  if (rules.some((rule) => hides(rule) && !inFinePointer(rule))) found.push('the permalink is hidden outside a fine-pointer query')
  const revealing = rules.filter((rule) => shows(rule) && inFinePointer(rule)).flatMap((rule) => rule.selectors)
  // The holder is one element: a rule through a wrapper (`:target > h2 > link`) does not stand for the heading's own target.
  const direct = holders(revealing, owner).filter((entry) => (!options.child || entry.child) && !entry.holder.includes('>'))
  for (const state of [':hover', ':focus-within', ':target']) {
    if (!direct.some((entry) => entry.holder.includes(state))) found.push(`no element holding the permalink reveals it on ${state}`)
  }
  if (!revealing.some((selector) => options.focus.test(selector))) found.push('a fine pointer does not reveal it on its own :focus-visible')
  if (!rules.some((rule) => shows(rule) && inMedia(rule, '(hover: none)'))) found.push('touch does not keep it visible')
  if (!rules.some((rule) => shows(rule) && inMedia(rule, '(forced-colors: active)'))) found.push('forced colours do not keep it visible')
  return found
}

/** The API heading hash: the contract above plus the ways a hash can be hidden from the keyboard. */
function headingViolations(css: string): string[] {
  const found = revealViolations(css, '.api-heading-link', { rest: /^\.api-heading-link$/, focus: /\.api-heading-link:focus-visible$/, child: true })
  const rules = parseRules(css).filter((rule) => rule.selectors.some((selector) => selector.includes('.api-heading-link')))
  const revealing = rules.filter((rule) => shows(rule) && inFinePointer(rule)).flatMap((rule) => rule.selectors)
  // A section wrapper owns the id in ApiEntry, so the target is one level above the heading.
  if (!holders(revealing, '.api-heading-link').some((entry) => entry.child && entry.holder.includes(':target') && entry.holder.includes('>'))) {
    found.push('a target on a section wrapper does not reach its heading')
  }
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

  it('reveal from the heading that holds the hash on hover, focus within and target, and on its own focus', () => {
    const revealing = parseRules(headings).filter((rule) => shows(rule) && inFinePointer(rule)).flatMap((rule) => rule.selectors)
    const direct = holders(revealing, '.api-heading-link').filter((entry) => entry.child && !entry.holder.includes('>'))
    for (const state of [':hover', ':focus-within', ':target']) {
      expect(direct.some((entry) => entry.holder.includes(state)), `${state} is on the heading, the link its child`).toBe(true)
    }
    expect(revealing).toContain('.api-heading-link:focus-visible')
    // No state is carried by the hash alone, which a pointer elsewhere on the heading never reaches.
    for (const selector of revealing) expect(selector, selector).not.toMatch(/\.api-heading-link:(hover|focus-within|target|is\()/)
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
        'no element holding the permalink reveals it on :hover',
        'no element holding the permalink reveals it on :focus-within',
        'no element holding the permalink reveals it on :target',
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
        'no element holding the permalink reveals it on :hover'],
      ['no reveal on focus within', (css: string) => edit(css, ':is(:hover, :focus-within, :target) >', ':is(:hover, :target) >'),
        'no element holding the permalink reveals it on :focus-within'],
      ['no reveal on target', (css: string) => edit(edit(css, ':is(:hover, :focus-within, :target) >', ':is(:hover, :focus-within) >'), /\s*:target > :is\(h2, h3, p\) > \.api-heading-link/, ''),
        'no element holding the permalink reveals it on :target'],
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

    it('fail with the reveal moved onto the hash itself, which only its own hover would reach', () => {
      const moved = edit(headings, ':is(:hover, :focus-within, :target) > .api-heading-link,', '.api-heading-link:is(:hover, :focus-within, :target),')
      expect(headingViolations(moved)).toEqual(expect.arrayContaining([
        'no element holding the permalink reveals it on :hover',
        'no element holding the permalink reveals it on :focus-within',
        'no element holding the permalink reveals it on :target',
      ]))
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

    it('fail with the section sign revealed from the link itself', () => {
      const moved = edit(rows, '.anchored-entry:is(:hover, :target, :focus-within) .row-label-link::after,', '.prose .row-label-link:is(:hover, :target, :focus-within)::after,')
      expect(rowViolations(moved)).toEqual(expect.arrayContaining([
        'no element holding the permalink reveals it on :hover',
        'no element holding the permalink reveals it on :target',
        'no element holding the permalink reveals it on :focus-within',
      ]))
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

describe('prose heading anchors', () => {
  const full = style('global.css')
  const touch = /@media \(hover: none\) \{\s*\.anchor-link \{\s*@apply opacity-50;/
  const forced = /@media \(forced-colors: active\) \{\s*\.anchor-link \{\s*@apply opacity-100;/

  it('stay in view on touch and in forced colours', () => {
    expect(full).toMatch(touch)
    expect(full).toMatch(forced)
  })

  it('fail without the forced-colours rule', () => {
    expect(edit(full, forced, '')).not.toMatch(forced)
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

  describe('with the owner renderer', () => {
    // Each entry and the table's cells draw only what the assertions read: which symbol, as a member, linked where.
    const load = () => loadAstroTemplate('components/api/ProductApiPage.astro', {
      real: ['components/api/ApiScalarMembers.astro'],
      stubs: {
        'components/api/ApiEntry.astro': `---
const { symbol, member, nameHref } = Astro.props
---
<dl data-entry={symbol.id} data-member={String(Boolean(member))} data-name-href={nameHref}></dl>`,
        'components/api/ApiType.astro': '---\nconst { type } = Astro.props\n---\n{type}',
        'components/api/ApiDoc.astro': '---\nconst { text } = Astro.props\n---\n{text}',
      },
    })
    async function render(port: string, id: string) {
      const model = API_MODELS[port]!
      const symbol = model.symbols.find((entry) => entry.id === id)!
      const members = symbolsForProduct(model, symbol.product as DocProduct).filter((entry) => entry.parent === id)
      const container = await experimental_AstroContainer.create()
      const win = new Window({ url: 'https://libtmux.org/en/' })
      windows.push(win)
      win.document.body.innerHTML = await container.renderToString(await load() as never, {
        props: { model, symbol, version: 'latest' }, request: new Request('https://libtmux.org/en/'),
      })
      return { model, symbol, members, document: win.document }
    }
    // The raw rule, apart from the predicate under test: a typed attribute or non-static property.
    const isField = (member: ApiSymbol) => ['attribute', 'property'].includes(member.kind) && member.type !== undefined && !member.modifiers.includes('static')

    // A struct and a class with methods beside their fields, and a class of only properties, each in its port's word.
    it.each([
      ['rs', 'config.Workspace', 'Fields'], ['go', 'workspace.Workspace', 'Fields'],
      ['csharp', 'LibTmux.Workspace.WorkspaceAction', 'Properties'], ['csharp', 'LibTmux.Workspace.WorkspaceActionOutcome', 'Properties'],
    ])('%s %s lists its typed fields as %s in a counted table ahead of its member details', async (port, id, word) => {
      const { model, members, document, symbol } = await render(port, id)
      const fields = members.filter(isField)
      expect(fields.length).toBeGreaterThan(0)
      expect(splitFieldMembers(symbol, members, port).fields.map((entry) => entry.id)).toEqual(fields.map((entry) => entry.id))

      const heading = document.querySelector('h2#api-fields')!
      expect(heading.classList.contains('api-section-heading')).toBe(true)
      expect(heading.firstChild?.textContent).toBe(word)
      expect(heading.querySelector('.api-section-count')?.textContent).toBe(String(fields.length))
      expect(heading.querySelector('a.api-heading-link')?.getAttribute('href')).toBe('#api-fields')
      expect(heading.querySelector('a.api-heading-link')?.getAttribute('aria-label')).toBe(`Link to ${word}`)
      expect([...heading.children].map((child) => child.className)).toEqual(['api-section-count', 'api-heading-link'])

      // Its own wrapper: .api-members would hand the Fields bar to the sticky Members logic.
      const block = heading.parentElement!
      expect(block.classList.contains('api-field-table')).toBe(true)
      expect(block.classList.contains('api-members')).toBe(false)
      expect([...block.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual(['Name', 'Type', 'Description'])
      // The article is prose, whose table rule makes a table a block that stops short of its box; `table` restores the grid.
      expect(block.querySelector('table.api-scalar-members')?.classList.contains('table')).toBe(true)
      // The box a container query measures, so a narrow page stacks the rows.
      expect(block.querySelector(':scope > .api-scalar-box > table.api-scalar-members')).not.toBeNull()
      expect(block.querySelector('caption')?.textContent).toContain(` ${word.toLowerCase()}`)
      const rows = [...block.querySelectorAll('tbody tr')]
      expect(rows.map((row) => row.id)).toEqual(fields.map((field) => `member-${field.publicId ?? field.id}`))
      rows.forEach((row, i) => {
        const field = fields[i]!
        expect(row.querySelector('th a')?.textContent).toBe(field.name)
        expect(row.querySelector('th a')?.getAttribute('href')).toBe(productApiHref(model, field, 'latest'))
        expect(row.querySelector('td:nth-child(2)')?.textContent).toBe(field.type)
        expect(row.querySelector('td:last-child')?.textContent).toBe(field.doc?.summary ?? '')
      })

      // The Markdown export of the same declaration lists the same fields.
      const markdown = symbolMarkdown({ model, symbol, hrefFor: (entry) => productApiHref(model, entry, 'latest') }).split('\n')
      const start = markdown.indexOf(`## ${word}`)
      const end = markdown.findIndex((line, i) => i > start && line.startsWith('## '))
      const exported = markdown.slice(start, end < 0 ? undefined : end).filter((line) => line.startsWith('| [`'))
        .map((line) => /\]\(([^)]*)\)/.exec(line)![1])
      expect(exported.toSorted()).toEqual(rows.map((row) => row.querySelector('th a')!.getAttribute('href')!).toSorted())

      // The entries keep every member, fields included, so under the table they are its detail; the count is theirs.
      const membersHeading = document.querySelector('.api-members > h2#api-members')!
      expect(membersHeading.firstChild?.textContent).toBe('Member details')
      expect(membersHeading.querySelector('a.api-heading-link')?.getAttribute('aria-label')).toBe('Link to Member details')
      expect(membersHeading.querySelector('.api-section-count')?.textContent).toBe(String(members.length))
      expect(heading.compareDocumentPosition(membersHeading) & 4, 'Fields come before Members').toBeGreaterThan(0)
      const ids = [...document.querySelectorAll('[id]')].map((element) => element.id)
      expect(new Set(ids).size, 'every id on the page is unique').toBe(ids.length)
    }, 60_000)

    it('keeps one entry per member, in order, under the Members heading', async () => {
      const { model, members, document } = await render('rs', 'config.Workspace')
      const entries = [...document.querySelectorAll('.api-members > dl[data-entry]')]
      expect(entries.map((entry) => entry.getAttribute('data-entry'))).toEqual(members.map((member) => member.id))
      expect(entries.every((entry) => entry.getAttribute('data-member') === 'true')).toBe(true)
      expect(entries.map((entry) => entry.getAttribute('data-name-href'))).toEqual(members.map((member) => productApiHref(model, member, 'latest')))
      // The page's own declaration stays above both blocks.
      expect(document.querySelector('.api-reference-content > dl[data-entry="config.Workspace"]')).not.toBeNull()
    }, 60_000)

    it('leaves a port without a field table with the counted Members and its entries alone', async () => {
      const { members, document } = await render('swift', 'CallerIdentity')
      expect(members.filter(isField).length).toBeGreaterThan(0)
      expect(document.querySelector('#api-fields, .api-field-table, table')).toBeNull()
      expect(document.querySelector('.api-members > h2#api-members')?.firstChild?.textContent).toBe('Members')
      expect(document.querySelector('.api-members > h2#api-members .api-section-count')?.textContent).toBe(String(members.length))
      expect(document.querySelectorAll('.api-members > dl[data-entry]')).toHaveLength(members.length)
    }, 60_000)
  })
})
