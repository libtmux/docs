import { Window, type Element, type HTMLElement, type Node } from 'happy-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LinkPreview } from '../src/lib/link-preview'
import { cardHtml, paintCard, previewCard, previewLabel, PREVIEW_SLOTS, type CardNode } from '../src/lib/link-preview-card'
import { PREVIEW_SIGNATURE_CHARS, PREVIEW_SIGNATURE_LINES } from '../src/lib/preview-signature'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'
import { cardPayloads as payloads } from './link-preview-payloads'

/**
 * One card, however it reaches the page.
 *
 * The page that carries a card in its own HTML (`LinkPreview.astro`, the keyword help of a declaration) and the
 * browser, which paints one reused card for every reference link, both read `previewCard`. These tests render each
 * kind of payload both ways and require the same elements, classes, attributes and text.
 */
const ORIGIN = 'https://libtmux.org'
const ID = 'reference-link-preview'

let win: Window
beforeEach(() => {
  win = new Window({ url: `${ORIGIN}/en/ts/latest/guides/` })
  vi.stubGlobal('document', win.document)
})
afterEach(async () => {
  await win.happyDOM.abort()
  vi.unstubAllGlobals()
})

/** An element's markup with its attributes in a fixed order and its links resolved, so that only a real difference shows. */
function canonical(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? ''
  const element = node as Element
  const attributes = element.getAttributeNames().sort().map((name) => {
    const value = element.getAttribute(name)!
    return ` ${name}="${name === 'href' ? new URL(value, ORIGIN).href : value}"`
  }).join('')
  return `<${element.localName}${attributes}>${[...element.childNodes].map(canonical).join('')}</${element.localName}>`
}
const inside = (element: Element) => [...element.childNodes].map(canonical).join('')

/** `paintCard` on a card of the test window, which the browser's own types do not describe. */
const paint = (shell: Element, ...rest: Parameters<typeof paintCard> extends [unknown, ...infer Rest] ? Rest : never) => paintCard(shell as unknown as globalThis.HTMLElement, ...rest)

/** The component compiles once; each card is rendered from it. */
let component: ReturnType<typeof loadAstroTemplate> | undefined

/** The card as the page carries it: the component's own HTML, as the keyword help of a declaration is written. */
async function staticCard(preview: LinkPreview | undefined) {
  component ??= loadAstroTemplate('components/LinkPreview.astro')
  const html = await renderAstroTemplate(await component, { props: { id: ID, preview } })
  win.document.body.innerHTML = html
  return win.document.getElementById(ID)!
}

/** The card as the browser has it: the empty card of the page, painted with the payload. */
async function paintedCard(preview: LinkPreview, options: { expanded?: boolean } = {}) {
  const shell = await staticCard(undefined)
  paint(shell, preview, { id: ID, ...options })
  return shell
}

describe('one card, two renderers', () => {
  it('reads the same from the page\'s own HTML as it does painted into the browser\'s card', { timeout: 30_000 }, async () => {
    for (const [name, preview] of await payloads()) {
      const direct = await staticCard(preview)
      const markup = inside(direct)
      const painted = await paintedCard(preview)
      expect(inside(painted), name).toBe(markup)
      // The shared description is what the component wrote, so the two cannot disagree about it either.
      const fresh = win.document.createElement('span')
      fresh.innerHTML = cardHtml(previewCard(preview, { id: ID }))
      expect(inside(fresh), name).toBe(markup)
    }
  })

  it('keeps the same card when the name is expanded and when the link adds context', async () => {
    const preview = (await payloads()).find(([name]) => name === 'API name long enough to abbreviate')![1]
    const shell = await paintedCard(preview, { expanded: true })
    const expanded = win.document.createElement('span')
    expanded.innerHTML = cardHtml(previewCard(preview, { id: ID, expanded: true }))
    expect(inside(shell)).toBe(inside(expanded))
    expect(shell.querySelector('[data-preview-title]')!.textContent).toBe(preview.title)
    expect(shell.querySelector('[data-preview-expand]')!.getAttribute('aria-expanded')).toBe('true')
    paint(shell, preview, { id: ID, context: 'Inherited from Base.', href: `${ORIGIN}/en/x/#member` })
    const context = win.document.createElement('span')
    context.innerHTML = cardHtml(previewCard(preview, { id: ID, context: 'Inherited from Base.', href: `${ORIGIN}/en/x/#member` }))
    expect(inside(shell)).toBe(inside(context))
    expect(shell.querySelector('[data-preview-detail]')!.textContent).toContain('Inherited from Base.')
    expect(shell.querySelector('[data-preview-open]')!.getAttribute('href')).toBe(`${ORIGIN}/en/x/#member`)
  })

  it('paints each slot in the element the card already has', async () => {
    const shell = await staticCard(undefined)
    const before = PREVIEW_SLOTS.map((slot) => shell.querySelector(`[data-preview-${slot}]`))
    expect(before.every(Boolean)).toBe(true)
    const [, preview] = (await payloads())[0]
    paint(shell, preview, { id: ID })
    expect(PREVIEW_SLOTS.map((slot) => shell.querySelector(`[data-preview-${slot}]`))).toEqual(before)
    paint(shell, { schema: 1, title: 'Bare', description: 'No signature, kind or footer.', href: '/en/x/' }, { id: ID })
    expect(PREVIEW_SLOTS.map((slot) => shell.querySelector(`[data-preview-${slot}]`))).toEqual(before)
    // Nothing of the first card survives in the slots that the second leaves empty.
    for (const slot of ['kind', 'signature', 'footer', 'expand', 'detail']) expect(shell.querySelector(`[data-preview-${slot}]`)!.hasAttribute('hidden'), slot).toBe(true)
    expect(shell.querySelector('[data-preview-kind]')!.children).toHaveLength(0)
    expect(shell.querySelector('[data-preview-signature]')!.textContent).toBe('')
  })

  it('paints one payload after another as a fresh card reads, for every pair of kinds', { timeout: 30_000 }, async () => {
    const all = await payloads()
    const expected = new Map(all.map(([name, preview]) => {
      const fresh = win.document.createElement('span')
      fresh.innerHTML = cardHtml(previewCard(preview, { id: ID }))
      return [name, inside(fresh)] as const
    }))
    await staticCard(undefined)
    const blankHtml = win.document.body.innerHTML
    for (const [firstName, first] of all) {
      for (const [secondName, second] of all) {
        win.document.body.innerHTML = blankHtml
        const shell = win.document.getElementById(ID)!
        paint(shell, first, { id: ID })
        paint(shell, second, { id: ID })
        // Nothing of the first card is left in the second: no style, language or class of a highlight, no chip, no footer.
        expect(inside(shell), `${firstName} then ${secondName}`).toBe(expected.get(secondName))
      }
    }
  })

  it('shows what a stale slot would leave, so that the sequence above can fail', async () => {
    const all = new Map(await payloads())
    const highlighted = all.get('API method with a named type')!
    const plain = all.get('page with no kind')!
    expect(highlighted.signatureHighlight).toBeDefined()
    const fresh = await staticCard(plain)
    const expected = inside(fresh)
    const shell = await paintedCard(highlighted)
    const signature = shell.querySelector('[data-preview-signature]')!
    expect(signature.hasAttribute('style') && signature.hasAttribute('data-language') && signature.classList.contains('lm-highlighted')).toBe(true)
    paint(shell, plain, { id: ID })
    // The control: painted over, the slot is as a fresh card has it.
    expect(inside(shell)).toBe(expected)
    for (const stale of [['style', '--shiki-light:#000'], ['data-language', 'rust'], ['class', 'reference-link-preview__signature lm-highlighted']] as const) {
      const leftover = await paintedCard(highlighted)
      paint(leftover, plain, { id: ID })
      leftover.querySelector('[data-preview-signature]')!.setAttribute(stale[0], stale[1])
      expect(inside(leftover), stale[0]).not.toBe(expected)
    }
    // A chip left in the kind slot and a footer left on the card are seen the same way.
    const chipped = await paintedCard(highlighted)
    paint(chipped, plain, { id: ID })
    chipped.querySelector('[data-preview-kind]')!.removeAttribute('hidden')
    expect(inside(chipped)).not.toBe(expected)
  })

  it('notices a card that has drifted from the description, and passes the card that has not', async () => {
    const [, preview] = (await payloads())[0]
    const expected = inside(await staticCard(preview))
    // The control: the browser's card as the page makes it.
    expect(inside(await paintedCard(preview))).toBe(expected)
    // The frame outside the slots is the page's own: a browser card with another class is not the same card.
    const frame = await staticCard(undefined)
    frame.querySelector('.reference-link-preview__prose')!.className = 'reference-link-preview__prose drifted'
    paint(frame, preview, { id: ID })
    expect(inside(frame)).not.toBe(expected)
    // A card without a slot cannot show what the slot holds.
    const missing = await staticCard(undefined)
    missing.querySelector('[data-preview-footer]')!.remove()
    paint(missing, preview, { id: ID })
    expect(inside(missing)).not.toBe(expected)
  })

  it('writes every kind of payload into the card\'s regions in order: header, declaration, summary, footer', async () => {
    const [, preview] = (await payloads())[0]
    const shell = await staticCard(preview)
    const order = ['.reference-link-preview__heading', '.reference-link-preview__signature', '.reference-link-preview__prose', '.reference-link-preview__footer']
    const children = [...shell.children]
    const places = order.map((selector) => children.indexOf(shell.querySelector(selector)!))
    expect(places.every((place) => place >= 0)).toBe(true)
    expect(places).toEqual([...places].sort((a, b) => a - b))
    expect(shell.querySelector('.reference-link-preview__heading .api-leg')!.textContent).toContain(preview.kind)
    expect(shell.querySelector('[data-preview-footer]')!.textContent).toBe(preview.footer!.join(' · '))
  })
})

describe('a declaration with no summary', () => {
  const named = async (name: string) => (await payloads()).find(([entry]) => entry === name)![1]

  it.each(['declaration with a signature and no summary', 'declaration with nothing under its name'])('%s: shows its signature if it has one, and no placeholder body', async (name) => {
    const preview = await named(name)
    expect(preview.description).toBe('')
    for (const shell of [await staticCard(preview), await paintedCard(preview)]) {
      const summary = shell.querySelector('[data-preview-description]')!
      expect(summary.hasAttribute('hidden'), name).toBe(true)
      expect(summary.textContent, name).toBe('')
      expect(shell.textContent, name).not.toContain('Read the reference')
      const signature = shell.querySelector('[data-preview-signature]')!
      expect(signature.hasAttribute('hidden'), name).toBe(!preview.signature)
      expect(signature.textContent, name).toBe(preview.signature ?? '')
    }
  })

  it('shows the summary again on the card after one that had none, and keeps the context line on a card with only that', async () => {
    const shell = await paintedCard(await named('declaration with nothing under its name'))
    const summary = shell.querySelector('[data-preview-description]')!
    expect(summary.hasAttribute('hidden')).toBe(true)
    paint(shell, { schema: 1, title: 'Next', description: 'Has a summary.', href: '/en/x/' }, { id: ID })
    expect(summary.hasAttribute('hidden')).toBe(false)
    expect(summary.textContent).toBe('Has a summary.')
    paint(shell, { schema: 1, title: 'Inherited', description: '', href: '/en/x/' }, { id: ID, context: 'Inherited from Base.' })
    expect(summary.hasAttribute('hidden')).toBe(true)
    expect(shell.querySelector('[data-preview-detail]')!.textContent).toBe('Inherited from Base.')
  })
})

describe('the header chip and the marks in the body', () => {
  const KINDS = ['class', 'struct', 'enum', 'interface', 'trait', 'function', 'method', 'command', 'property', 'attribute', 'constant', 'key', 'option', 'exception', 'prompt',
    'resource-template', 'format', 'tool', 'resource', 'hook', 'typealias', 'module', 'union', 'cmdlet']
  const cardOf = (kind: string, extra: Partial<LinkPreview> = {}): LinkPreview => ({ schema: 1, title: 'Name', kind, description: 'Summary.', href: '/en/x/', ...extra })

  it('is the legend chip a heading carries, for every kind', { timeout: 30_000 }, async () => {
    const badge = await loadAstroTemplate('components/api/ApiBadge.astro')
    for (const kind of KINDS) {
      const word = kind.replace(/-/g, ' ')
      win.document.body.innerHTML = await renderAstroTemplate(badge, { props: { label: word, variant: 'kind', value: kind } })
      const heading = win.document.body.firstElementChild!
      const shell = await staticCard(cardOf(kind))
      const chip = shell.querySelector('[data-preview-kind] > .api-leg')!
      expect(chip, kind).not.toBeNull()
      // The heading badge is a link to the glossary and says so; the chip in a card is not a link. What they draw is the same.
      expect(chip.innerHTML, kind).toBe(heading.innerHTML)
      expect([...chip.classList].sort(), kind).toEqual([...heading.classList].sort())
      expect(chip.getAttribute('data-mark'), kind).toBe(heading.getAttribute('data-mark'))
    }
  })

  it('shows the mark as decoration and the kind word as text', async () => {
    const shell = await staticCard(cardOf('method'))
    const chip = shell.querySelector('[data-preview-kind] .api-leg')!
    expect(chip.querySelector('.api-leg__m')!.getAttribute('aria-hidden')).toBe('true')
    expect(chip.querySelector('.api-leg__g')!.textContent).toBe('m')
    expect(chip.querySelector('.api-leg__wl')!.textContent).toBe('method')
    expect(chip.classList.contains('api-badge--kind-method')).toBe(true)
  })

  it('draws no chip for a name that is not a kind, and none for a page', async () => {
    for (const kind of [undefined, 'inherited', 'manual', 'constructor', 'toString', 'x" onmouseover="alert(1)', 'Class', '']) {
      const shell = await staticCard(cardOf(kind as string))
      const slot = shell.querySelector('[data-preview-kind]')!
      expect(slot.hasAttribute('hidden'), String(kind)).toBe(true)
      expect(slot.children, String(kind)).toHaveLength(0)
    }
  })

  const withRefs = (kind: string | undefined): LinkPreview => cardOf('method', {
    description: 'Creates a detached Session and returns it. Fails with Error when the name is taken.',
    descriptionParts: ['Creates a detached ', { text: 'Session', href: '/en/rs/latest/reference/session/', kind: 'struct' }, ' and returns it. Fails with ',
      { text: 'Error', href: '/en/rs/latest/reference/error/', kind },  ' when the name is taken.'],
  })

  it('writes a named type as the mark of its kind and a link, as prose does', async () => {
    const badge = await loadAstroTemplate('components/api/ApiBadge.astro')
    const shell = await staticCard(withRefs('enum'))
    const links = [...shell.querySelectorAll('[data-preview-description] a')]
    expect(links.map((link) => link.textContent)).toEqual(['SSession', 'EError'])
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/en/rs/latest/reference/session/', '/en/rs/latest/reference/error/'])
    const mark = links[0].querySelector('.api-nav__kind')!
    // The compact mark of the badge component, plus what prose adds to a mark that leads a link.
    win.document.body.innerHTML = await renderAstroTemplate(badge, { props: { label: 'struct', variant: 'kind', value: 'struct', compact: true } })
    const compact = win.document.body.firstElementChild!
    expect(mark.innerHTML).toBe(compact.innerHTML)
    expect(compact.classList.contains('api-nav__kind') && compact.classList.contains('api-badge--kind-struct')).toBe(true)
    expect(mark.classList.contains('api-nav__kind') && mark.classList.contains('api-badge--kind-struct') && mark.classList.contains('api-link-kind')).toBe(true)
    expect(links[0].querySelector('.api-badge__label')!.getAttribute('data-mark')).toBe('cap')
    expect(links[0].querySelector('.api-symbol-link__name code.api-literal')!.textContent).toBe('Session')
  })

  it('gives each linked name an accessible name that says its kind, and hides the mark letter', async () => {
    const shell = await staticCard(withRefs('enum'))
    const links = [...shell.querySelectorAll('[data-preview-description] a')]
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual(['struct: Session', 'enum: Error'])
    for (const link of links) {
      const mark = link.querySelector('.api-nav__kind')!
      expect(mark.getAttribute('aria-hidden')).toBe('true')
      expect(mark.getAttribute('title')).toBe(link.getAttribute('aria-label')!.split(':')[0])
      // The visible text is part of the accessible name, so speech input that says "Session" finds the link.
      expect(link.getAttribute('aria-label')!.endsWith(link.querySelector('code')!.textContent!)).toBe(true)
    }
  })

  it('links a name without a kind plainly, and a kind that is not one without a mark', async () => {
    for (const kind of [undefined, 'inherited', 'a b']) {
      const shell = await staticCard(withRefs(kind))
      const error = [...shell.querySelectorAll('[data-preview-description] a')][1]
      expect(error.textContent, String(kind)).toBe('Error')
      expect(error.querySelector('.api-nav__kind'), String(kind)).toBeNull()
      expect(error.hasAttribute('aria-label'), String(kind)).toBe(false)
    }
  })

  it('does not link a destination that is not a page of this site, and reads the plain description when the runs differ', async () => {
    // A browser reads a backslash as a slash and drops a tab or a newline inside an address, so each of these leaves the site.
    const offSite = ['javascript:alert(1)', '//evil.test/x', 'https://evil.test/', 'data:text/html,x', '', '/\\evil.test', '/\\\\evil.test', '/\t/evil.test', '/\n/evil.test',
      '/\r/evil.test', '\\evil.test', '\t/evil.test', '/\t\\evil.test']
    for (const href of offSite) {
      // The control for the check: the browser's own reading of the address, from an origin of its own, is off that origin.
      if (href.startsWith('/')) expect(new URL(href, 'https://libtmux.org/en/ts/').origin, JSON.stringify(href)).not.toBe('https://libtmux.org')
      const preview = cardOf('method', { description: 'See Session.', descriptionParts: ['See ', { text: 'Session', href, kind: 'struct' }, '.'] })
      const shell = await staticCard(preview)
      expect(shell.querySelectorAll('[data-preview-description] a'), href).toHaveLength(0)
      expect(shell.querySelector('[data-preview-description]')!.textContent, href).toBe('See Session.')
    }
    for (const href of ['/en/rs/latest/reference/server/', '/rs/latest/reference/server/#libtmux.Server.new_session', '/a/../b/', '/%5C%5Cevil.test']) {
      const shell = await staticCard(cardOf('method', { description: 'See Session.', descriptionParts: ['See ', { text: 'Session', href, kind: 'struct' }, '.'] }))
      expect(shell.querySelector('[data-preview-description] a')?.getAttribute('href'), href).toBe(href)
    }
    const disagree = await staticCard(cardOf('method', { description: 'Plain words.', descriptionParts: ['Other ', { text: 'words', href: '/en/x/', kind: 'struct' }] }))
    expect(disagree.querySelector('[data-preview-description]')!.textContent).toBe('Plain words.')
    expect(disagree.querySelectorAll('[data-preview-description] a')).toHaveLength(0)
    const malformed = await staticCard(cardOf('method', { description: 'Plain.', descriptionParts: [42, { text: 'x' }] as unknown as LinkPreview['descriptionParts'] }))
    expect(malformed.querySelector('[data-preview-description]')!.textContent).toBe('Plain.')
  })

  it('escapes what a payload says, in the page\'s HTML and in the browser alike', async () => {
    const hostile = cardOf('method', {
      title: '<img src=x onerror=alert(1)>', description: '"><script>alert(1)</script>', footer: ['<b>x</b>', 'a & b'], signature: '<svg onload=alert(1)>',
      actionLabel: '<i>go</i>', detail: '</span><script>1</script>',
    })
    const shell = await staticCard(hostile)
    const painted = await paintedCard(hostile)
    for (const card of [shell, painted]) {
      expect(card.querySelectorAll('script, img, svg, b, i')).toHaveLength(0)
      expect(card.querySelector('[data-preview-title]')!.textContent).toBe(hostile.title)
      expect(card.querySelector('[data-preview-footer]')!.textContent).toBe('<b>x</b> · a & b')
      expect(card.querySelector('[data-preview-signature]')!.textContent).toBe(hostile.signature)
    }
    expect(inside(painted)).toBe(inside(shell))
  })
})

describe('what a card holds', () => {
  it('keeps the close control first and the way to the page last, so that Tab reaches them in that order', async () => {
    const shell = await staticCard({ schema: 1, title: 'Name', kind: 'method', description: 'See Session.', href: '/en/x/',
      descriptionParts: ['See ', { text: 'Session', href: '/en/rs/latest/reference/session/', kind: 'struct' }, '.'], footer: ['libtmux', 'Server'] })
    const reachable = [...shell.querySelectorAll('button, a[href]')].filter((element) => !element.closest('[hidden]') && !element.hasAttribute('hidden'))
    expect(reachable.map((element) => element.getAttribute('data-preview-close') !== null ? 'close' : element.getAttribute('data-preview-open') !== null ? 'open' : 'mention'))
      .toEqual(['close', 'mention', 'open'])
    const close = shell.querySelector('[data-preview-close]')!
    expect(close.getAttribute('popovertarget')).toBe(ID)
    expect(close.getAttribute('popovertargetaction')).toBe('hide')
    expect(close.getAttribute('aria-label')).toBe('Close preview')
  })

  it('names the dialog by its payload', async () => {
    expect(previewLabel({ schema: 1, title: 'Server', description: '', href: '/' })).toBe('Server preview')
    expect(previewLabel(undefined)).toBe('Reference preview')
    expect((await staticCard({ schema: 1, title: 'Server', description: '', href: '/' })).getAttribute('aria-label')).toBe('Server preview')
  })

  it('shows only the head of a declaration too long for a card, in the page\'s HTML and in the browser alike', async () => {
    const token = (content: string) => ({ content, light: { color: '#A626A4', fontStyle: 0 }, dark: { color: '#F97583', fontStyle: 0 } })
    const lines = Array.from({ length: 40 }, (_, index) => `case_${index}`)
    const signature = `enum {\n${lines.join('\n')}\n}`
    const huge = { schema: 1 as const, title: 'enum', kind: 'enum', description: '', signature, signatureLanguage: 'c', href: '/en/c/', signatureHighlight: {
      language: 'c', light: { foreground: '#24292E', background: '#FFFFFF' }, dark: { foreground: '#E1E4E8', background: '#24292E' },
      lines: signature.split('\n').map((line) => [token(line)]) } }
    const kept = `${signature.split('\n').slice(0, PREVIEW_SIGNATURE_LINES).join('\n')}\n…`
    for (const card of [await staticCard(huge), await paintedCard(huge)]) {
      const code = card.querySelector('[data-preview-signature]')!
      expect(code.textContent).toBe(kept)
      // The cut text no longer matches its highlighting, so it is plain text.
      expect(code.querySelectorAll('*')).toHaveLength(0)
    }
    const oneLine = { ...huge, signature: `enum { ${'KEYC_X, '.repeat(60_000)}}`, signatureHighlight: undefined }
    for (const card of [await staticCard(oneLine), await paintedCard(oneLine)]) {
      const text = card.querySelector('[data-preview-signature]')!.textContent!
      expect(text.length).toBeLessThanOrEqual(PREVIEW_SIGNATURE_CHARS + 2)
      expect(text.endsWith('\n…')).toBe(true)
    }
    // The control: a declaration that fits keeps its text and its highlighting.
    const short = 'enum { A, B }'
    const fits = { ...huge, signature: short, signatureHighlight: { ...huge.signatureHighlight, lines: [[token(short)]] } }
    for (const card of [await staticCard(fits), await paintedCard(fits)]) {
      const code = card.querySelector('[data-preview-signature]')!
      expect(code.textContent).toBe(short)
      expect(code.classList.contains('lm-highlighted')).toBe(true)
      expect(code.querySelectorAll('span')).toHaveLength(1)
    }
  })

  it('draws a highlighted declaration from the payload alone and a malformed one as plain text', async () => {
    const token = (content: string, color: string) => ({ content, light: { color, fontStyle: 0 }, dark: { color: '#F97583', fontStyle: 1 } })
    const base = { schema: 1 as const, title: 'T', description: '', signature: 'final class T', href: '/en/x/' }
    const good = { ...base, signatureHighlight: { language: 'java', light: { foreground: '#24292E', background: '#FFFFFF' }, dark: { foreground: '#E1E4E8', background: '#24292E' },
      lines: [[token('final class ', '#A626A4'), token('T', '#032F62')]] } }
    const code = (await staticCard(good)).querySelector<HTMLElement>('[data-preview-signature]')!
    expect(code.classList.contains('lm-highlighted')).toBe(true)
    expect(code.getAttribute('data-language')).toBe('java')
    expect(code.getAttribute('style')).toContain('--shiki-dark:#E1E4E8')
    expect(code.querySelector('span')!.getAttribute('style')).toContain('--shiki-dark-font-style:italic')
    const bad = { ...good, signatureHighlight: { ...good.signatureHighlight, lines: [[token('final class T', 'url(https://evil.test/)')]] } }
    const plain = (await staticCard(bad)).querySelector('[data-preview-signature]')!
    expect(plain.textContent).toBe('final class T')
    expect(plain.querySelectorAll('*')).toHaveLength(0)
    expect(plain.classList.contains('lm-highlighted')).toBe(false)
  })
})

describe('node data', () => {
  it('serializes as the DOM builds it, for text that needs escaping and attributes that are bare', () => {
    const nodes: CardNode[] = [{ tag: 'span', attrs: { hidden: true, title: 'a "b" & <c>', skipped: undefined }, children: ['x < y & z', { tag: 'wbr' }, 'w'] }]
    const html = cardHtml(nodes)
    expect(html).toBe('<span hidden title="a &quot;b&quot; &amp; &lt;c&gt;">x &lt; y &amp; z<wbr>w</span>')
    const host = win.document.createElement('div')
    host.innerHTML = html
    const span = host.firstElementChild!
    expect(span.hasAttribute('hidden')).toBe(true)
    expect(span.getAttribute('title')).toBe('a "b" & <c>')
    expect(span.hasAttribute('skipped')).toBe(false)
    expect(span.textContent).toBe('x < y & zw')
  })
})
