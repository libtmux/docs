import { readFileSync } from 'node:fs'
import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import { select, selectAll, type Element, type Nodes } from 'astro-expressive-code/hast'
import { fromHtml } from 'hast-util-from-html'
import { Window } from 'happy-dom'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { visit } from 'unist-util-visit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { kindMark } from '../src/lib/api-labels'
import { tmuxManualPreview } from '../src/lib/link-preview'
import { createLinkPreviewPolicy } from '../src/lib/link-preview-paint'
import { linkProseMarkdown } from '../src/lib/prose-markdown'
import { linkTmuxDoc, tmuxEntityHref, tmuxMentions } from '../src/lib/tmux-links'
import { linkTmuxManualEntries } from '../src/lib/tmux-manual'
import { TMUX_VERSIONS, tmuxManual, tmuxManualEntities, tmuxManualRoutes, tmuxManualUrl } from '../src/lib/tmux-manual-data'
import { GET, getStaticPaths } from '../src/pages/[...slug].preview.json'
import { rehypeApiLinks } from '../src/plugins/rehype-api-links'

beforeEach(() => vi.stubEnv('LIBTMUX_DOCS_PORT', ''))
afterEach(() => vi.unstubAllEnvs())

const processor = createMarkdownProcessor({ rehypePlugins: [rehypeApiLinks], syntaxHighlight: false })
const render = async (source: string, port = 'rs') => fromHtml((await (await processor).render(source, { frontmatter: { port } })).code, { fragment: true })
const text = (node: Nodes | undefined): string => !node ? '' : node.type === 'text' ? node.value
  : 'children' in node ? node.children.map(text).join('') : ''
const classes = (node: Element) => (node.properties.className as string[]).map((name) => name.replace(/^api-badge--kind-.+$/, 'api-badge--kind-*'))

// The sentence from the Rust concepts page that prompted the badges.
const SENTENCE = 'A control-mode connection is also a client. It appears in `list-clients`, counts toward `session_attached`, and affects attachment-dependent behavior such as `destroy-unattached`.'

describe('tmux mentions render like API mentions', () => {
  it.each([
    { name: 'list-clients', kind: 'command', mark: '$', href: '/tmux/latest/manual/list-clients/' },
    { name: 'session_attached', kind: 'format', mark: '#', href: '/tmux/latest/manual/full/#session_attached' },
    { name: 'destroy-unattached', kind: 'option', mark: 'o', href: '/tmux/latest/manual/full/#options-destroy-unattached' },
    { name: 'session-created', kind: 'hook', mark: 'h', href: '/tmux/latest/manual/full/#hooks-session-created' },
  ])('badges `$name` as a $kind with its manual destination', async ({ name, kind, mark, href }) => {
    const tree = await render(`Read \`${name}\`.`)
    const anchor = select('a.tmux-mention', tree)!
    expect(anchor.properties.href).toBe(href)
    const badge = select('.api-link-kind', anchor)!
    expect(badge.properties).toMatchObject({ dataApiKind: kind, ariaHidden: 'true' })
    expect(classes(badge)).toEqual(expect.arrayContaining(['api-link-kind', 'api-nav__kind', 'api-badge--kind-*']))
    expect(badge.properties.className).toContain(`api-badge--kind-${kind}`)
    expect(text(select('.api-badge__label', badge))).toBe(mark)
    expect(text(select('.api-symbol-link__name code', anchor))).toBe(name)
  })

  it('uses the badge classes of a library mention, so one stylesheet treats both', async () => {
    const api = select('.api-link-kind', await render('Read `Client`.'))!
    const tmux = select('.api-link-kind', await render('Read `list-clients`.'))!
    expect(api.properties.dataApiKind).toBe('struct')
    expect(classes(tmux)).toEqual(classes(api))
  })

  it('badges commands written in running text, one badge per command', async () => {
    const tree = await render('Use resize-pane and display-message to change the pane.')
    expect(selectAll('a.tmux-mention', tree).map((anchor) => [anchor.properties.href, text(select('.api-symbol-link__name', anchor))]))
      .toEqual([['/tmux/latest/manual/resize-pane/', 'resize-pane'], ['/tmux/latest/manual/display-message/', 'display-message']])
    expect(selectAll('.api-badge--kind-command', tree)).toHaveLength(2)
  })

  it('links the names in one code run without a badge that would break its flow', async () => {
    const tree = await render('Run `tmux set-option -g destroy-unattached on`.')
    const code = select('code', tree)!
    expect(selectAll('a', code).map((anchor) => [text(anchor), anchor.properties.href])).toEqual([
      ['set-option', '/tmux/latest/manual/set-option/'],
      ['destroy-unattached', '/tmux/latest/manual/full/#options-destroy-unattached'],
    ])
    expect(selectAll('.api-link-kind', tree)).toHaveLength(0)
    expect(text(code)).toBe('tmux set-option -g destroy-unattached on')
  })

  it('lets a library symbol keep a name it documents, in HTML and Markdown alike', async () => {
    const source = 'Read `session_name` and `session_attached`.'
    const hrefs = selectAll('a', await render(source)).map((anchor) => String(anchor.properties.href))
    const exported: string[] = []
    visit(fromMarkdown(linkProseMarkdown(source, 'rs')), 'link', (node) => { exported.push(node.url) })
    expect(hrefs[0]).toMatch(/^\/rs\/latest\/(?:workspace\/)?reference\//)
    expect(hrefs[1]).toBe('/tmux/latest/manual/full/#session_attached')
    expect(exported).toEqual(hrefs)
  })

  it('links names the manual documents and leaves everything else plain', async () => {
    const tree = await render('Keep `session_unknown`, `destroy-nothing`, `mouse`, `pid` and session_attached in prose. Link `session_attached`.', 'go')
    expect(selectAll('a', tree).map((anchor) => anchor.properties.href)).toEqual(['/tmux/latest/manual/full/#session_attached'])
    expect(selectAll('code', tree).map(text)).toEqual(['session_unknown', 'destroy-nothing', 'mouse', 'pid', 'session_attached'])
  })

  it('exports the same links as plain Markdown, without badge markup or changed text', async () => {
    const hrefs = selectAll('a', await render(SENTENCE)).map((anchor) => [text(select('code', anchor)), anchor.properties.href])
    const markdown = linkProseMarkdown(SENTENCE, 'rs')
    const exported: string[][] = []
    visit(fromMarkdown(markdown), 'link', (node) => { exported.push([text(node as never) || (node.children[0] as { value: string }).value, node.url]) })
    expect(exported).toEqual(hrefs)
    expect(hrefs).toHaveLength(3)
    expect(markdown).not.toMatch(/api-link-kind|data-api-kind|tmux-mention|<span/)
    expect(markdown.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')).toBe(SENTENCE)
  })
})

describe('tmux name detection', () => {
  it.each([
    ['session_attached', 'format'],
    ['#{?session_attached,attached,not attached}', 'format'],
    ['list-panes -F "#{pane_id}"', 'command'],
    ['#{==:#{pane_id},%1}', 'format'],
    ['destroy-unattached', 'option'],
    ['set-option -g history-limit 5000', 'command'],
    ['pane-died', 'hook'],
  ])('finds a documented name in `%s`', (code, kind) => {
    const kinds = tmuxMentions(code, { code: true }).map((mention) => mention.kind)
    expect(kinds).toContain(kind)
    expect(tmuxMentions(code, { code: true }).every((mention) => code.slice(mention.start, mention.end) === mention.text)).toBe(true)
  })

  it.each([
    'session_unknown', 'destroy-nothing', 'mouse', 'pid', 'tmux://panes/{pane_id}', 'capture_pane(pane_id)',
    'pane.session_attached', '$session_attached', '--destroy-unattached', '/tmp/destroy-unattached', '"destroy-unattached"',
  ])('does not link `%s`', (code) => {
    expect(tmuxMentions(code, { code: true })).toEqual([])
  })

  it('claims options, hooks and format variables only in code', () => {
    expect(tmuxMentions('session_attached destroy-unattached session-created')).toEqual([])
    expect(tmuxMentions('session_attached', { code: true })).toHaveLength(1)
    expect(tmuxMentions('Use list-clients', {}).map((mention) => mention.name)).toEqual(['list-clients'])
  })

  it('splits API-doc spans around every kind and keeps unknown code intact', () => {
    expect(linkTmuxDoc([
      { kind: 'code', text: 'session_attached' }, { kind: 'code', text: 'session_unknown' },
      { kind: 'text', text: 'session_attached is only a word here' },
    ])).toEqual([
      { kind: 'link', text: 'session_attached', code: true, href: '/tmux/latest/manual/full/#session_attached' },
      { kind: 'code', text: 'session_unknown' },
      { kind: 'text', text: 'session_attached is only a word here' },
    ])
  })
})

describe('tmux entity destinations', () => {
  it('resolves every kind through one function and nothing the release lacks', () => {
    expect(tmuxEntityHref('command', 'list-clients')).toBe('/tmux/latest/manual/list-clients/')
    expect(tmuxEntityHref('format', 'session_attached')).toBe('/tmux/latest/manual/full/#session_attached')
    expect(tmuxEntityHref('option', 'destroy-unattached')).toBe('/tmux/latest/manual/full/#options-destroy-unattached')
    expect(tmuxEntityHref('hook', 'session-created')).toBe('/tmux/latest/manual/full/#hooks-session-created')
    expect(tmuxEntityHref('format', 'session_unknown')).toBeUndefined()
    expect(tmuxEntityHref('option', 'session_attached')).toBeUndefined()
    expect(tmuxEntityHref('option', 'pane-scrollbars', '3.7c')).toBe('/tmux/3.7c/manual/full/#options-pane-scrollbars')
    expect(tmuxEntityHref('option', 'pane-scrollbars', '3.2a')).toBeUndefined()
  })

  it.each(TMUX_VERSIONS)('anchors every %s option, hook and format variable on the rendered manual', (version) => {
    const rendered = fromHtml(linkTmuxManualEntries(tmuxManual(version).manual), { fragment: true })
    const ids = new Map(selectAll('[id]', rendered).map((node) => [String(node.properties.id), node]))
    const entities = tmuxManualEntities(version)
    for (const [kind, floor] of [['option', 90], ['hook', 15], ['format', 150]] as const) {
      expect(entities.filter((entity) => entity.kind === kind).length, kind).toBeGreaterThan(floor)
    }
    const commands = new Set(tmuxManual(version).commands.map((command) => command.name))
    const seen = new Set<string>()
    for (const entity of entities) {
      const node = ids.get(entity.anchor)
      expect(node?.tagName, `${entity.kind} ${entity.name}`).toBe(entity.kind === 'format' ? 'tr' : 'dt')
      expect(text(node)).toContain(entity.name)
      expect(tmuxEntityHref(entity.kind, entity.name, version)).toBe(`${tmuxManualUrl(version, 'full')}#${entity.anchor}`)
      expect(commands.has(entity.name), `${entity.name} is also a command`).toBe(false)
      expect(seen.has(entity.name), `${entity.name} is documented under two kinds`).toBe(false)
      seen.add(entity.name)
    }
  })
})

describe('tmux hover cards', () => {
  it('previews a command with its manual summary, syntax and alias', () => {
    const command = tmuxManual('latest').commands.find((entry) => entry.name === 'list-clients')!
    expect(tmuxManualPreview('latest', 'list-clients')).toEqual({
      schema: 1, title: 'list-clients', kind: 'command', description: command.summary,
      signature: `tmux list-clients ${command.usage}`, signatureLanguage: 'tmux-usage', detail: 'Alias: lsc.',
      href: '/tmux/latest/manual/list-clients/', actionLabel: 'Open manual',
    })
  })

  it('previews each format variable, option and hook by its manual anchor', () => {
    const { terms, actionLabel } = tmuxManualPreview('latest', 'full')
    expect(actionLabel).toBe('Open manual')
    expect(terms!.session_attached).toEqual({
      schema: 1, title: 'session_attached', kind: 'format', description: 'Number of clients session is attached to',
      detail: 'Format variable', href: '/tmux/latest/manual/full/#session_attached', actionLabel: 'Open manual',
    })
    expect(terms!['options-destroy-unattached']).toEqual({
      schema: 1, title: 'destroy-unattached', kind: 'option', detail: 'Session option',
      description: 'If on, destroy the session after the last client has detached.',
      signature: 'destroy-unattached [off | on | keep-last | keep-group]', signatureLanguage: 'tmux-usage',
      href: '/tmux/latest/manual/full/#options-destroy-unattached', actionLabel: 'Open manual',
    })
    expect(terms!['hooks-session-created']).toMatchObject({ kind: 'hook', detail: 'Hook', description: 'Run when a new session created.' })
    for (const [anchor, term] of Object.entries(terms!)) {
      expect(term.href.endsWith(`#${anchor}`), anchor).toBe(true)
      expect(term.description, anchor).not.toBe('')
    }
  })

  it('serves a preview for every manual page, highlighted like other signatures', async () => {
    for (const { version, slug } of tmuxManualRoutes()) if (slug) expect(() => tmuxManualPreview(version, slug), `${version}/${slug}`).not.toThrow()
    const preview = tmuxManualPreview('latest', 'list-clients')
    const payload = await (await GET({ props: { preview } } as unknown as Parameters<typeof GET>[0])).json()
    expect(payload.signatureHighlight.language).toBe('tmux-usage')
    expect(payload.signatureHighlight.lines.map((line: { content: string }[]) => line.map((token) => token.content).join('')).join('\n'))
      .toBe(preview.signature)
    const slugs = getStaticPaths().map((path) => path.params.slug)
    expect(slugs).toEqual(expect.arrayContaining(['tmux/latest/manual/list-clients', 'tmux/latest/manual/full', 'tmux/3.2a/manual/list-clients']))
  })

  describe('eligibility', () => {
    let win: Window
    beforeEach(() => {
      win = new Window({ url: 'https://libtmux.org/en/rs/latest/concepts/server-session-window-pane/' })
      vi.stubGlobal('Element', win.Element)
    })
    afterEach(async () => { await win.happyDOM.abort(); vi.unstubAllGlobals() })

    it('offers a card for command pages and manual entries, not for the index, permalinks or the command list', () => {
      win.document.body.innerHTML = `<p>
        <a id="command" href="/en/tmux/latest/manual/list-clients/">list-clients</a>
        <a id="entry" href="/en/tmux/latest/manual/full/#session_attached">session_attached</a>
        <a id="older" href="/pr-7/en/tmux/3.2a/manual/capture-pane/">capture-pane</a>
        <a id="index" href="/en/tmux/latest/manual/">All commands</a>
        <a id="permalink" class="permalink" href="/en/tmux/latest/manual/full/#destroy">destroy</a>
        <a id="source" href="/en/tmux/latest/reference/">C source</a></p>
        <dl class="cli-command-list"><dt><a id="listed" href="/en/tmux/latest/manual/list-clients/">list-clients</a></dt></dl>`
      const policy = createLinkPreviewPolicy()
      const eligible = [...win.document.querySelectorAll('a')].filter((anchor) =>
        policy.candidate(anchor as unknown as HTMLAnchorElement, win.location.href)).map((anchor) => anchor.id)
      expect(eligible).toEqual(['command', 'entry', 'older'])
      expect(policy.target('/en/tmux/latest/manual/full/#session_attached', 'https://libtmux.org')?.endpoint)
        .toBe('/en/tmux/latest/manual/full.preview.json')
    })
  })
})

describe('tmux badge palette', () => {
  const css = readFileSync(new URL('../src/styles/api-kinds.css', import.meta.url), 'utf8')
  it.each(['command', 'option', 'hook', 'format'])('defines the %s badge once per theme and keeps its mark to one glyph', (kind) => {
    // Light, the system dark preference, and an explicit dark choice.
    for (const part of ['bg', 'fg', 'border']) expect(css.match(new RegExp(`--api-kind-${kind}-${part}:`, 'g')), `${kind} ${part}`).toHaveLength(3)
    expect(css).toMatch(new RegExp(`\\.api-badge--kind-${kind}\\s*\\{[^}]*var\\(--api-kind-${kind}-bg\\)[^}]*var\\(--api-kind-${kind}-fg\\)`))
    expect(kindMark(kind)).toHaveLength(1)
  })
})
