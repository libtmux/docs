import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import { experimental_AstroContainer } from 'astro/container'
import { SymbolIndex } from '@libtmux/api-model'
import { fromHtml } from 'hast-util-from-html'
import { selectAll } from 'astro-expressive-code/hast'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_MODELS } from '../src/lib/api-models'
import { linkProseMarkdown } from '../src/lib/prose-markdown'
import { rehypeApiLinks } from '../src/plugins/rehype-api-links'
import {
  CATALOG_WRAPPER_TYPES, tmuxCatalogEntries, tmuxCatalogEntry, tmuxCatalogHref, tmuxCatalogKindsFor, tmuxCatalogKindsForSymbol,
  tmuxCatalogUrl,
} from '../src/lib/tmux-catalog'
import { linkTmuxManualCatalog } from '../src/lib/tmux-catalog-html'
import { resolveCatalogName, tmuxCatalogMentions, tmuxCatalogProseMentions } from '../src/lib/tmux-catalog-links'
import { catalogNamesIn, tmuxCatalogUses } from '../src/lib/tmux-catalog-usage'
import { linkTmuxDoc, tmuxEntityHref, tmuxMentions } from '../src/lib/tmux-links'
import { symbolMarkdown } from '../src/lib/symbol-markdown'
import { tmuxManual, tmuxManualUrl } from '../src/lib/tmux-manual-data'

const windows: Window[] = []
afterEach(async () => {
  for (const win of windows.splice(0)) await win.happyDOM.abort()
  vi.unstubAllGlobals()
})

describe('which names link', () => {
  const link = (text: string, context: { code?: boolean; version?: string; before?: string; after?: string } = {}) =>
    tmuxCatalogMentions(text, context).map((mention) => `${mention.kind}:${mention.name}`)

  it.each([
    ['destroy-unattached', 'option:destroy-unattached'],
    ['"session-created"', 'hook:session-created'],
    ["'after-new-session'", 'hook:after-new-session'],
    ['session_attached', 'format:session_attached'],
    ['#{session_attached}', 'format:session_attached'],
    ['pane-colors', 'option:pane-colours'],
    ['after-new-window[0]', 'hook:after-new-window'],
    ['command-alias[100]', 'option:command-alias'],
  ])('links the code literal %s', (literal, expected) => {
    expect(link(literal, { code: true })).toEqual([expected])
  })

  it('links the argument of an option or hook command, and names inside format expressions', () => {
    expect(link('set -g status-left "#{session_name} #{?pane_in_mode,copy,}"', { code: true }))
      .toEqual(['option:status-left', 'format:session_name', 'format:pane_in_mode'])
    expect(link('tmux show-options -gv mouse', { code: true })).toEqual(['option:mouse'])
    expect(link('tmux set-hook -g session-created "run-shell true"', { code: true })).toEqual(['hook:session-created'])
    expect(link('set -s command-alias[100] zoom="resize-pane -Z"', { code: true })).toEqual(['option:command-alias'])
    expect(link('#{E:status-left}#{t:window_activity}', { code: true })).toEqual(['option:status-left', 'format:window_activity'])
  })

  it('leaves running text alone, since only a code literal is a deliberate reference', () => {
    expect(link('The destroy-unattached option and the session-created hook.')).toEqual([])
    expect(link('Counts toward session_attached.')).toEqual([])
    expect(tmuxCatalogProseMentions('The destroy-unattached option and the session-created hook.').map((mention) => `${mention.kind}:${mention.name}`))
      .toEqual(['option:destroy-unattached', 'hook:session-created'])
  })

  it('links an option or hook that is a separate word of a longer code run', () => {
    expect(link('pane-died, pane-exited', { code: true })).toEqual(['hook:pane-died', 'hook:pane-exited'])
    expect(link('window-size manual', { code: true })).toEqual(['option:window-size'])
  })

  it.each([
    ['unknown multi-word names', 'not-a-tmux-option', { code: true }],
    ['an unknown underscore name', 'my_variable', { code: true }],
    ['a single word with no context', 'status', { code: true }],
    ['a single word in prose', 'the status mouse host version', {}],
    ['a word that is a variable but not an option', 'host', { code: true, before: 'the ', after: ' option' }],
    ['a hook named as a variable', 'session-created', { code: true, before: 'the ', after: ' variable' }],
    ['a flag spelled like an option', '--status-left', { code: true }],
    ['a control mode notification', '%session-renamed', { code: true }],
    ['a literal after a comparison', '#{==:window_name,session_name}', { code: true }],
    ['a path', 'status-left/foo.conf', { code: true }],
    ['a user option', '@status-left', { code: true }],
    ['a name in another word', 'xsession-created', { code: true }],
  ])('does not link %s', (_label, text, context) => {
    expect(link(text, context)).toEqual([])
  })

  it('reads a neighbouring word only to choose the kind', () => {
    expect(link('status', { code: true, before: 'the ', after: ' option' })).toEqual(['option:status'])
    expect(link('host', { code: true, before: 'the ', after: ' variable' })).toEqual(['format:host'])
    expect(link('host', { code: true, before: 'format variable ' })).toEqual(['format:host'])
    expect(link('mouse', { code: true, before: 'the ', after: ' hook' })).toEqual([])
    expect(link('session-created', { code: true, before: 'the ', after: ' option' })).toEqual(['hook:session-created'])
  })

  it('never guesses between kinds or for a command name', () => {
    const entry = (kind: 'option' | 'hook', name: string) => ({ kind, name }) as never
    const lookup = {
      entries: new Map([['switch-both', [entry('option', 'switch-both'), entry('hook', 'switch-both')]], ['split-pane', [entry('option', 'split-pane')]], ['plain-name', [entry('option', 'plain-name')]]]),
      commands: new Set(['split-pane']),
    }
    expect(resolveCatalogName('plain-name', lookup, {})).toMatchObject({ name: 'plain-name' })
    expect(resolveCatalogName('switch-both', lookup, {})).toBeUndefined()
    expect(resolveCatalogName('switch-both', lookup, { after: ' hook' })).toMatchObject({ kind: 'hook' })
    expect(resolveCatalogName('split-pane', lookup, {})).toBeUndefined()
    expect(resolveCatalogName('split-pane', lookup, { before: 'the option ' })).toMatchObject({ kind: 'option' })
  })

  it('resolves only names the selected release has', () => {
    expect(tmuxCatalogHref('option', 'prefix-timeout', '3.2a')).toBeUndefined()
    expect(link('prefix-timeout', { code: true, version: '3.2a' })).toEqual([])
    expect(link('prefix-timeout', { code: true, version: '3.7c' })).toEqual(['option:prefix-timeout'])
    expect(tmuxCatalogHref('option', 'prefix-timeout', '3.7c')).toBe(tmuxCatalogUrl('3.7c', 'option', 'prefix-timeout'))
  })

  it('answers through one function for every kind of tmux name', () => {
    expect(tmuxEntityHref('command', 'set-hook')).toBe(tmuxManualUrl('latest', 'set-hook'))
    expect(tmuxEntityHref('option', 'status-left', '3.2a')).toBe('/tmux/3.2a/catalog/options/status-left/')
    expect(tmuxEntityHref('command', 'status-left')).toBeUndefined()
    expect(tmuxEntityHref('hook', 'session-created')).toBe('/tmux/latest/catalog/hooks/session-created/')
    expect(tmuxEntityHref('format', 'session_name')).toBe('/tmux/latest/catalog/formats/session_name/')
    expect(tmuxEntityHref('hook', 'not-a-hook')).toBeUndefined()
    expect(tmuxEntityHref('command', 'not-a-command')).toBeUndefined()
  })

  it('keeps a command line as a command and an option name together', () => {
    const mentions = tmuxMentions('set-option -g status-left x', { code: true })
    expect(mentions.map((mention) => [mention.kind, mention.name])).toEqual([['command', 'set-option'], ['option', 'status-left']])
  })
})

/* ------------------------------------------------------------ every surface */

const catalogLink = (kind: 'options' | 'hooks' | 'formats', name: string) => `/tmux/latest/catalog/${kind}/${name}/`

const astroRequire = createRequire(realpathSync(new URL('../node_modules/astro/package.json', import.meta.url)))
async function docComponent() {
  const { transform } = await import(astroRequire.resolve('@astrojs/compiler-rs'))
  const file = new URL('../src/components/api/ApiDoc.astro', import.meta.url)
  const result = await transform(readFileSync(file, 'utf8'), { filename: file.pathname, internalURL: 'astro/compiler-runtime',
    resultScopedSlot: true, resolvePath: (specifier: string) => specifier })
  const linker = 'data:text/javascript,export const linkTmuxDoc = globalThis.__catalogDocLinker'
  const code = result.code.replaceAll('"astro/compiler-runtime"', JSON.stringify(pathToFileURL(astroRequire.resolve('astro/compiler-runtime')).href))
    .replaceAll('"../../lib/tmux-links"', JSON.stringify(linker))
    .replaceAll('"../../lib/mention-badge"', JSON.stringify(new URL('../src/lib/mention-badge.ts', import.meta.url).href))
  return (await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default
}

describe('API docstrings', () => {
  it('link the options, hooks and formats a docstring names, in every kind of span', async () => {
    const model = API_MODELS.rs
    const context = model.symbols.find((symbol) => symbol.apiScope !== 'internal' && symbol.kind === 'method')!
    const index = new SymbolIndex(model.symbols, (symbol) => `/en/rs/latest/reference/${symbol.slug}/`, 'rs')
    const text = 'Counts toward `session_attached`, such as `destroy-unattached`, and fires `"session-created"`. Keep `not-a-tmux-name` and the `status` word.'
    vi.stubGlobal('__catalogDocLinker', linkTmuxDoc)
    const win = new Window()
    windows.push(win)
    win.document.body.innerHTML = await (await experimental_AstroContainer.create()).renderToString(await docComponent(), { props: { text, index, context } })
    const hrefs = [...win.document.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href'))
    expect(hrefs).toContain(catalogLink('formats', 'session_attached'))
    expect(hrefs).toContain(catalogLink('options', 'destroy-unattached'))
    expect(hrefs).toContain(catalogLink('hooks', 'session-created'))
    const plain = [...win.document.querySelectorAll('code')].filter((code) => !code.closest('a')).map((code) => code.textContent)
    expect(plain).toEqual(['not-a-tmux-name', 'status'])
  })

  it('leaves a name the language API resolves to the API', () => {
    const model = API_MODELS.py
    const context = model.symbols.find((entry) => entry.id === 'libtmux.pane.Pane.pane_id')!
    expect(model.symbols.some((entry) => entry.id === 'libtmux.pane.Pane.session_attached')).toBe(true)
    const index = new SymbolIndex(model.symbols, (entry) => `/en/py/latest/reference/${entry.slug}/`, 'py')
    const resolved = linkTmuxDoc(index.linkText(':attr:`session_attached`', context))
    expect(JSON.stringify(resolved)).toContain('/reference/')
    expect(JSON.stringify(resolved)).not.toContain('/catalog/')
    const literal = linkTmuxDoc(index.linkText('``session_attached``', context))
    expect(JSON.stringify(literal)).toContain(catalogLink('formats', 'session_attached'))
  })
})

describe('guides and topics', () => {
  const source = 'The `destroy-unattached` option, the `session-created` hook and `#{session_attached}`.\n\nSet it with `set -g status-left "#{session_name}"`; `status` and `not-a-tmux-name` stay plain.\n\n```console\n$ tmux set -g destroy-unattached on\n```\n'

  it('links names in the rendered page for every port and in the Markdown export', async () => {
    const renderer = await createMarkdownProcessor({ rehypePlugins: [rehypeApiLinks], syntaxHighlight: false })
    for (const port of ['go', 'py', 'rs']) {
      const html = (await renderer.render(source, { frontmatter: { port } })).code
      for (const [kind, name] of [['options', 'destroy-unattached'], ['hooks', 'session-created'], ['formats', 'session_attached'], ['options', 'status-left'], ['formats', 'session_name']]) {
        expect(html, `${port} ${name}`).toContain(`href="${catalogLink(kind as 'options', name)}"`)
      }
      expect(html).not.toMatch(/<a[^>]*><code>(?:status|not-a-tmux-name)<\/code><\/a>/)
      expect(html).not.toMatch(/<pre[^>]*>[\s\S]*<a /)
    }
    const markdown = linkProseMarkdown(source, 'go')
    for (const [kind, name] of [['options', 'destroy-unattached'], ['hooks', 'session-created'], ['formats', 'session_attached'], ['options', 'status-left'], ['formats', 'session_name']]) {
      expect(markdown).toContain(`(${catalogLink(kind as 'options', name)})`)
    }
    expect(markdown).toContain('$ tmux set -g destroy-unattached on')
    expect(markdown).not.toMatch(/\[`?(?:status|not-a-tmux-name)`?\]\(/)
  })

  it('reads the neighbouring word of a single-word name in the page and its export', async () => {
    const text = 'Turn the `mouse` option on, then read the `host` variable. Plain `mouse` stays plain.'
    const html = (await (await createMarkdownProcessor({ rehypePlugins: [rehypeApiLinks], syntaxHighlight: false })).render(text, { frontmatter: { port: 'go' } })).code
    expect(html).toContain(`href="${catalogLink('options', 'mouse')}"`)
    expect(html).toContain(`href="${catalogLink('formats', 'host')}"`)
    expect(html.match(/catalog\/options\/mouse/g)).toHaveLength(1)
    const markdown = linkProseMarkdown(text, 'go')
    expect(markdown).toContain(`[\`mouse\`](${catalogLink('options', 'mouse')})`)
    expect(markdown.match(/catalog\/options\/mouse/g)).toHaveLength(1)
  })
})

describe('the CLI Manual', () => {
  it('links the names its own text mentions, and the entries it defines', () => {
    const html = linkTmuxManualCatalog(tmuxManual('3.7c').manual, '3.7c', undefined, { definitions: true })
    const tree = fromHtml(html, { fragment: true })
    const hrefs = new Set(selectAll('a', tree).map((anchor) => String(anchor.properties.href)))
    expect(hrefs).toContain('/tmux/3.7c/catalog/options/default-size/')
    expect(hrefs).toContain('/tmux/3.7c/catalog/hooks/command-error/')
    expect(hrefs).toContain('/tmux/3.7c/catalog/formats/session_name/')
    const definitions = selectAll('a.manual-catalog-link', tree).map((anchor) => String(anchor.properties.href))
    for (const entry of tmuxCatalogEntries('3.7c').filter((candidate) => candidate.descriptionSource === 'manual')) {
      expect(definitions, `${entry.kind} ${entry.name}`).toContain(tmuxCatalogUrl('3.7c', entry.kind, entry.name))
    }
    expect(selectAll('pre a, .Bd a', tree).filter((anchor) => String(anchor.properties.href).includes('/catalog/'))).toEqual([])
    expect(selectAll('a a', tree)).toEqual([])
  })

  it('leaves unknown literals and the page being described alone', () => {
    const html = '<p>See <code class="Ic">default-size</code>, <code class="Ic">not-a-tmux-option</code> and <code class="Li">session-created</code>.</p>'
    const linked = linkTmuxManualCatalog(html, '3.7c', { kind: 'option', name: 'default-size' })
    expect(linked).not.toContain('options/default-size')
    expect(linked).toContain('/tmux/3.7c/catalog/hooks/session-created/')
    expect(linked).not.toContain('not-a-tmux-option</a>')
    expect(linkTmuxManualCatalog(html, '3.2a', { kind: 'option', name: 'default-size' })).toContain('/tmux/3.2a/catalog/hooks/session-created/')
  })
})

describe('Markdown exports of API members', () => {
  it('link catalog names beside language links', () => {
    const model = API_MODELS.rs
    const symbol = model.symbols.find((entry) => entry.id === 'options.generated.AFTER_BIND_KEY')!
    expect(symbol.doc?.summary).toContain('`after-bind-key`')
    const index = new SymbolIndex(model.symbols, (entry) => `/en/rs/latest/reference/${entry.slug}/`, 'rs')
    const text = symbolMarkdown({ model, symbol, index, hrefFor: (entry) => `/en/rs/latest/reference/${entry.slug}/` })
    expect(text).toContain(`(${catalogLink('hooks', 'after-bind-key')})`)
  })
})

describe('what the catalog lists as used', () => {
  it('finds library members whose documentation names an entry, and members that wrap a family', () => {
    const uses = tmuxCatalogUses(tmuxCatalogEntry('3.7c', 'option', 'destroy-unattached')!)
    expect(uses.map((use) => use.port)).toEqual(expect.arrayContaining(['go', 'rs']))
    expect(uses.every((use) => use.symbols.every((symbol) => symbol.href.includes('/reference/')))).toBe(true)
    expect([...catalogNamesIn('Counts `session_attached` for the session-created hook; not-a-tmux-name.')].toSorted())
      .toEqual(['format/session_attached', 'hook/session-created'])
    expect(tmuxCatalogKindsFor('py', 'libtmux.Session.set_hook')).toEqual(['hook'])
    expect(tmuxCatalogKindsFor('py', 'libtmux.Session.show_hooks')).toEqual(['hook'])
    expect(tmuxCatalogKindsFor('py', 'libtmux.Session.set_option')).toEqual(['option'])
    expect(tmuxCatalogKindsFor('py', 'libtmux.Session.attach')).toEqual([])
  })
})

describe('library members that wrap options and hooks', () => {
  const find = (port: string, id: string) => API_MODELS[port].symbols.find((symbol) => (symbol.publicId ?? symbol.id) === id)

  it('names only types the API model still has', () => {
    const missing = Object.entries(CATALOG_WRAPPER_TYPES).flatMap(([port, kinds]) =>
      Object.values(kinds).flat().filter((id) => !find(port, id)).map((id) => `${port}:${id}`))
    expect(missing).toEqual([])
  })

  it('links the type and its members to the matching section, and nothing else', () => {
    const kinds = (port: string, id: string) => tmuxCatalogKindsForSymbol(port, find(port, id)!)
    expect(kinds('py', 'libtmux._internal.constants.Hooks')).toEqual(['hook'])
    expect(kinds('py', 'libtmux._internal.constants.Hooks.after_set_hook')).toEqual(['hook'])
    expect(kinds('py', 'libtmux._internal.constants.SessionOptions.base_index')).toEqual(['option'])
    expect(kinds('go', 'tmux.SessionHookValues')).toEqual(['hook'])
    expect(kinds('csharp', 'LibTmux.TmuxOptions')).toEqual(['option'])
    expect(kinds('py', 'libtmux.Session.show_hooks')).toEqual(['hook'])
    expect(kinds('py', 'libtmux.Session.attach')).toEqual([])
    expect(kinds('go', 'tmux.Session')).toEqual([])
  })
})
