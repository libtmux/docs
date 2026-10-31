import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { experimental_AstroContainer } from 'astro/container'
import { SymbolIndex } from '@libtmux/api-model'
import { Window, type Element as DomElement } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_MODELS, indexFor } from '../src/lib/api-models'
import { tmuxCommandMentions, linkTmuxDoc, tmuxMentionMarkdown } from '../src/lib/tmux-links'
import { tmuxManual } from '../src/lib/tmux-manual-data'
import { fromMarkdown } from 'mdast-util-from-markdown'

const windows: Window[] = []
afterEach(async () => {
  for (const win of windows.splice(0)) await win.happyDOM.abort()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
})

const astroRequire = createRequire(realpathSync(new URL('../node_modules/astro/package.json', import.meta.url)))
let componentPromise: ReturnType<typeof docComponent> | undefined

async function docComponent() {
  const { transform } = await import(astroRequire.resolve('@astrojs/compiler-rs'))
  const file = new URL('../src/components/api/ApiDoc.astro', import.meta.url)
  const result = await transform(readFileSync(file, 'utf8'), { filename: file.pathname, internalURL: 'astro/compiler-runtime',
    resultScopedSlot: true, resolvePath: (specifier: string) => specifier })
  expect(result.diagnostics.filter((item: { severity: string }) => item.severity === 'error')).toEqual([])
  // The compiled component uses the real Vite-loaded linker without a data-URL relative import.
  const linker = 'data:text/javascript,export const linkTmuxDoc = globalThis.__tmuxDocLinker'
  const code = result.code.replaceAll('"astro/compiler-runtime"', JSON.stringify(pathToFileURL(astroRequire.resolve('astro/compiler-runtime')).href))
    .replaceAll('"../../lib/tmux-links"', JSON.stringify(linker))
    .replaceAll('"../../lib/mention-badge"', JSON.stringify(new URL('../src/lib/mention-badge.ts', import.meta.url).href))
    .replaceAll('"../../lib/symbol-form"', JSON.stringify(new URL('../src/lib/symbol-form.ts', import.meta.url).href))
  return (await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default
}

async function renderedJuliaSummary(id: string, overload?: number) {
  const model = API_MODELS.julia
  const symbol = model.symbols.find((entry) => entry.id === id)!
  expect(symbol, id).toBeDefined()
  const text = (overload === undefined ? symbol.doc : symbol.signatures[overload]?.doc)?.summary
  expect(text, id).toBeTypeOf('string')
  const index = new SymbolIndex(model.symbols, (entry) => `/en/julia/latest/reference/${entry.slug}/`, 'julia')
  const win = new Window()
  windows.push(win)
  vi.stubGlobal('__tmuxDocLinker', linkTmuxDoc)
  const container = await experimental_AstroContainer.create()
  win.document.body.innerHTML = await container.renderToString(await (componentPromise ??= docComponent()), {
    props: { text, index, context: symbol },
  })
  return { win, text }
}

/** The words a reader reads: prose draws no badge, so a mark in front of a name would show up here as a stray letter. */
const readText = (node: DomElement) => node.textContent

describe('contextual tmux command mentions', () => {
  it.each([
    ['LibTmux.Base.close', 3, 'kill-server', 'kill-server', []],
    ['LibTmux.format_hints', 0, 'display-message -a', 'display-message', ['libtmux-wirecriteriaerror-message']],
    ['LibTmux.kill_pane', 0, 'kill-pane', 'kill-pane', []],
    ['LibTmux.kill_session', 0, 'kill-session', 'kill-session', ['libtmux-session']],
    ['LibTmux.kill_window', 0, 'kill-window', 'kill-window', ['libtmux-window']],
    ['LibTmux.link_window', 0, 'link-window', 'link-window', ['libtmux-paneoccurrence-link', 'libtmux-window']],
    ['LibTmux.move_window', 0, 'move-window', 'move-window', ['libtmux-window']],
    ['LibTmux.snapshot', 1, 'list-clients', 'list-clients', ['libtmux-clients']],
    ['LibTmux.capture_bytes', 0, 'save-buffer', 'save-buffer', ['libtmux-controlbuffercleanuperror-buffer']],
    ['LibTmux.capture_bytes', 1, 'capture-pane -N', 'capture-pane', []],
  ] as const)('renders %s overload %i command %s as one native destination', async (id, overload, label, command, partials) => {
    const { win } = await renderedJuliaSummary(id, overload)
    const code = [...win.document.querySelectorAll('code.api-literal')].find((element) => element.textContent === label)
    expect(code, label).toBeDefined()
    for (const partial of partials) {
      expect(code!.querySelector(`a[href="/en/julia/latest/reference/${partial}/"]`), `partial Julia reference in ${label}`).toBeNull()
    }
    expect(code!.querySelectorAll('a')).toHaveLength(0)
    const link = code!.closest('a')
    expect(link?.getAttribute('href')).toBe(`/tmux/latest/manual/${command}/`)
    expect(readText(link!)).toBe(label)
  })

  it('renders a native paste-buffer mention as linked prose without changing its text', async () => {
    const { win, text } = await renderedJuliaSummary('LibTmux.BufferID')
    const link = win.document.querySelector('a[href="/tmux/latest/manual/paste-buffer/"]')
    expect(readText(link!)).toBe('paste-buffer')
    expect(link?.querySelector('.api-link-kind')).toBeNull()
    // The kind is the link's colour, and stays in the tooltip, the data attribute and the accessible name.
    expect([link?.getAttribute('title'), link?.getAttribute('data-api-kind'), link?.getAttribute('aria-label')])
      .toEqual(['tmux command', 'command', 'tmux command: paste-buffer'])
    expect(link?.querySelector('code')).toBeNull()
    expect(readText(win.document.body)).toBe(text)
  })

  it('resolves canonical names and explicit invocation aliases from the selected native catalog', () => {
    const input = '$ tmux -L run-shell -f "file name" -S /tmp/example run -b true'
    expect(tmuxCommandMentions(input, { code: true })).toEqual([{
      start: input.indexOf('run -b'), end: input.indexOf('run -b') + 3, text: 'run',
      command: 'run-shell', href: '/tmux/latest/manual/run-shell/',
    }])
    expect(tmuxCommandMentions('tmux -CLexample -- has -t work', { code: true })[0]?.command).toBe('has-session')
    for (const version of ['3.2a', '3.7c']) {
      for (const command of tmuxManual(version).commands) {
        expect(tmuxCommandMentions(command.name, { code: true, version })[0]?.href)
          .toBe(`/tmux/${version}/manual/${command.name}/`)
        if (command.alias) expect(tmuxCommandMentions(`tmux ${command.alias}`, { code: true, version })[0]?.command).toBe(command.name)
      }
    }
    expect(tmuxCommandMentions('new-pane', { code: true, version: '3.2a' })).toEqual([])
    expect(tmuxCommandMentions('new-pane', { code: true, version: '3.7c' })[0]?.command).toBe('new-pane')
  })

  it('leaves ordinary aliases, filenames, flags, quoted strings and unknown invocations literal', () => {
    for (const input of ['tmux has many panes.', 'tmux run and wait.', 'run', 'has', 'libtmux.run-shell', '/tmp/run-shell', 'run-shell.md', '--run-shell', '"run-shell"', "'tmux run-shell'", '# run-shell', 'tmux -Q run-shell', 'tmux -c "run-shell"', 'tmux -V run-shell', 'tmux missing-command']) {
      const code = !input.startsWith('tmux has ') && !input.startsWith('tmux run and ')
      expect(tmuxCommandMentions(input, { code }), input).toEqual([])
    }
    expect(tmuxCommandMentions('Use resize-pane and display-message.').map((mention) => mention.command))
      .toEqual(['resize-pane', 'display-message'])
  })

  it('preserves actual native summaries, API references and selected text in every port', () => {
    const cases = [
      ['py', 'libtmux.Server.run_shell', 'run-shell'],
      ['py', 'libtmux.Server.set_buffer', 'set-buffer'],
      ['go', 'tmux.Pane.Resize', 'resize-pane'],
      ['rs', 'control.Event.Message', 'display-message'],
    ]
    for (const [port, id, command] of cases) {
      const model = API_MODELS[port]
      const symbol = model.symbols.find((entry) => (entry.publicId ?? entry.id) === id)!
      expect(symbol, id).toBeDefined()
      const index = indexFor(model, (entry) => `#${entry.id}`)
      const before = index.linkText(symbol.doc!.summary!, symbol)
      const after = linkTmuxDoc(before)
      expect(after.map((span) => 'text' in span ? span.text : span.label).join(''))
        .toBe(before.map((span) => 'text' in span ? span.text : span.label).join(''))
      expect(after.some((span) => span.kind === 'link' && span.href === `/tmux/latest/manual/${command}/`), id).toBe(true)
      for (const span of before.filter((entry) => entry.link)) expect(after).toContainEqual(span)
    }
    const authored = { kind: 'link' as const, text: 'run-shell', code: true, href: 'https://example.com/authored' }
    expect(linkTmuxDoc([authored])).toEqual([authored])
  })

  it('preserves Markdown code text while giving multiple commands independent destinations', () => {
    const input = 'tmux run-shell true && tmux display-message "hello"'
    const markdown = tmuxMentionMarkdown(input, true)!
    const children = (fromMarkdown(markdown).children[0] as { children: { type: string; value?: string; children?: { value: string }[] }[] }).children
    expect(children.map((node) => node.value ?? node.children?.map((child) => child.value).join('')).join('')).toBe(input)
    expect(markdown).toContain('/tmux/latest/manual/run-shell/')
    expect(markdown).toContain('/tmux/latest/manual/display-message/')
  })

  it('keeps native command destinations under the real preview root rather than a library version', async () => {
    vi.stubEnv('LIBTMUX_DOCS_PORT_ROOT', '/pr-123/en')
    const links = await import('../src/lib/tmux-links')
    expect(links.tmuxCommandMentions('run-shell', { code: true, version: '3.2a' })[0]?.href)
      .toBe('/pr-123/en/tmux/3.2a/manual/run-shell/')
  })
})
