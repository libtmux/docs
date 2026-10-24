import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { parseManual } from '../../scripts/gen-tmux-manual.mjs'
import { buildsTmuxDocumentation, tmuxApiLinks, tmuxCommandNotes, tmuxCommandsFor, tmuxGuidesFor, tmuxManualHtml, tmuxManualHeadings, tmuxManual, tmuxManualUrl, tmuxManualVersionUrl } from '../src/lib/tmux-manual-data'
import { highlightTmuxManual, linkTmuxManualEntries, markTmuxManualKeys } from '../src/lib/tmux-manual'
import { tmuxKeyList } from '../src/lib/tmux-keys'
import { tmuxManualNavigation } from '../src/lib/tmux-manual-navigation'
import { fromHtml } from 'hast-util-from-html'
import { select, selectAll, type Element, type Nodes } from 'astro-expressive-code/hast'
import { toMdast } from 'hast-util-to-mdast'
import { gfmToMarkdown } from 'mdast-util-gfm'
import { toMarkdown } from 'mdast-util-to-markdown'
import pins from '../src/data/tmux/versions.json'

const contents = (node: Nodes): string => node.type === 'text' ? node.value
  : 'children' in node ? node.children.map(contents).join('') : ''

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

describe('versioned tmux manual', () => {
  beforeAll(async () => { await highlightTmuxManual('<pre>set -g status off</pre>') })
  it.each([
    { version: '3.2a', sourceCommit: '3b929f332aafa7f1080eacc31feb11ffbb1d1841',
      sourceTree: '97d85a509a253bccf8d70766b63e13a4a562901d' },
    { version: '3.7c', sourceCommit: 'e476c1230b958df0cb12977517d24b3dc931375b',
      sourceTree: 'ad5fe15a4b84ae9489eb4bb643f932ffab949ed2' },
  ])('retains the original $version pin and its verified commit and tree separately', (source) => {
    const reference = tmuxManual(source.version)
    expect(reference).toMatchObject(source)
    expect(reference.revision).toBe(pins.versions.find((pin) => pin.version === source.version)!.revision)
    expect(reference.sourceCommit).not.toBe(reference.revision)
  })
  it.each(['3.2a', '3.7c'])('links every %s definition without colliding keys or losing old targets', (version) => {
    const original = fromHtml(tmuxManual(version).manual, { fragment: true })
    const linked = fromHtml(linkTmuxManualEntries(tmuxManual(version).manual), { fragment: true })
    const ids = selectAll('[id]', linked).map((node) => node.properties.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const node of selectAll('[id]', original)) expect(ids).toContain(node.properties.id)
    for (const node of selectAll('dt', linked)) {
      expect(node.properties.id).toBeTruthy()
      expect(select(`a[href="#${node.properties.id}"]`, node)).toBeDefined()
      expect(select('a a', node)).toBeUndefined()
    }
    expect(contents(select('#default-key-binding-l', linked)!)).toBe('l')
    expect(contents(select('#default-key-binding-shift-l', linked)!)).toBe('L')
    expect(contents(select('#default-key-binding-left-bracket', linked)!)).toBe('[')
    expect(contents(select('#default-key-binding-right-bracket', linked)!)).toBe(']')
  })

  it.each(['3.2a', '3.7c'])('highlights the %s manual without changing example text or destinations', async (version) => {
    const html = tmuxManualHtml(tmuxManual(version).manual, version)
    const original = fromHtml(html, { fragment: true })
    const rendered = fromHtml(await highlightTmuxManual(html), { fragment: true })
    expect(selectAll('pre:not([data-language="tmux-usage"])', rendered).map(contents))
      .toEqual(selectAll('pre', original).map(contents))
    expect(selectAll('pre span[style*="--shiki-light:"]', rendered).length).toBeGreaterThan(100)
    expect(contents(select('[data-language="tmux-usage"]', rendered)!))
      .toBe(contents(select('table.Nm', original)!).replace(/\s+/g, ' ').trim())
    expect(selectAll('a', rendered).map((node) => node.properties.href))
      .toEqual(selectAll('a', original).map((node) => node.properties.href))
  })
  it('organizes every capture flag for lookup without showing flags from newer tmux releases', () => {
    const current = tmuxCommandNotes('latest', 'capture-pane')!
    const old = tmuxCommandNotes('3.2a', 'capture-pane')!
    const flags = (notes: typeof current) => notes.groups.flatMap((group) => group.options.map((option) => option.flag)).sort()
    expect(flags(current)).toEqual(['C', 'E', 'F', 'H', 'J', 'L', 'M', 'N', 'P', 'S', 'T', 'a', 'b', 'e', 'p', 'q', 't'])
    expect(flags(old)).toEqual(['C', 'E', 'J', 'N', 'P', 'S', 'a', 'b', 'e', 'p', 'q', 't'])
    expect(current.groups[1].options.find((option) => option.flag === 'J')!.text).toContain('Implies -T.')
    expect(old.groups[1].options.find((option) => option.flag === 'J')!.text).not.toContain('-T')
    expect(current.examples.map((example) => example.code)).toEqual([
      'tmux capture-pane -p -t "$TMUX_PANE"',
      'tmux capture-pane -p -J -S -1000 -t "$TMUX_PANE"',
    ])
    expect(current.context).toContain('inside tmux')
    expect(tmuxCommandNotes('latest', 'new-session')).toBeUndefined()
  })

  it('keeps version-specific commands and flags separate', () => {
    const old = tmuxManual('3.2a')
    const current = tmuxManual('latest')
    expect(old.commands).toHaveLength(87)
    expect(current.commands).toHaveLength(91)
    expect(current).toBe(tmuxManual('3.7c'))
    expect(old.commands.some((command) => command.name === 'new-pane')).toBe(false)
    expect(current.commands.some((command) => command.name === 'new-pane')).toBe(true)
    for (const version of ['3.2a', 'latest']) {
      const navigation = tmuxManualNavigation(version).json
      expect(Object.values(navigation.members).flat().map((entry) => entry[2]).sort())
        .toEqual(tmuxManual(version).commands.map((command) => command.name).sort())
      expect(Object.values(navigation.hrefs!))
        .toEqual(navigation.buckets[0]!.types.map((section) => `${tmuxManualUrl(version)}#${section.id.slice('section:'.length)}`))
    }
    const capture = (version: string) => tmuxManual(version).commands.find((command) => command.name === 'capture-pane')!
    expect(capture('3.2a').usage.split(']')[0]).not.toContain('F')
    expect(capture('3.7c').usage.split(']')[0]).toContain('F')
    expect(() => tmuxManual('3.99')).toThrow('Unknown tmux manual version')
  })

  it('stays in the selected version and the root build', () => {
    expect(buildsTmuxDocumentation({})).toBe(true)
    expect(buildsTmuxDocumentation({ LIBTMUX_DOCS_PORT: 'go' })).toBe(false)
    expect(buildsTmuxDocumentation({ LIBTMUX_DOCS_LOCALE: 'ja' })).toBe(false)
    const html = tmuxManualHtml(tmuxManual('latest').manual, 'latest')
    expect(html).toContain(`href="${tmuxManualUrl('latest', 'capture-pane')}"`)
    expect(html).not.toContain('/tmux/3.7c/')
  })

  it('preserves real command counterparts and falls back for newer commands', () => {
    expect(tmuxManualVersionUrl('3.2a', 'capture-pane')).toBe(tmuxManualUrl('3.2a', 'capture-pane'))
    expect(tmuxManualVersionUrl('3.2a', 'new-pane')).toBe(tmuxManualUrl('3.2a'))
    expect(tmuxManualVersionUrl('3.7c', 'new-pane')).toBe(tmuxManualUrl('3.7c', 'new-pane'))
    expect(tmuxManualVersionUrl('3.2a', 'full')).toBe(tmuxManualUrl('3.2a', 'full'))
  })

  it('links commands and retains upstream descriptions and license', () => {
    const commands = [{ name: 'capture-pane', alias: 'capturep', usage: '[-p]' }]
    const html = '<section class="Sh"><h1 id="PANES">Panes</h1><dl><dt><code class="Ic">capture-pane</code></dt><dd><div class="Bd">(alias: capturep)</div>Capture visible lines. See <a href="#FORMATS">formats</a> and <code class="Ic">capturep</code>.</dd></dl></section>'
    const result = parseManual(html, commands, '3.7c')
    expect(result.commands[0].summary).toBe('Capture visible lines.')
    expect(result.commands[0].html).not.toContain('(alias:')
    expect(result.commands[0].html).toContain('/tmux/3.7c/manual/full/#FORMATS')
    expect(result.commands[0].html).toContain('/tmux/3.7c/manual/capture-pane/')
    const older = html.replace('(alias: capturep)</div>', '(alias: capturep</div>\n    ) ')
    expect(parseManual(older, commands, '3.2a').commands[0].summary).toBe('Capture visible lines.')
    expect(tmuxManual('latest').license).toContain('Permission to use, copy, modify, and distribute')
    expect(() => parseManual(html.replace('capture-pane</code>', 'unknown</code>'), commands, '3.7c')).toThrow('Command absent from the manual')
  })

  it('excludes the formatter build date and host from the pinned manual', () => {
    const manual = '<section class="Sh"><h1 id="DESCRIPTION">Description</h1><p>tmux usage.</p></section>'
    const first = `${manual}<table class="foot"><tr><td>October 1, 2026</td><td>Debian</td></tr></table>`
    const second = `${manual}<table class="foot"><tr><td>October 2, 2026</td><td>OpenBSD</td></tr></table>`
    expect(parseManual(first, [], '3.7c')).toEqual(parseManual(second, [], '3.7c'))
    expect(parseManual(first, [], '3.7c').manual).not.toContain('October')
  })

  it('links translated pages to the English reference inside the preview', async () => {
    vi.stubEnv('LIBTMUX_DOCS_ROOT', '/pr-42/ja')
    vi.stubEnv('LIBTMUX_DOCS_PORT_ROOT', '/pr-42/en')
    vi.resetModules()
    const { tmuxManualUrl: referenceUrl } = await import('../src/lib/tmux-manual-data')
    expect(referenceUrl('3.2a', 'capture-pane')).toBe('/pr-42/en/tmux/3.2a/manual/capture-pane/')
  })

  it('leaves a recorded command to the code that sends it, and keeps the concepts for the language picker', () => {
    // Every command of the manual has recorded usage, so a concept never names one: what a method sends comes from its source.
    for (const [port, id] of [['ts', 'pane.Pane.capture'], ['ts', 'server.Server.sessions'], ['ts', 'server.Server.windows'], ['ts', 'pane.Pane.split'], ['ts', 'Unrelated.capture']]) {
      expect(tmuxCommandsFor(port, id), id).toEqual([])
    }
    // The picker still lands TypeScript on the capture, whose send is one helper away.
    expect(tmuxApiLinks('capture-pane').map((link) => link.name)).toContain('TypeScript')
  })

  it('exports the same command sections and related guides as the page', () => {
    expect(tmuxManualHeadings('latest', 'capture-pane').map((heading) => heading.slug))
      .toEqual(['capture-pane-common-uses', 'capture-pane-syntax', 'capture-pane-options',
        'capture-pane-options-output-and-line-range', 'capture-pane-options-text-formatting',
        'capture-pane-options-screens-and-pending-output', 'capture-pane-guides', 'capture-pane-use-from-a-library'])
    expect(tmuxManualHeadings('latest', 'server-access').map((heading) => heading.slug))
      .toEqual(['server-access-syntax', 'server-access-behavior', 'server-access-use-from-a-library'])
    // A command no library sends has no such section.
    expect(tmuxManualHeadings('latest', 'set-window-option').map((heading) => heading.slug)).not.toContain('set-window-option-use-from-a-library')
    expect(tmuxGuidesFor('capture-pane').map((guide) => guide.href))
      .toEqual([tmuxManualUrl().replace('/tmux/latest/manual/', '/tmux/guides/capturing-output/')])
    expect(tmuxManualHeadings('3.2a', 'full').some((heading) => heading.slug === 'COMMANDS')).toBe(true)
  })
})

describe('tmux manual key notation', () => {
  const squash = (value: string) => value.replace(/[‘’]/g, '').replace(/\s+/g, ' ').trim()
  const commandHtml = (version: string, name: string) => tmuxManualHtml(tmuxManual(version).commands.find((command) => command.name === name)!.html, version)
  const rendered = (version: string) => fromHtml(markTmuxManualKeys(tmuxManualHtml(tmuxManual(version).manual, version)), { fragment: true })
  const elements = (node: Element) => node.children.filter((child): child is Element => child.type === 'element')
  // A key cap with caps inside it groups a sequence; it is not itself a key.
  const isGroup = (node: Element) => elements(node).length > 0
  const sectionOf = (tree: Nodes) => new Map(selectAll('section.Sh', tree as never).flatMap((section) => {
    const title = squash(contents(select('h2', section)!))
    return selectAll('kbd', section).map((node) => [node, title] as const)
  }))

  it.each(['3.2a', '3.7c'])('renders the %s bind-key sequences as nested kbd and keeps new-window a link', (version) => {
    const html = commandHtml(version, 'bind-key')
    const original = fromHtml(html, { fragment: true })
    const tree = fromHtml(markTmuxManualKeys(html, 'bind-key'), { fragment: true })
    const caps = selectAll('kbd', tree).filter(isGroup).map((node) => elements(node).map(contents))
    expect(caps).toEqual([['C-b', 'c']])
    expect(selectAll('kbd', tree).filter((node) => !isGroup(node)).map(contents)).toEqual(['c', 'C-b', 'c', 'c', 'c'])
    expect(selectAll('code.Li', tree)).toHaveLength(0)
    expect(selectAll('a[href$="/new-window/"] > code.Ic', tree).map(contents)).toEqual(['new-window', 'new-window'])
    expect(selectAll('a', tree).map((node) => node.properties.href)).toEqual(selectAll('a', original).map((node) => node.properties.href))
    // Only mandoc's quotation marks around a literal go.
    expect(squash(contents(tree))).toBe(squash(contents(original)))
  })

  it.each(['3.2a', '3.7c'])('marks %s keys only where the manual uses them as keys', (version) => {
    const tree = rendered(version)
    const keys = selectAll('kbd', tree)
    expect(keys.length).toBeGreaterThan(200)
    const inner = new Set(keys.flatMap(elements))
    for (const node of keys.filter((candidate) => !inner.has(candidate))) {
      expect(tmuxKeyList(contents(node)), contents(node)).toBeDefined()
    }
    expect([...new Set(sectionOf(tree).values())].sort()).toEqual(['BUFFERS', 'DEFAULT KEY BINDINGS', 'DESCRIPTION', 'EXAMPLES',
      'KEY BINDINGS', 'STATUS LINE', 'WINDOWS AND PANES'])
    // Literals that are not keys stay code, including single letters in formats.
    const literals = selectAll('code.Li', tree).map(contents).map(squash)
    for (const literal of ['status-style', 'bg=cyan', '{start}', '%1', '#{session_name}', 'mysession:1', 'vi', 'm']) {
      expect(literals, literal).toContain(literal)
    }
    expect(selectAll('kbd', tree).map(contents).filter((key) => /#\{|status|session|-style|mouse/i.test(key))).toEqual([])
    expect(selectAll('table.Nm kbd', tree)).toHaveLength(0)
  })

  it.each(['3.2a', '3.7c'])('describes the %s key tables, default bindings and examples with caps', (version) => {
    const tree = rendered(version)
    const terms = new Map(selectAll('dt', tree).map((node) => [squash(contents(node)), node]))
    expect(selectAll('kbd', terms.get('0 to 9')!).map(contents)).toEqual(['0', '9'])
    expect(selectAll('kbd', terms.get('Page Up')!).map(contents)).toEqual(['Page Up'])
    expect(selectAll('kbd', terms.get('C-Up, C-Down')!).map(contents)).toEqual(['C-Up', 'C-Down'])
    const keys = selectAll('kbd', tree).map(contents)
    for (const key of ['C-b', 'M-Up', 'NPage', 'Escape', 'Enter', 'BSpace', 'F12']) expect(keys, key).toContain(key)
    // The permalinks of key names keep pointing at the names.
    expect(select('kbd#Left', tree)).toBeDefined()
    expect(select('a[href$="#Left"] > kbd#Left', tree)).toBeDefined()
    expect(selectAll('span#NPage\\/PageDown\\/PgDn > kbd', tree).map(contents)).toEqual(['NPage', 'PageDown', 'PgDn'])
  })

  it('renders a key table row of alternatives as one cap each', () => {
    const tree = fromHtml(markTmuxManualKeys(commandHtml('3.7c', 'choose-client'), 'choose-client'), { fragment: true })
    expect(selectAll('tr#F1 kbd', tree).map(contents)).toEqual(['F1', 'C-h'])
    expect(squash(contents(select('tr#F1 td', tree)!))).toBe('F1 or C-h')
    const prompt = fromHtml(markTmuxManualKeys(commandHtml('3.7c', 'command-prompt'), 'command-prompt'), { fragment: true })
    expect(selectAll('tr#Cancel kbd', prompt).map(contents)).toEqual(['q', 'Escape'])
    expect(selectAll('tr#Cancel code.Li', prompt).map((node) => squash(contents(node)))).toEqual(['Cancel command prompt'])
  })

  it.each(['3.2a', '3.7c'])('gives a command page the same caps as that command in the full %s manual', (version) => {
    const full = rendered(version)
    const descriptions = new Map<string, Element>()
    for (const list of selectAll('dl', full)) {
      const children = elements(list)
      children.forEach((child, index) => {
        const name = child.tagName === 'dt' ? select('code.Ic', child) : undefined
        if (name && children[index + 1]?.tagName === 'dd') descriptions.set(contents(name).trim(), children[index + 1])
      })
    }
    for (const name of ['bind-key', 'send-keys', 'unbind-key', 'list-keys', 'choose-tree', 'command-prompt', 'display-menu']) {
      const page = fromHtml(markTmuxManualKeys(commandHtml(version, name), name), { fragment: true })
      expect(selectAll('kbd', page).map(contents).map(squash), name).toEqual(selectAll('kbd', descriptions.get(name)!).map(contents).map(squash))
    }
  })

  it('keeps the entry anchors of the default bindings', () => {
    const tree = fromHtml(linkTmuxManualEntries(markTmuxManualKeys(tmuxManualHtml(tmuxManual('latest').manual, 'latest'))), { fragment: true })
    for (const [id, key] of [['default-key-binding-l', 'l'], ['default-key-binding-shift-l', 'L'], ['default-key-binding-left-bracket', '[']]) {
      expect(selectAll('kbd', select(`#${id}`, tree)!).map(contents)).toEqual([key])
      expect(select(`#${id} > a[href="#${id}"] > kbd`, tree)).toBeDefined()
    }
  })

  it('exports keys as readable inline code', () => {
    const html = markTmuxManualKeys(commandHtml('3.7c', 'bind-key'), 'bind-key')
    const markdown = toMarkdown(toMdast(fromHtml(html, { fragment: true }) as never), { extensions: [gfmToMarkdown()] })
    expect(markdown).toContain('`C-b c` creates a new window')
    expect(markdown).toContain('`c`')
    expect(markdown).not.toContain('<kbd')
  })
})
