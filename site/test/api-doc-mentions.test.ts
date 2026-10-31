import { Window, type Element as DomElement, type HTMLAnchorElement as DomAnchor } from 'happy-dom'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { experimental_AstroContainer } from 'astro/container'
import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import { fromHtml } from 'hast-util-from-html'
import { select, selectAll } from 'astro-expressive-code/hast'
import { SymbolIndex, type ApiSymbol } from '@libtmux/api-model'
import { API_MODELS, indexFor } from '../src/lib/api-models'
import { MCP_REFERENCE } from '../src/lib/mcp-catalog'
import { rehypeApiLinks } from '../src/plugins/rehype-api-links'
import { mentionBadge, mentionBadgeHtml } from '../src/lib/mention-badge'
import { apiComponents } from './api-components'
import { indexedText } from './indexed-text'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

vi.mock('astro:content', () => ({ getCollection: () => { throw new Error('Core Markdown must use its API model') } }))

/**
 * A doc comment's cross-reference is the link alone: the stylesheet tints it by kind, and the kind stays in the title, the
 * data attribute and the accessible name. `ApiDoc` renders the prose of every reference page, so these read what it writes.
 * A Markdown page still marks the first mention of a name with the kind's badge.
 */
const model = API_MODELS.ts
const hrefFor = (symbol: ApiSymbol) => `/en/ts/latest/reference/${symbol.slug}/`
const index = new SymbolIndex(model.symbols, hrefFor, 'ts')
const window = new Window()
let doc: Awaited<ReturnType<typeof apiComponents>>['doc']
beforeAll(async () => { doc = (await apiComponents()).doc })
afterAll(async () => { await window.happyDOM.abort() })

const declare = (id: string): ApiSymbol => ({
  id, publicId: id, name: id.split('.').at(-1)!, kind: 'class', slug: id.replaceAll('.', '-').toLowerCase(),
  modifiers: [], signatures: [], source: { file: 'text.rs' },
})

async function render(text: string, context?: ApiSymbol, from: SymbolIndex = index) {
  const container = await experimental_AstroContainer.create()
  window.document.body.innerHTML = await container.renderToString(doc, { props: { text, index: from, context } })
  return window.document
}

/** Doc-comment prose as `ApiProse` draws it: its blocks, each with the links `ApiDoc` writes. */
async function renderProse(text: string, context?: ApiSymbol, from: SymbolIndex = index) {
  const prose = await loadAstroTemplate('components/api/ApiProse.astro', { real: ['components/api/ApiDoc.astro'], modules: { 'astro-expressive-code/components': { Code: () => '' } } })
  window.document.body.innerHTML = await renderAstroTemplate(prose, { props: { text, index: from, context } })
  return window.document
}

/** What is wrong with the way a page writes its links to declarations, so a test can name the failure and a control can prove it is able to fail. */
function problems(root: Pick<DomElement, 'querySelectorAll'>): string[] {
  const found: string[] = []
  for (const link of root.querySelectorAll<DomAnchor>('a.api-xref')) {
    const href = link.getAttribute('href')!
    if (!link.matches('.api-mention')) found.push(`${href}: not a mention`)
    if (link.querySelector('.api-link-kind')) found.push(`${href}: carries a kind badge`)
    if (!(link.getAttribute('aria-label') && link.dataset.apiKind && link.getAttribute('title'))) found.push(`${href}: lost its kind`)
  }
  return found
}

describe('a doc comment cross-reference', () => {
  it('names its kind in the title, the data attribute and the accessible name, and draws no badge', async () => {
    const root = await render('`Pane` sits in a `Window`. Send keys to a `Pane` again.')
    const links = [...root.querySelectorAll<DomAnchor>('a.api-xref')]
    expect(links.map((link) => link.textContent)).toEqual(['Pane', 'Window', 'Pane'])
    // `api-doc-link` is what the stylesheet tints: only links ApiDoc writes carry it.
    expect(links.map((link) => link.matches('.api-mention.api-doc-link'))).toEqual([true, true, true])
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual(['class: Pane', 'class: Window', 'class: Pane'])
    expect(links.map((link) => [link.dataset.apiKind, link.getAttribute('title')])).toEqual([['class', 'class'], ['class', 'class'], ['class', 'class']])
    expect(links.map((link) => link.querySelectorAll('.api-link-kind, .api-nav__kind').length)).toEqual([0, 0, 0])
    expect(links[0].querySelector(':scope > code.api-literal.api-literal--link')?.textContent).toBe('Pane')
    expect(problems(root)).toEqual([])
  })

  it('links the same declaration as a Markdown page, which keeps the badge on the first mention', async () => {
    const root = await render('`Pane` and `Pane`')
    const processor = await createMarkdownProcessor({ rehypePlugins: [rehypeApiLinks], syntaxHighlight: false })
    vi.stubEnv('LIBTMUX_DOCS_PORT', '')
    try {
      const page = fromHtml((await processor.render('Read `Pane` and `Pane`.', { frontmatter: { port: 'ts' } })).code, { fragment: true })
      const markdown = selectAll('a.api-mention', page)
      expect(markdown.map((link) => Boolean(select(':scope > .api-link-kind', link)))).toEqual([true, false])
      const mine = [...root.querySelectorAll<DomAnchor>('a.api-mention')]
      expect(mine.map((link) => link.getAttribute('href')!.replace(/^\/en/, ''))).toEqual(markdown.map((link) => link.properties.href))
      // The first mention's kind is its badge's; a later one carries it on the link.
      expect(mine.map((link) => link.dataset.apiKind))
        .toEqual(markdown.map((link) => link.properties.dataApiKind ?? select('.api-link-kind', link)?.properties.dataApiKind))
      expect(root.querySelector('.api-link-kind')).toBeNull()
    } finally { vi.unstubAllEnvs() }
  })

  it('names each declaration linked inside a longer literal by its kind, and leaves plain code as it was', async () => {
    const root = await render('`Selection<Pane>` and `AbortSignal`')
    expect(root.querySelector('.api-link-kind')).toBeNull()
    const [literal, plain] = [...root.querySelectorAll('code.api-literal')]
    // The literal keeps its frame; only the names it links take their kind.
    expect([...literal.querySelectorAll<DomAnchor>('a.api-mention.api-doc-link')].map((link) => [link.textContent, link.dataset.apiKind, link.getAttribute('title'), link.getAttribute('aria-label')]))
      .toEqual([['Selection', 'interface', 'interface', 'interface: Selection'], ['Pane', 'class', 'class', 'class: Pane']])
    expect(literal.textContent).toBe('Selection<Pane>')
    expect(plain.querySelector('a')).toBeNull()
  })

  it('names a Rust type linked inside a call or a generic, and not a std type or the path after it', async () => {
    // `from` belongs to a trait, so the whole path names nothing and the link is the type before it.
    const rust = new SymbolIndex([{ ...declare('text.TmuxText'), kind: 'struct' }], (symbol) => `/en/rs/latest/reference/${symbol.slug}/`, 'rs')
    const root = await render('Build one with `TmuxText::from(value)`, or keep an `Option<TmuxText>`.', undefined, rust)
    const [call, generic] = [...root.querySelectorAll('code.api-literal')]
    expect([...call.querySelectorAll<DomAnchor>('a')].map((link) => [link.textContent, link.dataset.apiKind, link.matches('.api-mention.api-doc-link')])).toEqual([['TmuxText', 'struct', true]])
    expect(call.textContent).toBe('TmuxText::from(value)')
    // `Option` links to the standard library, which is not a declaration of this site.
    expect([...generic.querySelectorAll<DomAnchor>('a')].map((link) => [link.textContent, link.dataset.apiKind, link.matches('.api-mention.api-doc-link')]))
      .toEqual([['Option', undefined, false], ['TmuxText', 'struct', true]])
    expect(problems(call)).toEqual([])
  })

  it('names a tmux command in the title, the data attribute and the accessible name, without a badge', async () => {
    const root = await render('Call `list-panes` and `list-panes` again.')
    const links = [...root.querySelectorAll<DomAnchor>('a.tmux-mention')]
    expect(links).toHaveLength(2)
    expect(links.map((link) => link.querySelectorAll('.api-link-kind').length)).toEqual([0, 0])
    expect(links.map((link) => link.classList.contains('api-doc-link'))).toEqual([true, true])
    expect(links.map((link) => [link.getAttribute('title'), link.dataset.apiKind, link.getAttribute('aria-label')]))
      .toEqual(Array(2).fill(['tmux command', 'command', 'tmux command: list-panes']))
  })

  describe('a kebab-case word in a code literal', () => {
    // Members named for the words in each, so a literal split at its hyphens would link them.
    const members = new SymbolIndex([
      { ...declare('access.AccessRule.mode'), kind: 'attribute' }, { ...declare('pane.Pane.activity'), kind: 'attribute' }, { ...declare('server.Server.session'), kind: 'method' },
    ], (symbol) => `/en/rs/latest/reference/${symbol.slug}/`, 'rs')

    it('stays plain code when nothing documents it, though a word in it names a member', async () => {
      const root = await render('Build with `control-mode` or `unstable-fuzzing`.', undefined, members)
      expect([...root.querySelectorAll('code.api-literal')].map((code) => [code.textContent, code.querySelectorAll('a').length])).toEqual([['control-mode', 0], ['unstable-fuzzing', 0]])
    })

    it('does not touch a tmux option or command written the same way: the tmux linker names the whole word first', async () => {
      const root = await render('Set `monitor-activity`, then run `new-session`.', undefined, members)
      const links = [...root.querySelectorAll<DomAnchor>('a.tmux-mention')]
      expect(links.map((link) => [link.textContent, link.dataset.apiKind, link.getAttribute('href')?.startsWith('/tmux/latest/')])).toEqual([
        ['monitor-activity', 'option', true], ['new-session', 'command', true],
      ])
      expect(root.querySelectorAll('a')).toHaveLength(2)
      // The words of each name no member's: the literal's own parts stay plain, which is the linker's doing and not the tmux link's.
      expect(members.docSpans('`monitor-activity` and `new-session`').filter((span) => span.kind === 'ref').map((span) => 'parts' in span && span.parts?.some((part) => part.link))).toEqual([false, false])
    })
  })

  describe('a file path or a tmux word in a code literal', () => {
    // Members named for the words in each, so a path split at its slashes or a word matched by its short name would link them.
    const owned = (id: string, kind: ApiSymbol['kind']): ApiSymbol => ({ ...declare(id), kind, parent: id.slice(0, id.lastIndexOf('.')) })
    const scope = owned('model.OptionArgs.scope', 'attribute')
    const members = new SymbolIndex([
      declare('mcp.Main'), owned('mcp.Main.main', 'method'), declare('test.TestServer'), owned('test.TestServer.server', 'method'),
      declare('model.OptionArgs'), scope, owned('model.OptionArgs.pane', 'attribute'), owned('test.TestServer.send_keys', 'method'),
    ], (symbol) => `/en/java/latest/reference/${symbol.slug}/`, 'java')

    it('links nothing inside the path of a source file, though a directory in it is named like a method', async () => {
      const root = await render('Save this program as `src/main/java/ListWindows.java`.', scope, members)
      expect([...root.querySelectorAll('code.api-literal')].map((code) => [code.textContent, code.querySelectorAll('a').length])).toEqual([['src/main/java/ListWindows.java', 0]])
      expect(root.querySelectorAll('a')).toHaveLength(0)
    })

    it('links an identifier of another type\'s member, since an underscore says which declaration it means', async () => {
      const root = await render('Send with `send_keys`, not the `server`.', scope, members)
      expect([...root.querySelectorAll('a.api-xref')].map((link) => [link.textContent, link.getAttribute('href')])).toEqual([['send_keys()', '/en/java/latest/reference/test-testserver-send_keys/']])
    })

    it('links nothing for a word that is only the short name of a member of another type, and still links the documented type\'s own', async () => {
      const root = await render('One of `server`, `session` or `pane`.', scope, members)
      expect([...root.querySelectorAll('a.api-xref')].map((link) => [link.textContent, link.getAttribute('href')])).toEqual([['pane', '/en/java/latest/reference/model-optionargs-pane/']])
      expect([...root.querySelectorAll('code.api-literal')].map((code) => code.textContent)).toEqual(['server', 'session', 'pane'])
    })
  })

  it('is caught when a reference is plain or badged, so the check above can fail', () => {
    const plain = window.document.createElement('div')
    plain.innerHTML = '<a class="api-xref" href="/en/ts/latest/reference/pane-pane/"><code class="api-literal api-literal--link">Pane</code></a>'
    expect(problems(plain)).toEqual([
      '/en/ts/latest/reference/pane-pane/: not a mention',
      '/en/ts/latest/reference/pane-pane/: lost its kind',
    ])
    const marked = window.document.createElement('div')
    const badge = '<span class="api-link-kind"></span><code>Pane</code>'
    marked.innerHTML = `<a class="api-xref api-mention" href="/p/" title="class" data-api-kind="class" aria-label="class: Pane">${badge}</a>`
    expect(problems(marked)).toEqual(['/p/: carries a kind badge'])
  })
})

describe('a callable named in prose', () => {
  const declare = (id: string, kind: ApiSymbol['kind']): ApiSymbol => ({
    id, publicId: id, name: id.split('.').at(-1)!, kind, slug: id.replaceAll('.', '-').toLowerCase(),
    modifiers: [], signatures: [], source: { file: 'pane.ts' },
  })
  const local = new SymbolIndex([
    declare('pane.Pane', 'class'), declare('pane.Pane.kill', 'method'), declare('pane.Pane.id', 'property'), declare('pane.open', 'function'),
  ], (symbol) => `/en/ts/latest/reference/${symbol.slug}/`, 'ts')
  const linked = (root: Pick<DomElement, 'querySelectorAll'>) => [...root.querySelectorAll<DomAnchor>('a.api-mention')].map((link) => [link.textContent, link.dataset.apiKind])

  it('reads as a call when it is a method or a function, and as written when it is not', async () => {
    const root = await render('Call `Pane.kill` or `open`; read `Pane.id` of a `Pane`.', undefined, local)
    expect(linked(root)).toEqual([['Pane.kill()', 'method'], ['open()', 'function'], ['Pane.id', 'property'], ['Pane', 'class']])
    // The accessible name holds the visible text, parentheses included, so a voice command that says it works.
    expect([...root.querySelectorAll('a.api-mention')].map((link) => link.getAttribute('aria-label')))
      .toEqual(['method: Pane.kill()', 'function: open()', 'property: Pane.id', 'class: Pane'])
  })

  it('leaves the words an author chose for the link, and an operator, as written', async () => {
    const java = new SymbolIndex([declare('pane.Pane', 'class'), declare('pane.Pane.kill', 'method')], (symbol) => `/en/java/latest/reference/${symbol.slug}/`, 'java')
    const explicit = await render('Wait for the {@link Pane#kill readiness callback}.', undefined, java)
    expect(linked(explicit)).toEqual([['readiness callback', 'method']])
    expect(explicit.querySelector('a.api-mention')?.getAttribute('aria-label')).toBe('method: readiness callback')
    // An operator resolves beside its own declaration: Swift's `==` from `hash(into:)`, Scala's `&&` and `||` from themselves.
    const operator = async (port: 'swift' | 'scala', owner: string, label: string) => {
      const context = API_MODELS[port].symbols.find((symbol) => symbol.id === owner)!
      const root = await render(`Compare with \`${label}\`.`, context, indexFor(API_MODELS[port], (symbol) => `/en/${port}/latest/reference/${symbol.slug}/`))
      return linked(root)
    }
    expect(await operator('swift', 'Server.hash(into:)', '==')).toEqual([['==', 'function']])
    expect(await operator('scala', 'io.github.libtmux.scaladsl.query.Expr.&&', '&&')).toEqual([['&&', 'method']])
    expect(await operator('scala', 'io.github.libtmux.scaladsl.query.Expr.||', '||')).toEqual([['||', 'method']])
  })

  it('keeps a label that already says how it is invoked', async () => {
    expect(linked(await render('Call `Pane.kill()`.', undefined, local))).toEqual([['Pane.kill()', 'method']])
    // Elixir writes a function with its arity and PowerShell invokes a cmdlet by name.
    const elixir = await render('See `LibTmux.Capture.fetch/2`.', undefined, indexFor(API_MODELS.elixir, (symbol) => `/en/elixir/latest/reference/${symbol.slug}/`))
    expect(linked(elixir)).toEqual([['LibTmux.Capture.fetch/2', 'function']])
    const powershell = await render('See `Connect-TmuxServer`.', undefined, indexFor(API_MODELS.powershell, (symbol) => `/en/powershell/latest/reference/${symbol.slug}/`))
    expect(linked(powershell)).toEqual([['Connect-TmuxServer', 'function']])
  })
})

describe('a symbol written as its language writes it', () => {
  /** The links of `text` in `port`'s real model, read from the page of `owner` (an id) when one is given. */
  const write = async (port: string, text: string, owner?: string) => {
    const model = API_MODELS[port]
    const context = owner ? model.symbols.find((symbol) => symbol.id === owner) : undefined
    if (owner) expect(context, owner).toBeTruthy()
    const root = await render(text, context, indexFor(model, (symbol) => `/en/${port}/latest/reference/${symbol.slug}/`))
    return [...root.querySelectorAll<DomAnchor>('a.api-mention')].map((link) => [link.textContent, link.dataset.apiKind, link.getAttribute('aria-label')])
  }

  // One method of each language through the real model: the text a reader sees, and the name a screen reader hears.
  it.each([
    ['py', '`Session.new_window`', undefined, 'Session.new_window()'],
    ['ts', '`Server.clients`', undefined, 'Server.clients()'],
    ['rs', '`Client::name`', undefined, 'Client::name()'],
    ['java', '{@link #capture()}', 'io.github.libtmux.Pane.Pane', '#capture()'],
    ['csharp', '`LibTmux.Server.RunShellAsync`', undefined, 'LibTmux.Server.RunShellAsync()'],
    ['cxx', '`Window::zoomed()`', 'libtmux::Window', 'Window::zoomed()'],
    ['lua', '`libtmux.Server:snapshot`', undefined, 'libtmux.Server:snapshot()'],
    ['swift', '``Server/clients()``', undefined, 'Server.clients()'],
    ['go', '`Server.Cmd`', undefined, 'Server.Cmd'],
    ['kotlin', '`Server.newSession`', undefined, 'Server.newSession'],
    ['julia', '`LibTmux.snapshot`', undefined, 'LibTmux.snapshot'],
    ['ruby', '`Server#snapshot`', undefined, 'Server#snapshot'],
  ])('%s: %s reads %s, and is announced as it reads', async (port, text, owner, shown) => {
    const links = await write(port, `See ${text}.`, owner)
    expect(links).toHaveLength(1)
    const [[visible, kind, name]] = links
    expect(['method', 'function']).toContain(kind)
    expect([visible, name]).toEqual([shown, `${kind}: ${shown}`])
  })

  it('writes a Ruby method of the owner\'s page without its owner: `#snapshot`', async () => {
    expect((await write('ruby', 'See `#snapshot`.', 'LibTmux::Server')).map(([text]) => text)).toEqual(['#snapshot'])
  })
})

describe('a name that is not a call', () => {
  const read = async (port: string, text: string, context?: string) => {
    const model = API_MODELS[port]
    const owner = context ? model.symbols.find((symbol) => symbol.id === context) : undefined
    const root = await render(text, owner, indexFor(model, (symbol) => `/en/${port}/latest/reference/${symbol.slug}/`))
    return [...root.querySelectorAll<DomAnchor>('a.api-mention')].map((link) => [link.textContent, link.dataset.apiKind, link.getAttribute('aria-label')])
  }

  it('writes an environment variable without the shell\'s sigil, in the prose of a real Python symbol', async () => {
    const symbol = API_MODELS.py.symbols.find((entry) => entry.id === 'libtmux.exc.NotInsideTmux')!
    expect(symbol.doc?.body).toContain('``$TMUX`` and ``$TMUX_PANE``')
    const root = await render(symbol.doc!.body!, symbol, indexFor(API_MODELS.py, (entry) => `/en/py/latest/reference/${entry.slug}/`))
    expect([...root.querySelectorAll('code')].map((code) => code.textContent)).toEqual(['TMUX', 'TMUX_PANE', 'from_env()'])
    expect(root.body.textContent).not.toContain('$')
  })

  it('leaves a shell prompt, a variable of the reader\'s and other sigils as written', async () => {
    const root = await render('Run `$ tmux ls`, set `$Server`, read `${TMUX}` or `$env:TMUX`; `$tmux` and `$TMUX_PANE`.', undefined, indexFor(API_MODELS.py, (entry) => `/en/py/latest/reference/${entry.slug}/`))
    expect([...root.querySelectorAll('code')].map((code) => code.textContent)).toEqual(['$ tmux ls', '$Server', '${TMUX}', '$env:TMUX', '$tmux', 'TMUX_PANE'])
  })

  it('names a Python MCP tool as a tool is named, not as a call', async () => {
    const id = 'libtmux_mcp.tools.pane_tools.snapshot_pane'
    expect(await read('py', `Call \`${id}\`.`)).toEqual([[id, 'function', `function: ${id}`]])
    // A callable of the same package that is no tool is still a call.
    expect(await read('py', 'Call `libtmux_mcp.tools.register_tools`.')).toEqual([['libtmux_mcp.tools.register_tools()', 'function', 'function: libtmux_mcp.tools.register_tools()']])
    expect(await read('py', 'Call `Session.new_window`.')).toEqual([['Session.new_window()', 'method', 'method: Session.new_window()']])
  })

  it('names a Rust MCP tool as a tool is named, not as a call', async () => {
    expect(await read('rs', 'Call `TmuxTools::snapshot_pane`.')).toEqual([['TmuxTools::snapshot_pane', 'method', 'method: TmuxTools::snapshot_pane']])
    expect(await read('rs', 'Call `Pane::send_keys`.')).toEqual([['Pane::send_keys()', 'method', 'method: Pane::send_keys()']])
  })

  it('marks every tool a port registers and no other callable', () => {
    const marked = (port: string) => indexFor(API_MODELS[port], (entry) => `/en/${port}/latest/reference/${entry.slug}/`)
    const tools = (port: string) => API_MODELS[port].symbols.filter((symbol) => marked(port).isMcpTool(symbol))
    expect(tools('py')).toHaveLength(MCP_REFERENCE.py.registrations.length)
    expect(tools('rs')).toHaveLength(MCP_REFERENCE.rs.registrations.length)
    expect(tools('py').every((symbol) => symbol.product === 'mcp' && symbol.id.startsWith('libtmux_mcp.tools.'))).toBe(true)
    expect(tools('rs').every((symbol) => symbol.product === 'mcp' && symbol.parent === 'mcp.src.TmuxTools')).toBe(true)
    // Ruby registers `close` and `run`, which other callables of its MCP product share: no match is complete, so none is a tool.
    expect(tools('ruby')).toEqual([])
  })

  it('writes a tmux command found in a code span without parentheses, whatever the language', async () => {
    for (const port of ['py', 'ruby', 'go']) {
      const model = API_MODELS[port]
      const root = await render('Run `new-session()`, or `new-session`.', undefined, indexFor(model, (symbol) => `/en/${port}/latest/reference/${symbol.slug}/`))
      expect([...root.querySelectorAll<DomAnchor>('a.tmux-mention')].map((link) => [link.textContent, link.dataset.apiKind, link.getAttribute('aria-label')]), port)
        .toEqual([['new-session', 'command', 'tmux command: new-session'], ['new-session', 'command', 'tmux command: new-session']])
    }
  })
})

describe('a name repeated in one docstring', () => {
  it('is the link alone in every paragraph, each keeping its kind', async () => {
    const root = await renderProse('Read a `Pane`.\n\nThen a `Pane` again.')
    expect(root.querySelectorAll('a.api-xref')).toHaveLength(2)
    expect(root.querySelector('.api-link-kind')).toBeNull()
    expect(problems(root)).toEqual([])
  })
})

describe('a capability directory in a doc comment', () => {
  const declare = (id: string, kind: ApiSymbol['kind']): ApiSymbol => ({
    id, publicId: id, name: id.split('.').at(-1)!, kind, slug: id.replaceAll('.', '-').toLowerCase(),
    modifiers: [], signatures: [], source: { file: 'pane.ts' },
  })
  const pane = declare('pane.Pane', 'class')
  const local = new SymbolIndex([pane, declare('pane.Pane.kill', 'method'), declare('pane.Pane.id', 'property'), declare('pane.open', 'function')],
    (symbol) => `/en/ts/latest/reference/${symbol.slug}/`, 'ts')
  const rows = (...pairs: [string, string][]) => pairs.map(([title, refs]) => `**${title}.** What these are for.\n\n${refs}`).join('\n\n')
  const text = rows(['Control', '{@link Pane.kill}, {@link Pane.id}'], ['Read', '{@link Pane.id}'], ['Open', '{@link open}'])
  const chips = (root: Pick<DomElement, 'querySelectorAll'>) => [...root.querySelectorAll<DomAnchor>('dl.api-directory a.api-mention--chip')].map((link) => link.textContent)

  it('draws a title and its guidance beside the member chips, each chip a link that keeps its kind', async () => {
    const root = await renderProse(text, undefined, local)
    const rowsOf = [...root.querySelectorAll('dl.api-directory > .api-directory__row')]
    expect(rowsOf.map((row) => row.querySelector('dt')!.textContent)).toEqual(['Control', 'Read', 'Open'])
    expect(rowsOf.map((row) => row.querySelector('dd.api-directory__guidance')!.textContent!.trim())).toEqual(Array(3).fill('What these are for.'))
    expect(chips(root)).toEqual(['Pane.kill()', 'Pane.id', 'Pane.id', 'open()'])
    expect([...root.querySelectorAll<DomAnchor>('a.api-mention--chip')].map((link) => link.dataset.apiKind)).toEqual(['method', 'property', 'property', 'function'])
    expect(root.querySelector('.api-link-kind')).toBeNull()
  })

  it('drops the owner from a chip on the owner\'s page and keeps it elsewhere', async () => {
    expect(chips(await renderProse(text, pane, local))).toEqual(['kill()', 'id', 'id', 'open()'])
    expect(chips(await renderProse(text, undefined, local))).toEqual(['Pane.kill()', 'Pane.id', 'Pane.id', 'open()'])
  })

  it('drops the owner written with a hash, as Java spells a member', async () => {
    const java = new SymbolIndex([pane, declare('pane.Pane.kill', 'method'), declare('pane.Pane.id', 'property'), declare('pane.open', 'function')],
      (symbol) => `/en/java/latest/reference/${symbol.slug}/`, 'java')
    const hashed = rows(['Control', '{@link Pane#kill}, {@link #id}'], ['Read', '{@link Pane#id}'], ['Open', '{@link open}'])
    expect(chips(await renderProse(hashed, pane, java))).toEqual(['kill()', 'id', 'id', 'open()'])
    expect(chips(await renderProse(hashed, undefined, java))).toEqual(['Pane#kill()', '#id', 'Pane#id', 'open()'])
  })

  it('leaves a run of fewer than three rows as paragraphs', async () => {
    const root = await renderProse(rows(['Control', '{@link Pane.kill}'], ['Read', '{@link Pane.id}']), undefined, local)
    expect(root.querySelector('.api-directory')).toBeNull()
    expect(root.querySelectorAll('p')).toHaveLength(4)
  })
})

describe('a pipe table in a doc comment', () => {
  const text = 'Every handle:\n\n| To | Call |\n| --- | :-: |\n| read one | `Pane` |\n| write | `Window` and `a\\|b` |\n\nAfter.'

  it('renders as a table whose cells link their references, not as a paragraph of pipes', async () => {
    const root = await renderProse(text)
    const table = root.querySelector('.api-prose-table > table')!
    expect(table).not.toBeNull()
    // A wide table scrolls inside its region, which a keyboard must reach and a reader must hear named.
    const region = table.parentElement!
    expect([region.getAttribute('role'), region.getAttribute('aria-label'), region.getAttribute('tabindex')]).toEqual(['region', 'Table', '0'])
    expect([...table.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual(['To', 'Call'])
    expect([...table.querySelectorAll('thead th')].map((cell) => cell.getAttribute('style'))).toEqual([null, 'text-align: center'])
    expect([...table.querySelectorAll('tbody tr')].map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent)))
      .toEqual([['read one', 'Pane'], ['write', 'Window and a|b']])
    expect([...table.querySelectorAll('tbody a.api-mention')].map((link) => link.getAttribute('data-api-kind'))).toEqual(['class', 'class'])
    expect([...root.querySelectorAll('p')].map((paragraph) => paragraph.textContent!.trim())).toEqual(['Every handle:', 'After.'])
  })
})

describe('what search indexes of a mention', () => {
  it('is the bare name, with no mark leading it', async () => {
    const root = await render('Read a `Pane` and a `Window`.')
    expect(await indexedText(root.body.innerHTML)).toBe('Read a Pane and a Window.')
  })

  it('would fuse a mark to the name if prose drew one without the ignore attribute, so the check above can fail', async () => {
    const root = await render('Read a `Pane`.')
    const badge = mentionBadgeHtml(mentionBadge('class')!).replaceAll(' data-pagefind-ignore="all"', '')
    expect(await indexedText(root.body.innerHTML.replace('<code', `${badge}<code`))).toBe('Read a CPane.')
  })
})
