import { Window, type HTMLAnchorElement, type HTMLButtonElement, type HTMLElement } from 'happy-dom'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { experimental_AstroContainer } from 'astro/container'
import { createRenderer } from 'astro-expressive-code'
import { select } from 'astro-expressive-code/hast'
import { fromHtml } from 'hast-util-from-html'
import { visit } from 'unist-util-visit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { symbolPreview, glossaryPreview } from '../src/lib/link-preview'
import { API_MODELS } from '../src/lib/api-models'
import { productApiIndex } from '../src/lib/product-api'
import { apiGlossaryHref } from '../src/lib/api-glossary'
import { initLinkPreviews, disposeLinkPreviews, linkPreviewTarget } from '../src/lib/link-preview-browser'
import { GET } from '../src/pages/[...slug].preview.json'
import { highlightTokens } from '../src/lib/highlight'
import config from '../ec.config.mjs'

it.each([
  ['/en/powershell/latest/workspace/reference/libtmux-workspace/', '/en/powershell/latest/workspace/reference/glossary/#cmdlet'],
  ['/pr-42/en/julia/latest/mcp/reference/libtmuxmcp-tools/', '/pr-42/en/julia/latest/mcp/reference/glossary/#cmdlet'],
  ['/en/julia/latest/reference/libtmux-from_env/', '/en/julia/latest/reference/glossary/#cmdlet'],
])('keeps glossary terms in their existing reference context: %s', (context, expected) => {
  expect(apiGlossaryHref('cmdlet', context)).toBe(expected)
})

it('does not invent contextual glossaries for source projects or ordinary articles', () => {
  expect(apiGlossaryHref('function', '/en/tmux/latest/reference/window/')).toBe(apiGlossaryHref('function'))
  expect(apiGlossaryHref('function', '/en/julia/latest/guides/')).toBe(apiGlossaryHref('function'))
})

it('uses authored, native descriptions and signatures without reconstructing language syntax', () => {
  const julia = API_MODELS.julia
  const symbol = julia.symbols.find((entry) => entry.id === 'LibTmux.from_env')!
  const result = symbolPreview(julia, symbol, 'latest')
  expect(result.title).toBe('LibTmux.from_env')
  expect(result.description).toContain('without contacting tmux')
  expect(result.signature).toBe(symbol.signatures[0].raw)
  expect(result.href).toMatch(/\/julia\/latest\/reference\/libtmux-from_env\/$/)
  const ts = API_MODELS.ts
  const factory = ts.symbols.find((entry) => entry.name === 'createTmuxMcpServer')!
  expect(symbolPreview(ts, factory, 'latest').signature).toBeUndefined()
})

it('provides exact glossary terms with durable destinations', () => {
  const href = '/en/powershell/latest/workspace/reference/glossary/'
  const preview = glossaryPreview(href)
  expect(preview.terms!.cmdlet.href).toBe(`${href}#cmdlet`)
  expect(preview.terms!.cmdlet.description.length).toBeGreaterThan(20)
})

it('highlights the source-bound Scala signature for a cross-language preview without Copy markup', async () => {
  const model = API_MODELS.scala
  const symbol = model.symbols.find((entry) => entry.id === 'io.github.libtmux.scaladsl.query.Fields.FlagField')!
  const preview = symbolPreview(model, symbol, 'latest')
  expect(preview.signature).toBe('final class FlagField[T]')
  expect(preview.signatureLanguage).toBe('scala')
  const response = await GET({ props: { preview } } as Parameters<typeof GET>[0])
  const payload = await response.json()
  expect(payload.signatureHighlight.language).toBe('scala')
  expect(payload.signatureHighlight.lines.map((line: { content: string }[]) => line.map((token) => token.content).join('')).join('\n'))
    .toBe(preview.signature)
  expect(JSON.stringify(payload.signatureHighlight)).not.toContain('<button')
  for (const theme of ['light', 'dark']) {
    expect(new Set(payload.signatureHighlight.lines.flat().map((token: Record<string, { color: string }>) => token[theme].color)).size).toBeGreaterThan(1)
  }
})

it.each([
  ['scala', 'final class FlagField[T]'],
  ['java', 'public void close() throws Exception;'],
  ['cxx', 'std::vector<Pane> Server::panes() const;'],
  ['c', 'struct window *window_create(unsigned int width);'],
  ['go', 'func Matching[T any](values []T, filter Filter[T]) ([]T, error)'],
  ['json', '{"name":"FlagField","required":true,"count":1}'],
])('uses ordinary codeblock colors for the %s target language', async (language, signature) => {
  const highlight = (await highlightTokens(signature, language))!
  expect(highlight.lines.flat().map((token) => token.content).join('')).toBe(signature)
  expect(new Set(highlight.lines.flat().map((token) => token.light.color)).size).toBeGreaterThan(1)
  const renderer = await createRenderer(config)
  const result = await renderer.ec.render({ code: signature, language: highlight.language })
  const line = select('.ec-line .code', result.renderedGroupAst)!
  const paints: { text: string; style: string }[] = []
  visit(line, 'element', (node) => {
    if (typeof node.properties.style === 'string') paints.push({
      text: node.children.map((child) => child.type === 'text' ? child.value : '').join(''), style: node.properties.style,
    })
  })
  for (const [theme, variable] of [['dark', '0'], ['light', '1']] as const) {
    const expected = highlight.lines.flat().flatMap((token) => [...token.content].map((character) => [character, token[theme].color.toLowerCase()]))
    const actual = paints.flatMap((token) => [...token.text].map((character) => [character, token.style.match(new RegExp(`--${variable}:([^;]+)`))![1].toLowerCase()]))
    expect(actual, `${language}/${theme}`).toEqual(expected)
  }
})

it('only fetches same-origin supported reference URLs', () => {
  const origin = 'https://libtmux.org'
  expect(linkPreviewTarget('/en/ts/latest/reference/server/#parameter', origin)?.endpoint).toBe('/en/ts/latest/reference/server.preview.json')
  for (const url of ['https://elsewhere.test/reference/server/', '/en/guides/', '/en/ts/latest/reference/server/?q=1', 'javascript:alert(1)']) {
    expect(linkPreviewTarget(url, origin)).toBeUndefined()
  }
})

it('keeps native keyword help and parameter permalinks inside their inline paragraph', async () => {
  const astroRequire = createRequire(realpathSync(new URL('../node_modules/astro/package.json', import.meta.url)))
  const { transform } = await import(astroRequire.resolve('@astrojs/compiler-rs'))
  async function compile(relative: string, imports: Record<string, string> = {}) {
    const file = new URL(relative, import.meta.url)
    const source = readFileSync(file, 'utf8').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
    const result = await transform(source, { filename: file.pathname, internalURL: 'astro/compiler-runtime',
      resultScopedSlot: true, resolvePath: (specifier: string) => specifier })
    expect(result.diagnostics.filter((item: { severity: string }) => item.severity === 'error')).toEqual([])
    let code = result.code.replaceAll('"astro/compiler-runtime"', JSON.stringify(pathToFileURL(astroRequire.resolve('astro/compiler-runtime')).href))
    for (const [specifier, url] of Object.entries(imports)) code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(url))
    return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  }
  const preview = await compile('../src/components/LinkPreview.astro')
  const keyword = await compile('../src/components/api/ApiKeyword.astro', { '../LinkPreview.astro': preview })
  const model = API_MODELS.kotlin
  const symbol = model.symbols.find((entry) => entry.id === 'io.github.libtmux.kotlin.ControlClient.output')!
  const parameter = symbol.signatures.flatMap((signature) => signature.params).find((entry) => entry.name === 'onSubscribed')!
  const helped = productApiIndex(model, 'latest').linkType(parameter.type!, symbol).find((span) => span.help)!
  const container = await experimental_AstroContainer.create()
  const html = await container.renderToString((await import(/* @vite-ignore */ keyword)).default, { props: { text: helped.text, help: helped.help } })
  const tree = fromHtml(`<p><strong>onSubscribed</strong> (${html}<span> () → Unit</span>) <a href="#parameter">#</a></p>`, { fragment: true })
  // Use the HTML5 parser: a hidden block element can still close the parameter paragraph.
  expect(tree.children).toHaveLength(1)
  const paragraph = tree.children[0]
  expect(paragraph.type).toBe('element')
  if (paragraph.type !== 'element') throw new Error('Missing parameter paragraph')
  expect(paragraph.tagName).toBe('p')
  let actions = 0
  visit(paragraph, 'element', (node) => {
    if (node.properties.popover !== 'auto') return
    visit(node, 'element', (child) => {
      if (child.tagName === 'a' && child.properties.href === helped.help!.href) actions++
    })
  })
  expect(actions).toBe(1)
})

let win: Window
let requests: ReturnType<typeof vi.fn>
let opened: boolean
let serial = 0
let prefix: string
beforeEach(() => {
  prefix = `/en/ts/latest/reference/preview-test-${++serial}`
  win = new Window({ url: 'https://libtmux.org/en/ts/latest/guides/' })
  for (const [name, value] of Object.entries({ window: win, document: win.document, location: win.location,
    Element: win.Element, Node: win.Node, HTMLElement: win.HTMLElement, innerHeight: 800 })) vi.stubGlobal(name, value)
  vi.useFakeTimers()
  opened = false
  win.document.body.innerHTML = `<a id="a" href="${prefix}-a/">a</a><a id="b" href="${prefix}-b/">b</a>
    <span id="reference-link-preview"><code data-preview-title></code><button data-preview-expand hidden aria-expanded="false">Show full name</button><span data-preview-description></span>
    <span data-preview-detail></span><code data-preview-signature></code><a data-preview-open></a><button data-preview-close>Close</button></span>`
  const panel = win.document.getElementById('reference-link-preview')!
  Object.assign(panel, { showPopover: () => { opened = true }, hidePopover: () => { opened = false } })
  const matches = panel.matches.bind(panel)
  panel.matches = (selector) => selector === ':popover-open' ? opened : matches(selector)
  requests = vi.fn(async (path: string) => new Response(JSON.stringify({ schema: 1, title: path.includes('-a.') ? 'a' : 'b', description: 'Useful description.', href: path.replace('.preview.json', '/') })))
  vi.stubGlobal('fetch', requests)
  initLinkPreviews()
})
afterEach(async () => {
  disposeLinkPreviews()
  vi.useRealTimers()
  await win.happyDOM.abort()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
const link = (id = 'a') => win.document.querySelector<HTMLAnchorElement>(`#${id}`)!
const hover = (id = 'a', pointerType = 'mouse') => link(id).dispatchEvent(new win.PointerEvent('pointerover', { pointerType, bubbles: true }))
const settle = () => vi.advanceTimersByTimeAsync(200)
const title = () => win.document.querySelector('[data-preview-title]')!.textContent
const escape = () => win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

describe('preview lifecycle', () => {
  it('renders validated highlighted tokens as selectable text and falls back on malformed styling', async () => {
    const signature = 'final class Value<T> & Other'
    const token = (content: string, light = '#A626A4') => ({ content,
      light: { color: light, fontStyle: 0 }, dark: { color: '#F97583', fontStyle: 1 } })
    const payload = { schema: 1, title: 'example.Value', description: '', signature, signatureLanguage: 'java',
      href: `${prefix}-a/`, signatureHighlight: { language: 'java',
        light: { foreground: '#24292E', background: '#FFFFFF' },
        dark: { foreground: '#E1E4E8', background: '#24292E' },
        lines: [[token('final class '), token('Value<T> & Other', '#032F62')]] } }
    requests.mockResolvedValueOnce(new Response(JSON.stringify(payload)))
    hover(); await settle()
    const code = win.document.querySelector<HTMLElement>('[data-preview-signature]')!
    expect(code.textContent).toBe(signature)
    expect(code.querySelectorAll('span').length).toBe(2)
    expect(code.querySelectorAll('button, script, a, input')).toHaveLength(0)
    expect(code.querySelector('span')!.style.getPropertyValue('--shiki-light')).toBe('#A626A4')
    expect(code.querySelector('span')!.style.getPropertyValue('--shiki-dark')).toBe('#F97583')
    expect(code.querySelector('span')!.style.getPropertyValue('--shiki-dark-font-style')).toBe('italic')
    escape()
    requests.mockResolvedValueOnce(new Response(JSON.stringify({ ...payload, href: `${prefix}-b/`,
      signatureHighlight: { ...payload.signatureHighlight, lines: [[token(signature, 'url(https://evil.test/)')]] } })))
    hover('b'); await settle()
    expect(code.textContent).toBe(signature)
    expect(code.querySelectorAll('*')).toHaveLength(0)
    expect(code.style.getPropertyValue('--shiki-light-bg')).toBe('')
    expect(code.classList.contains('lm-highlighted')).toBe(false)
  })

  it('keeps the destructor name and native signature intact with meaningful title breaks', async () => {
    const name = 'libtmux::CommandOperation::~CommandOperation'
    const signature = '~CommandOperation();'
    requests.mockResolvedValueOnce(new Response(JSON.stringify({ schema: 1, title: name,
      description: '', signature, href: `${prefix}-a/` })))
    hover(); await settle()
    const panel = win.document.getElementById('reference-link-preview')!
    expect(title()).toBe(name)
    expect(panel.getAttribute('aria-label')).toBe(`${name} preview`)
    expect(panel.querySelector('[data-preview-title]')!.getAttribute('title')).toBe(name)
    expect(panel.querySelectorAll('[data-preview-title] wbr').length).toBeGreaterThan(0)
    expect(panel.querySelector('[data-preview-signature]')!.textContent).toBe(signature)
    expect(panel.querySelector('[data-preview-expand]')!.hasAttribute('hidden')).toBe(true)
  })

  it('expands long qualified names in place without changing full identity, signature or destination', async () => {
    const name = 'io.github.libtmux.workspace.WorkspaceBuilder.applyWorkspace'
    const signature = 'public WorkspaceResult applyWorkspace(WorkspacePlan plan);'
    requests.mockResolvedValueOnce(new Response(JSON.stringify({ schema: 1, title: name,
      description: '', signature, href: `${prefix}-a/` })))
    hover(); await settle()
    const panel = win.document.getElementById('reference-link-preview')!
    const expand = panel.querySelector<HTMLButtonElement>('[data-preview-expand]')!
    const short = title()
    expect(short).not.toBe(name)
    expect(short).toContain('applyWorkspace')
    expect(expand.hidden).toBe(false)
    expand.click()
    expect(title()).toBe(name)
    expect(expand.getAttribute('aria-expanded')).toBe('true')
    expect(expand.textContent).toBe('Collapse')
    expect(panel.getAttribute('aria-label')).toBe(`${name} preview`)
    expect(panel.querySelector('[data-preview-signature]')!.textContent).toBe(signature)
    expect(panel.querySelector('[data-preview-open]')!.getAttribute('href')).toBe(`https://libtmux.org${prefix}-a/`)
    expand.click()
    expect(title()).toBe(short)
    expect(expand.getAttribute('aria-expanded')).toBe('false')
    escape(); hover('b'); await settle()
    expect(title()).toBe('b')
    expect(expand.hidden).toBe(true)
    expect(expand.getAttribute('aria-expanded')).toBe('false')
  })

  it('treats punctuation in a preview name as text when adding break opportunities', async () => {
    const name = 'libtmux::Value<Other> & Value<Script>'
    requests.mockResolvedValueOnce(new Response(JSON.stringify({ schema: 1, title: name,
      description: '', href: `${prefix}-a/` })))
    hover(); await settle()
    expect(title()).toBe(name)
    expect(win.document.querySelector('[data-preview-title] script')).toBeNull()
    expect(Array.from(win.document.querySelector('[data-preview-title]')!.children).every((node) => node.tagName === 'WBR')).toBe(true)
  })

  it('marks eligible previews without eagerly fetching their contents', () => {
    expect(link().hasAttribute('data-link-preview')).toBe(true)
    expect(requests).not.toHaveBeenCalled()
    win.document.body.insertAdjacentHTML('beforeend', '<a id="external" href="https://example.com/reference/type/">External</a><nav><a id="nav" href="/en/ts/latest/reference/type/">Navigation</a></nav><a id="skip" data-preview-skip href="/en/ts/latest/reference/type/">Skip</a>')
    initLinkPreviews()
    for (const id of ['external', 'nav', 'skip']) expect(link(id).hasAttribute('data-link-preview')).toBe(false)
    expect(requests).not.toHaveBeenCalled()
  })
  it('keeps glossary destinations in documentation pickers as ordinary navigation', async () => {
    win.document.body.insertAdjacentHTML('beforeend', `<header><details data-doc-picker open>
      <summary>Choose a port</summary><div><a id="picker" href="/en/julia/latest/mcp/reference/glossary/#attribute">Julia</a></div>
    </details></header>`)
    initLinkPreviews()
    expect(link('picker').hasAttribute('data-link-preview')).toBe(false)
    hover('picker'); await settle()
    link('picker').focus(); await settle()
    const click = new win.MouseEvent('click', { bubbles: true, cancelable: true })
    link('picker').dispatchEvent(click)
    await settle()
    expect(click.defaultPrevented).toBe(false)
    expect(opened).toBe(false)
    expect(requests).not.toHaveBeenCalled()
  })
  it('suppresses duplicate native tooltips without changing keyboard preview semantics', async () => {
    link().title = 'Native tooltip'
    link().setAttribute('aria-label', 'Read a')
    initLinkPreviews()
    expect(link().title).toBe('')
    expect(link().textContent).toBe('a')
    expect(link().getAttribute('aria-label')).toBe('Read a')
    expect(link().getAttribute('href')).toBe(`${prefix}-a/`)
    link().focus(); await settle()
    expect(opened).toBe(true)
    expect(link().getAttribute('aria-details')).toBe('reference-link-preview')
    expect(win.document.activeElement).toBe(link())
    escape()
    expect(opened).toBe(false)
    expect(link().hasAttribute('aria-details')).toBe(false)
    expect(win.document.activeElement).toBe(link())
    expect(link().title).toBe('')
    link('b').title = 'Dynamically added tooltip'
    hover('b'); await settle()
    expect(opened).toBe(true)
    expect(link('b').title).toBe('')
  })
  it('preserves inherited origins as accessible descriptions and visible preview context', async () => {
    const origin = 'Inherited from Base<Member>'
    link().title = origin
    link().setAttribute('aria-description', origin)
    link().dataset.previewContext = `${origin}.`
    initLinkPreviews()
    expect(link().title).toBe('')
    expect(link().getAttribute('aria-description')).toBe(origin)
    requests.mockResolvedValueOnce(new Response(JSON.stringify({ schema: 1, title: 'inherited',
      description: 'A member declared by a base type.', detail: 'Follow the declaration for its signature.', href: `${prefix}-a/` })))
    hover(); await settle()
    const detail = win.document.querySelector<HTMLElement>('[data-preview-detail]')!
    expect(detail.hidden).toBe(false)
    expect(detail.textContent).toBe(`${origin}. Follow the declaration for its signature.`)
    expect(detail.children).toHaveLength(0)
    escape(); hover('b'); await settle()
    expect(detail.hidden).toBe(true)
    expect(detail.textContent).toBe('')
  })
  it('loads on intent, caches repeated requests, and ignores touch hover', async () => {
    expect(requests).not.toHaveBeenCalled()
    hover('a', 'touch'); await settle(); expect(requests).not.toHaveBeenCalled()
    hover(); await settle(); expect(requests).toHaveBeenCalledTimes(1); expect(opened).toBe(true)
    escape(); hover(); await settle(); expect(requests).toHaveBeenCalledTimes(1)
  })

  it.each(['card', 'inline', 'kind', 'context'])('keeps %s links inside browse cards free of previews', async (id) => {
    win.document.body.insertAdjacentHTML('beforeend', `<div class="api-index-card">
      <a id="card" class="api-index-card__link" href="/en/cxx/latest/mcp/resources/tmux-capabilities/">tmux-capabilities</a>
      <a id="kind" class="api-badge" data-link-preview href="/en/cxx/latest/reference/glossary/#function">function</a>
      <a id="context" class="api-badge" href="/en/cxx/latest/reference/glossary/#package">Package: tmux</a>
      <p>The startup-frozen <a id="inline" href="/en/cxx/latest/reference/server/">server</a> capability manifest.</p>
    </div>`)
    initLinkPreviews()
    expect(link(id).hasAttribute('data-link-preview')).toBe(false)
    hover(id); await settle()
    link(id).focus(); await settle()
    const click = new win.MouseEvent('click', { bubbles: true, cancelable: true })
    link(id).dispatchEvent(click)
    await settle()
    expect(click.defaultPrevented).toBe(false)
    expect(opened).toBe(false)
    expect(requests).not.toHaveBeenCalled()
  })

  it('cancels a brief hover before requesting metadata', async () => {
    hover(); vi.advanceTimersByTime(100)
    link().dispatchEvent(new win.PointerEvent('pointerout', { pointerType: 'mouse', bubbles: true }))
    await settle(); expect(requests).not.toHaveBeenCalled()
  })

  it('ignores a late response as soon as another link owns the intent', async () => {
    let resolveA!: (value: Response) => void
    requests.mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveA = resolve }))
    hover(); await settle(); hover('b')
    resolveA(new Response(JSON.stringify({ schema: 1, title: 'stale', description: '', href: `${prefix}-a/` })))
    await Promise.resolve(); expect(opened).toBe(false)
    await settle(); expect(opened).toBe(true); expect(title()).toBe('b')
  })

  it('aborts pending navigation work and never reopens after disposal', async () => {
    let resolveA!: (value: Response) => void
    requests.mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveA = resolve }))
    hover(); await settle(); const signal = requests.mock.calls[0][1].signal as AbortSignal
    disposeLinkPreviews(); expect(signal.aborted).toBe(true)
    resolveA(new Response(JSON.stringify({ schema: 1, title: 'stale', description: '', href: `${prefix}-a/` })))
    await settle(); expect(opened).toBe(false)
  })

  it('cancels a pending preview when keyboard focus moves to another control', async () => {
    let resolveA!: (value: Response) => void
    requests.mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveA = resolve }))
    link().focus(); await settle()
    const button = win.document.createElement('button'); win.document.body.append(button); button.focus()
    resolveA(new Response(JSON.stringify({ schema: 1, title: 'stale', description: '', href: `${prefix}-a/` })))
    await settle(); expect(opened).toBe(false)
  })

  it('never replaces native keyword help with a pending API response', async () => {
    let resolveA!: (value: Response) => void
    requests.mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveA = resolve }))
    hover(); await settle()
    const help = win.document.createElement('span'); help.className = 'reference-link-preview api-keyword-help'
    win.document.body.append(help)
    const toggle = new win.Event('beforetoggle'); Object.assign(toggle, { newState: 'open' }); help.dispatchEvent(toggle)
    resolveA(new Response(JSON.stringify({ schema: 1, title: 'stale', description: '', href: `${prefix}-a/` })))
    await settle(); expect(opened).toBe(false)
  })

  it('keeps API clicks and modified glossary clicks as ordinary navigation', async () => {
    const click = new win.MouseEvent('click', { bubbles: true, cancelable: true })
    link().dispatchEvent(click); expect(click.defaultPrevented).toBe(false)
    link().setAttribute('href', '/en/powershell/latest/workspace/reference/glossary/#cmdlet')
    const modified = new win.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })
    link().dispatchEvent(modified); expect(modified.defaultPrevented).toBe(false)
    await settle(); expect(requests).not.toHaveBeenCalled()
  })

  it('opens a glossary definition on click and restores focus once on Escape', async () => {
    const href = '/en/powershell/latest/workspace/reference/glossary/'
    requests.mockResolvedValueOnce(new Response(JSON.stringify(glossaryPreview(href))))
    link().setAttribute('href', `${href}#cmdlet`)
    let routerPrevented = false
    win.document.addEventListener('click', (event) => { routerPrevented = event.defaultPrevented }, { once: true })
    const click = new win.MouseEvent('click', { bubbles: true, cancelable: true })
    link().dispatchEvent(click); expect(click.defaultPrevented).toBe(true)
    expect(routerPrevented).toBe(true)
    await settle(); expect(opened).toBe(true); expect(title()).toBe('cmdlet')
    expect(win.document.activeElement).toBe(win.document.querySelector('[data-preview-open]'))
    escape(); await settle(); expect(opened).toBe(false); expect(win.document.activeElement).toBe(link())
    expect(requests).toHaveBeenCalledTimes(1)
  })

  it('rejects missing and foreign metadata without trapping ordinary links', async () => {
    requests.mockResolvedValueOnce(new Response('', { status: 404 }))
    hover(); await settle(); expect(opened).toBe(false)
    requests.mockResolvedValueOnce(new Response(JSON.stringify({ schema: 1, title: 'unsafe', description: '', href: 'https://elsewhere.test/' })))
    hover(); await settle(); expect(opened).toBe(false)
    expect(link().getAttribute('href')).toBe(`${prefix}-a/`)
  })
})
