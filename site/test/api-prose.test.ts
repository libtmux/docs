import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { API_MODELS } from '../src/lib/api-models'
import { symbolMarkdown } from '../src/lib/symbol-markdown'
import { SymbolIndex, tokenizeDoc } from '@libtmux/api-model/reference'
import { parseApiProse } from '@libtmux/api-model/reference'
import { groupDirectory } from '../src/lib/api-directory'
import { parseXmlDoc } from '../../packages/api-model/src/doc/csharp'
import { createRenderer } from 'astro-expressive-code'
import { select, toHtml } from 'astro-expressive-code/hast'
import config from '../ec.config.mjs'
import { codeLang } from '../src/lib/highlight'

describe('shared API prose blocks', () => {
  it('preserves fenced source instead of treating prompts, comments and bullets as prose', () => {
    expect(parseApiProse('Before.\n\n```python\n>>> values = [\n...     1,\n... ]\n[1]\n\n# literal\n- literal\n```\n\nAfter.')).toEqual([
      { kind: 'p', text: 'Before.' },
      { kind: 'code', lang: 'python', code: '>>> values = [\n...     1,\n... ]\n[1]\n\n# literal\n- literal' },
      { kind: 'p', text: 'After.' },
    ])
  })

  it('keeps existing nested lists and rubrics around a longer literal fence', () => {
    expect(parseApiProse('- Server\n\n  - Session\n\n    - Window\n\n# Details\n\n````text\n```\n````')).toEqual([
      { kind: 'ul', items: [{ text: 'Server', children: [{ text: 'Session', children: [{ text: 'Window', children: [] }] }] }] },
      { kind: 'rubric', text: 'Details' },
      { kind: 'code', lang: 'text', code: '```' },
    ])
  })

  it('uses text for unlabelled literal fences and retains unfinished code', () => {
    expect(parseApiProse('~~~\na\n  b')).toEqual([{ kind: 'code', lang: 'text', code: 'a\n  b' }])
  })

  it('keeps native numbered and bullet lists distinct from neighboring code', () => {
    expect(parseApiProse('3. Read a snapshot.\n4. Match the records.\n\n```go\nmatched := Matching(panes, filter)\n```\n\n• Inspect errors.')).toEqual([
      { kind: 'ol', start: 3, items: [{ text: 'Read a snapshot.', children: [] }, { text: 'Match the records.', children: [] }] },
      { kind: 'code', lang: 'go', code: 'matched := Matching(panes, filter)' },
      { kind: 'ul', items: [{ text: 'Inspect errors.', children: [] }] },
    ])
  })

  it('reads a wrapped C# list item as one item of one list', () => {
    const { doc } = parseXmlDoc('<summary>S.</summary><remarks>\nSteps:\n<list type="bullet">\n  <item><description>Open the server, and wait\n  for the first window.</description></item>\n  <item><description>Close it.</description></item>\n</list>\nDone.\n</remarks>')
    expect(parseApiProse(doc.body!)).toEqual([
      { kind: 'p', text: 'Steps:' },
      { kind: 'ul', items: [{ text: 'Open the server, and wait for the first window.', children: [] }, { text: 'Close it.', children: [] }] },
      { kind: 'p', text: 'Done.' },
    ])
  })

  it('reads a pipe table as a table block, not a paragraph of pipes', () => {
    const blocks = parseApiProse('Every handle:\n\n| To | Call |\n| --- | :--: |\n| read one | `typed_option` |\n| write `a|b` | [`set_option`] |\n\nAfter.')
    expect(blocks).toEqual([
      { kind: 'p', text: 'Every handle:' },
      { kind: 'table', head: ['To', 'Call'], align: [undefined, 'center'], rows: [['read one', '`typed_option`'], ['write `a|b`', '[`set_option`]']] },
      { kind: 'p', text: 'After.' },
    ])
  })

  it('reads alignment from the rule row, an escaped pipe as a pipe, and a ragged row as the header\'s width', () => {
    const [table] = parseApiProse('| a | b | c |\n|:--|--:|---|\n| one \\| two | x |\n| 1 | 2 | 3 | 4 |')
    expect(table).toEqual({
      kind: 'table', head: ['a', 'b', 'c'], align: ['left', 'right', undefined],
      rows: [['one | two', 'x', ''], ['1', '2', '3']],
    })
  })

  it('ends a table at a line without a leading pipe and opens one straight after a paragraph line', () => {
    expect(parseApiProse('Lead line\n| a |\n| - |\n| 1 |\ntrailing line').map((block) => block.kind)).toEqual(['p', 'table', 'p'])
  })

  it('leaves pipes in prose alone when no rule line follows', () => {
    expect(parseApiProse('| not a table |\nstill prose')).toEqual([{ kind: 'p', text: '| not a table | still prose' }])
    expect(parseApiProse('a | b\n| - |')).toEqual([{ kind: 'p', text: 'a | b | - |' }])
  })

  it('renders and exports the source-bound Go Matching example without changing Copy text', async () => {
    const model = API_MODELS.go
    const symbol = model.symbols.find((entry) => entry.id === 'tmuxq.Matching')!
    const expected = 'active, err := tmuxq.Matching(snapshot.Panes(), tmux.PaneActiveIs(true))'
    expect(symbol.source.revision).toBe('2de249b600d65218ee8b8fdc07c6b2b919242151')
    const blocks = parseApiProse(symbol.doc!.body!)
    expect(blocks).toEqual([{ kind: 'code', lang: 'go', code: expected }])
    const block = blocks[0]
    if (block.kind !== 'code') throw new Error('Missing native code block')
    const renderer = await createRenderer(config)
    const result = await renderer.ec.render({ code: block.code, language: codeLang(block.lang) })
    expect(select('pre', result.renderedGroupAst)?.properties.dataLanguage).toBe('go')
    expect(select('[data-code]', result.renderedGroupAst)?.properties.dataCode).toBe(expected)
    expect(new Set([...toHtml(result.renderedGroupAst).matchAll(/--0:([^;"]+)/g)].map((match) => match[1])).size).toBeGreaterThan(1)
    expect(fromMarkdown(symbolMarkdown({ model, symbol })).children.filter((node) => node.type === 'code'))
      .toContainEqual(expect.objectContaining({ lang: 'go', value: expected }))
  })
})


const row = (lead: string, refs: string) => `**${lead}.** What these are for.\n\n${refs}`
const three = [row('Connecting', '[`new`], [`builder`]'), row('Finding', '[`session`]'), row('Listing', '[`sessions`] and [`panes`]')].join('\n\n')

describe('a capability directory', () => {
  it('folds three bold-led paragraphs, each followed by references alone, into rows', () => {
    const blocks = groupDirectory(parseApiProse(`Intro.\n\n${three}\n\nAfter.`))
    expect(blocks.map((block) => block.kind)).toEqual(['p', 'directory', 'p'])
    const directory = blocks[1]
    if (directory.kind !== 'directory') throw new Error('no directory')
    expect(directory.rows.map((r) => [r.title, r.guidance, r.groups.map((g) => g.refs)])).toEqual([
      ['Connecting', 'What these are for.', [['[`new`]', '[`builder`]']]],
      ['Finding', 'What these are for.', [['[`session`]']]],
      ['Listing', 'What these are for.', [['[`sessions`]', '[`panes`]']]],
    ])
  })

  it('reads a labelled list as named groups', () => {
    const text = [row('A', '[`a`]'), row('B', '[`b`]'), '**C.** Guidance.\n\n- Buffers: [`buffer`], [`set_buffer`]\n- Keys: [`bind_key`]'].join('\n\n')
    const directory = groupDirectory(parseApiProse(text)).find((block) => block.kind === 'directory')
    if (directory?.kind !== 'directory') throw new Error('no directory')
    expect(directory.rows[2].groups).toEqual([
      { label: 'Buffers', refs: ['[`buffer`]', '[`set_buffer`]'] },
      { label: 'Keys', refs: ['[`bind_key`]'] },
    ])
  })

  it('leaves two rows as prose: a short run is not a directory', () => {
    const text = [row('A', '[`a`]'), row('B', '[`b`]')].join('\n\n')
    expect(groupDirectory(parseApiProse(text)).map((block) => block.kind)).toEqual(['p', 'p', 'p', 'p'])
  })

  it('leaves a bold-led paragraph whose follower holds prose as prose, and ends the run there', () => {
    const text = [row('A', '[`a`]'), row('B', '[`b`]'), row('C', 'Use [`c`] first.'), row('D', '[`d`]')].join('\n\n')
    expect(groupDirectory(parseApiProse(text)).map((block) => block.kind)).toEqual(['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'])
  })

  it('writes a bold list label as its words, without the marks', () => {
    const text = [row('A', '[`a`]'), row('B', '[`b`]'), '**C.** Guidance.\n\n- **Buffers**: [`buffer`]\n- *Keys*: [`bind_key`]'].join('\n\n')
    const directory = groupDirectory(parseApiProse(text)).find((block) => block.kind === 'directory')
    if (directory?.kind !== 'directory') throw new Error('no directory')
    expect(directory.rows[2].groups.map((group) => group.label)).toEqual(['Buffers', 'Keys'])
  })

  it('does not read a Markdown link or a reference-style link as a Go reference', () => {
    for (const refs of ['[text](https://example.test)', '[text][ref]']) {
      const text = [row('A', refs), row('B', refs), row('C', refs)].join('\n\n')
      expect(groupDirectory(parseApiProse(text)).some((block) => block.kind === 'directory'), refs).toBe(false)
    }
  })

  it('leaves a list item without a label, or with prose after it, as prose', () => {
    const base = [row('A', '[`a`]'), row('B', '[`b`]')].join('\n\n')
    for (const list of ['- [`c`], [`d`]', '- Keys: [`c`] binds a key']) {
      expect(groupDirectory(parseApiProse(`${base}\n\n**C.** Guidance.\n\n${list}`)).some((block) => block.kind === 'directory'), list).toBe(false)
    }
  })
})

describe('a capability directory in each port\'s syntax', () => {
  const rows = (refs: string[]) => refs.map((ref, n) => `**Group ${n}.** What these are for.\n\n${ref}, ${ref}`).join('\n\n')
  it.each([
    ['rustdoc', '[`new`]'],
    ['XML doc', '<see cref="Server.Open" />'],
    ['Javadoc and TSDoc', '{@link #sessions()}'],
    ['Go doc', '[Server.Kill]'],
  ])('reads %s references', (_, ref) => {
    const directory = groupDirectory(parseApiProse(rows([ref, ref, ref]))).find((block) => block.kind === 'directory')
    if (directory?.kind !== 'directory') throw new Error('no directory')
    expect(directory.rows[0].groups[0].refs).toEqual([ref, ref])
  })

  it.each([
    ['ts', '{@link Server.kill}'], ['java', '{@link #open}'], ['csharp', '<see cref="Server.Open" />'], ['rs', '[`new`]'], ['go', '[Server.Kill]'],
    ['kotlin', '[open]'], ['kotlin', '{@link #open}'], ['scala', '{@link #open}'], [undefined, '[Server.Kill]'],
  ])('reads the shared spellings for %s as before', (lang, ref) => {
    const directory = groupDirectory(parseApiProse(rows([ref, ref, ref])), lang).find((block) => block.kind === 'directory')
    if (directory?.kind !== 'directory') throw new Error('no directory')
    expect(directory.rows.map((row) => row.groups[0].refs)).toEqual(Array(3).fill([ref, ref]))
  })

  it('reads Go\'s heading-led rows: a heading, its guidance, then the names', () => {
    const row = (title: string) => `# ${title}\n\nWhat these are for.\n\n[Server.Kill], [NewServer]`
    const blocks = groupDirectory(parseApiProse(['# What is on here', 'Intro.', row('Connecting'), row('Finding'), row('Listing')].join('\n\n')))
    expect(blocks.map((block) => block.kind)).toEqual(['rubric', 'p', 'directory'])
  })

  it('leaves a Go heading whose next paragraph is already the names as a heading', () => {
    const row = (title: string) => `# ${title}\n\n[Server.Kill], [NewServer]`
    expect(groupDirectory(parseApiProse([row('A'), row('B'), row('C')].join('\n\n'))).some((block) => block.kind === 'directory')).toBe(false)
  })
})

/**
 * Each port's reference as its extractor hands it to the shell, which is not always how the source file writes it.
 * Doxygen drops the tag of `\ref` and `@ref` and keeps a bare word, so C++ names a member in a code span; the
 * LuaLS export is Markdown, so Lua does too; PowerShell's help names a cmdlet as a bare word.
 */
const SYNTAXES: { port: string; syntax: string; refs: [string, string, string]; label: string }[] = [
  { port: 'py', syntax: 'Sphinx roles', label: 'Buffers', refs: [':py:meth:`~libtmux.Server.kill`', ':class:`Session`', ':attr:`.sessions`'] },
  { port: 'swift', syntax: 'DocC symbol links', label: 'Buffers', refs: ['``Server/kill(_:)-(Session)``', '``Server/isRunning()``', '``TmuxError/serverRestarted``'] },
  { port: 'elixir', syntax: 'ExDoc function references', label: 'Buffers', refs: ['`new/1`', '`LibTmux.Control.with_connection/2`', '`t:t/0`'] },
  { port: 'elixir', syntax: 'ExDoc callbacks, predicates and bang functions', label: 'Buffers', refs: ['`c:init/1`', '`alive?/1`', '`snapshot!/2`'] },
  { port: 'elixir', syntax: 'ExDoc module references', label: 'Buffers', refs: ['`LibTmux.Snapshot`', '`Enum`', '`LibTmux.Control.Request`'] },
  { port: 'elixir', syntax: 'ExDoc links with a code destination', label: 'Buffers', refs: ['[the server](`LibTmux.Server`)', '[a snapshot](`snapshot/2`)', '[one](`LibTmux.Selection.one/2`)'] },
  { port: 'kotlin', syntax: 'KDoc label and target', label: 'Buffers', refs: ['[expand][Server.expand]', '[run][Server.run]', '[batch][Server.batch]'] },
  { port: 'scala', syntax: 'Scaladoc links', label: 'Buffers', refs: ['[[Server.open]]', '[[Session#windows]]', '[[io.github.libtmux.ServerConfig ServerConfig]]'] },
  { port: 'cxx', syntax: 'code spans', label: 'Buffers', refs: ['`at_socket_path()`', '`Session::windows()`', '`FailureKind::unsupported`'] },
  { port: 'cxx', syntax: 'code spans for destructors', label: 'Buffers', refs: ['`Server::~Server`', '`Session::~Session()`', '`Pane::~Pane`'] },
  { port: 'lua', syntax: 'code spans', label: 'Buffers', refs: ['`Server:close`', '`libtmux.Runtime:connect`', '`libtmux.Snapshot.races`'] },
  { port: 'ruby', syntax: 'YARD links', label: 'Buffers', refs: ['{#list_sessions}', '{Selection#where}', '{#initialize Server.new}'] },
  { port: 'ruby', syntax: 'YARD predicate, bang and absolute links', label: 'Buffers', refs: ['{Selection#exists?}', '{::LibTmux::Server}', '{#close!}'] },
  { port: 'julia', syntax: 'Documenter @ref targets', label: 'Buffers', refs: ['[`new_session`](@ref LibTmux.new_session)', '[`snapshot`](@ref "Snapshots")', '[Server](@ref)'] },
  { port: 'powershell', syntax: 'cmdlet names', label: 'Buffers', refs: ['Get-TmuxSession', 'LibTmux\\Get-TmuxWindow', 'Wait-TmuxPaneText'] },
  { port: 'powershell', syntax: 'code spans', label: 'Buffers', refs: ['`ConvertTo-TmuxQueryJson`', '`Get-TmuxPane`', '`LibTmux.Server`'] },
  { port: 'haskell', syntax: 'reST object roles', label: 'Buffers', refs: [':obj:`Server <LibTmux.Server#t:Server>`', ':obj:`withServer <LibTmux.Server#v:withServer>`', ':obj:`capture <LibTmux.Server#v:capture>`'] },
  { port: 'raku', syntax: 'code spans of method names', label: 'Buffers', refs: ['`start`', '`has-session(:name)`', '`LibTmux::Server.run-batch`'] },
  { port: 'raku', syntax: 'padded code spans, as the exporter writes C<>', label: 'Buffers', refs: ['` start `', '` from-env `', '` has-session(:id) `'] },
  { port: 'raku', syntax: 'code spans of type names', label: 'Buffers', refs: ['`Server`', '`LibTmux::Model::Snapshot`', '`LibTmux::Server.open-control-async`'] },
  { port: 'perl', syntax: 'reST object roles', label: 'Buffers', refs: [':obj:`"snapshot" <LibTmux::Server::snapshot>`', ':obj:`to_record <LibTmux::Entity::to_record>`', ':obj:`LibTmux::Selection <LibTmux::Selection>`'] },
  { port: 'clojure', syntax: 'cljdoc wiki links', label: 'Buffers', refs: ['[[open!]]', '[[libtmux.data/windows]]', '[[libtmux.control/attach! attach]]'] },
  { port: 'erlang', syntax: 'EEP-48 function and type references', label: 'Buffers', refs: ['`open/1`', '`tmux_snapshot:sessions/1`', '`t:open_options/0`'] },
  { port: 'erlang', syntax: 'EEP-48 module and remote type references', label: 'Buffers', refs: ['`m:tmux_buffer`', '`t:tmux_snapshot:t/0`', '`c:init/1`'] },
  { port: 'ocaml', syntax: 'odoc references', label: 'Buffers', refs: ['{!Client.connect}', '{!Libtmux.Snapshot}', '{!Libtmux.Options.type-scope}'] },
  { port: 'lisp', syntax: 'package-qualified code spans', label: 'Buffers', refs: ['`libtmux:fetch-snapshot`', '`libtmux.control:open-connection`', '`libtmux.query:one-or-none`'] },
]

describe.each(SYNTAXES)('a capability directory in $port\'s $syntax', ({ port, refs, label }) => {
  const paragraph = `${refs[0]}, ${refs[1]} and ${refs[2]}`
  const run = (follower: string, count = 3) => Array.from({ length: count }, (_, n) => `**Group ${n}.** What these are for.\n\n${follower}`).join('\n\n')
  const directoryOf = (text: string, lang: string | undefined) => groupDirectory(parseApiProse(text), lang).find((block) => block.kind === 'directory')

  it('folds guidance and a paragraph of references into rows', () => {
    const blocks = groupDirectory(parseApiProse(['# What is on here', 'A server does many things.', run(paragraph), 'After.'].join('\n\n')), port)
    expect(blocks.map((block) => block.kind)).toEqual(['rubric', 'p', 'directory', 'p'])
    const directory = blocks[2]
    if (directory.kind !== 'directory') throw new Error('no directory')
    expect(directory.rows.map((row) => [row.title, row.guidance, row.groups])).toEqual(
      [0, 1, 2].map((n) => [`Group ${n}`, 'What these are for.', [{ refs }]]),
    )
  })

  it('reads a labelled list as named groups', () => {
    const directory = directoryOf(run(`- ${label}: ${paragraph}\n- Keys: ${refs[0]}`), port)
    if (directory?.kind !== 'directory') throw new Error('no directory')
    expect(directory.rows[0].groups).toEqual([{ label, refs }, { label: 'Keys', refs: [refs[0]] }])
  })

  it('leaves guidance that holds references among its words as prose', () => {
    expect(directoryOf(run(`Use ${paragraph} to connect.`), port)).toBeUndefined()
    expect(directoryOf(run(`- ${label}: ${refs[0]} binds a key`), port)).toBeUndefined()
  })

  it('leaves fewer than three rows as prose', () => {
    const blocks = groupDirectory(parseApiProse(run(paragraph, 2)), port)
    expect(blocks.map((block) => block.kind)).toEqual(Array(4).fill('p'))
  })

  it('is one reference to the tokenizer, so a chip links like prose does', () => {
    for (const ref of refs) expect(tokenizeDoc(ref, port).map((span) => span.kind), ref).toEqual(['ref'])
  })

  it('is not read for a port that writes it as something else', () => {
    for (const lang of ['ts', 'rs', 'go', 'java', undefined]) expect(directoryOf(run(paragraph), lang), `${lang}`).toBeUndefined()
  })
})

describe('a capability directory keeps each port\'s spelling to itself', () => {
  const run = (follower: string) => Array.from({ length: 3 }, (_, n) => `**Group ${n}.** What these are for.\n\n${follower}`).join('\n\n')
  it.each([
    ['rs', 'a code span', '`new()`, `builder()`'],
    ['swift', 'a code span', '`Server/kill(_:)`'],
    ['swift', 'a Javadoc link', '{@link Server.kill}'],
    ['py', 'DocC', '``Server/kill(_:)``'],
    ['py', 'an XML doc reference', '<see cref="Server.Open" />'],
    ['py', 'a role that Sphinx prefixes but the tokenizer leaves as text', ':py:obj:`x`'],
    ['py', 'a glossary role', ':term:`x`'],
    ['kotlin', 'a Sphinx role', ':meth:`Server.kill`'],
    ['kotlin', 'a rustdoc link', '[`open`]'],
    ['cxx', 'a Markdown link', '[text](https://example.test)'],
    ['cxx', 'a Go doc link', '[Server.Kill]'],
    ['cxx', 'options and ids', '`-S`, `%0` and `"x y"`'],
    ['elixir', 'a reference-style link', '[text][ref]'],
    ['julia', 'a code span', '`new_session`'],
    ['julia', 'a rustdoc link', '[`new_session`]'],
    ['scala', 'a Go doc link', '[Server.Kill]'],
    ['ruby', 'a hash literal', '{:a => 1}, {Foo => 1}'],
    ['ruby', 'string interpolation', '#{Foo} and #{Bar}'],
    ['ruby', 'a Javadoc link', '{@link #open}'],
    ['ruby', 'a label that holds a code span', '{Server see `x`}'],
    ['powershell', 'a variable', '$Server, $Session and $Pane'],
    ['powershell', 'a Go doc link', '[Server]'],
    ['lua', 'options and ids', '`-S`, `%0` and `"x y"`'],
    ['lua', 'a rustdoc link', '[`Server`]'],
    ['erlang', 'an atom', '`inconsistent_capture`'],
    ['erlang', 'a tuple', '`{server, Server}`'],
    ['ocaml', 'a code span', '`start`, `allow_kill`'],
    ['lisp', 'a name without its package', '`client`, `fetch-snapshot`'],
    ['raku', 'an adverb', '`:parse-only`, `:format`'],
    ['raku', 'a variable or an environment table', '`$snapshot`, `%*ENV`'],
    ['raku', 'a method call on a variable', '`$snapshot.clients`'],
    ['raku', 'a name its tokenizer cannot resolve whole', '`Server.start`'],
    ['raku', 'options and ids', '`-S`, `%0` and `"x y"`'],
    ['raku', 'a doubled span, which is literal', '``start``, ``run-batch``'],
    ['raku', 'a Go doc link', '[Server.Kill]'],
    ['raku', 'a role', ':obj:`start`'],
    ['perl', 'a code span, which Perl keeps literal', '`snapshot`, `LibTmux::Server`'],
    ['perl', 'a Markdown link', '[text](https://example.test)'],
    ['perl', 'a role the adapter does not write', ':meth:`LibTmux::Server::snapshot`'],
    ['perl', 'a Go doc link', '[Server.Kill]'],
    ['clojure', 'a code span', '`open!`, `libtmux.data/windows`'],
    ['clojure', 'a keyword', '`:tmux/ref`, `:detached?`'],
    ['clojure', 'a link with a target no var has', '[[a:b]], [[x@y]]'],
    ['clojure', 'a Go doc link', '[Server.Kill]'],
    ['clojure', 'a reference-style link', '[text][ref]'],
  ])('%s does not read %s', (lang, _, ref) => {
    expect(groupDirectory(parseApiProse(run(ref)), lang).some((block) => block.kind === 'directory')).toBe(false)
  })
})

describe('a capability directory in python reads the roles the tokenizer resolves and no others', () => {
  const run = (follower: string) => Array.from({ length: 3 }, (_, n) => `**Group ${n}.** What these are for.\n\n${follower}`).join('\n\n')
  it.each([
    'class', 'meth', 'attr', 'func', 'exc', 'obj', 'mod', 'data', 'const', 'py:class', 'py:meth', 'py:attr', 'py:func',
    'py:exc', 'py:obj', 'py:mod', 'py:data', 'py:const', 'term', 'ref', 'doc', 'py:term',
  ])(':%s: is a directory reference exactly when the tokenizer reads it as one', (role) => {
    const ref = `:${role}:\`libtmux.Server.kill\``
    const read = groupDirectory(parseApiProse(run(ref)), 'py').some((block) => block.kind === 'directory')
    expect(read, ref).toBe(tokenizeDoc(ref, 'py').every((span) => span.kind === 'ref'))
  })
})

/**
 * The shape a native docstring gives the server's directory, which the shell folds into a table: a heading, bold-led task
 * paragraphs, each followed by a reference paragraph or a `- Label: refs` list.
 */
const DIRECTORY_SHAPES: { port: string; refs: [string, string, string, string]; owner: string }[] = [
  { port: 'clojure', owner: 'libtmux.core/open!', refs: ['[[open!]]', '[[close!]]', '[[libtmux.data/windows]]', '[[libtmux.control/attach!]]'] },
  { port: 'perl', owner: 'LibTmux::Server', refs: [':obj:`"new" <LibTmux::Server::new>`', ':obj:`"snapshot" <LibTmux::Server::snapshot>`', ':obj:`"show_buffer" <LibTmux::Server::show_buffer>`', ':obj:`LibTmux::Selection <LibTmux::Selection>`'] },
  { port: 'raku', owner: 'LibTmux::Server', refs: ['`new`', '`start`', '`has-session(:name)`', '`run-batch`'] },
]

describe.each(DIRECTORY_SHAPES)('the server directory of $port, as its docstring is written', ({ port, refs: [a, b, c, d] }) => {
  const doc = [
    '# What is on here', 'A server is what a program connects to.',
    `**Connecting.** Open one, or take the one tmux started.\n\n- Open: ${a}, ${b}\n- Close: ${c}`,
    `**Capturing.** Read what is on screen.\n\n${b}, ${c} and ${d}`,
    `**Acting.** Change the session.\n\n- Create: ${a}\n- Run: ${b}, ${d}`,
  ].join('\n\n')

  it('folds three rows, one labelled list and one paragraph of references among them', () => {
    const blocks = groupDirectory(parseApiProse(doc), port)
    expect(blocks.map((block) => block.kind)).toEqual(['rubric', 'p', 'directory'])
    const directory = blocks[2]
    if (directory?.kind !== 'directory') throw new Error('no directory')
    expect(directory.rows.map((row) => row.title)).toEqual(['Connecting', 'Capturing', 'Acting'])
    expect(directory.rows.map((row) => row.groups)).toEqual([
      [{ label: 'Open', refs: [a, b] }, { label: 'Close', refs: [c] }],
      [{ refs: [b, c, d] }],
      [{ label: 'Create', refs: [a] }, { label: 'Run', refs: [b, d] }],
    ])
  })

  it('keeps prose with a code span or a link among its words as prose', () => {
    const prose = (follower: string) => ['Connecting', 'Capturing', 'Acting'].map((title) => `**${title}.** Guidance.\n\n${follower}`).join('\n\n')
    for (const follower of [`Call ${a} first, then ${b}.`, `- Open: ${a}, then ${b}`, `${a} and a [guide](https://example.test/guide)`]) {
      expect(groupDirectory(parseApiProse(prose(follower)), port).some((block) => block.kind === 'directory'), follower).toBe(false)
    }
  })
})

describe('a Clojure directory reads the wiki links the tokenizer resolves and no others', () => {
  const run = (follower: string) => Array.from({ length: 3 }, (_, n) => `**Group ${n}.** What these are for.\n\n${follower}`).join('\n\n')
  it.each([
    '[[open!]]', '[[libtmux.data/windows]]', '[[subscribe! subscribe]]', '[[same-entity?]]', '[[a:b]]', '[[x@y]]', '[[]]', '[[ open!]]', '[[open!',
  ])('%s is a directory reference exactly when the tokenizer reads it as one', (ref) => {
    const read = groupDirectory(parseApiProse(run(ref)), 'clojure').some((block) => block.kind === 'directory')
    const spans = tokenizeDoc(ref, 'clojure')
    expect(read, ref).toBe(spans.length === 1 && spans[0]!.kind === 'ref')
  })
})

describe('Perl headings stay section anchors beside a directory', () => {
  const rows = (follower: string) => ['A', 'B', 'C'].map((title) => `# ${title}\n\nWhat these are for.\n\n${follower}`).join('\n\n')
  it('folds only bold-led rows, so a POD heading keeps the id its section links use', () => {
    const blocks = groupDirectory(parseApiProse(rows(':obj:`"new" <LibTmux::Server::new>`, :obj:`"snapshot" <LibTmux::Server::snapshot>`')), 'perl')
    expect(blocks.map((block) => block.kind)).toEqual(['rubric', 'p', 'p', 'rubric', 'p', 'p', 'rubric', 'p', 'p'])
    // Go writes the same shape as a directory.
    expect(groupDirectory(parseApiProse(rows('[Server.Kill], [NewServer]')), 'go').map((block) => block.kind)).toEqual(['directory'])
  })
})

describe('a Haskell module\'s export groups', () => {
  const model = API_MODELS.haskell
  const grouped = model.symbols.filter((symbol) => symbol.kind === 'module' &&
    model.exportGroups!.filter((group) => group.owner === symbol.id).length >= 3)

  it('fold into the directory other ports show, one row per group in export-list order', () => {
    expect(grouped.map((symbol) => symbol.id)).toContain('LibTmux.Server')
    for (const module of grouped) {
      const groups = model.exportGroups!.filter((group) => group.owner === module.id)
      const blocks = groupDirectory(parseApiProse(module.doc!.body!), 'haskell')
      const directory = blocks.find((block) => block.kind === 'directory')
      if (directory?.kind !== 'directory') throw new Error(`${module.id} has no directory`)
      expect(directory.rows.map((row) => row.title), module.id).toEqual(groups.map((group) => group.title))
      expect(directory.rows.map((row) => row.groups.flatMap((entry) => entry.refs).length), module.id)
        .toEqual(groups.map((group) => group.members.length))
      expect(blocks.some((block) => block.kind === 'rubric' && block.text === 'What is on here'), module.id).toBe(true)
    }
  })

  it('leave a module with fewer than three groups without one', () => {
    for (const module of model.symbols.filter((symbol) => symbol.kind === 'module' && !grouped.includes(symbol))) {
      expect(module.doc?.body ?? '', module.id).not.toContain('What is on here')
    }
  })
})

describe('the capability directory of Erlang, OCaml, Common Lisp, Raku, Perl and Clojure', () => {
  // The shell folds whatever prose the pinned model carries, so a model pinned before the native docs gained their
  // directory has a correct reader and no table.
  const OWNERS: { port: string; id: string; rows: number; refs?: number }[] = [
    { port: 'erlang', id: 'tmux_server', rows: 8 },
    { port: 'ocaml', id: 'Libtmux_unix.Client', rows: 8 },
    { port: 'lisp', id: 'libtmux:client', rows: 8 },
    { port: 'raku', id: 'LibTmux::Server', rows: 7, refs: 46 },
    { port: 'perl', id: 'LibTmux::Server', rows: 10, refs: 43 },
    { port: 'clojure', id: 'libtmux.core/open!', rows: 9, refs: 62 },
  ]

  it.each(OWNERS)('is on the pinned $port model, in $rows rows on $id', ({ port, id, rows, refs }) => {
    const owner = API_MODELS[port].symbols.find((symbol) => symbol.id === id)
    const directory = groupDirectory(parseApiProse(owner?.doc?.body ?? ''), port).find((block) => block.kind === 'directory')
    if (directory?.kind !== 'directory') throw new Error(`${port} ${id} has no directory`)
    expect(directory.rows).toHaveLength(rows)
    for (const row of directory.rows) expect(row.groups.flatMap((group) => group.refs).length, row.title).toBeGreaterThan(0)
    if (refs) expect(directory.rows.flatMap((row) => row.groups.flatMap((group) => group.refs))).toHaveLength(refs)
  })

  it('fences the Raku Server\'s code and links the methods its description names', () => {
    const { symbols } = API_MODELS.raku
    const server = symbols.find((symbol) => symbol.id === 'LibTmux::Server')!
    const blocks = parseApiProse(server.doc?.body ?? '')
    expect(blocks.filter((block) => block.kind === 'code' && block.lang === 'raku').length).toBeGreaterThan(0)
    const index = new SymbolIndex(symbols, (symbol) => `/reference/${symbol.id}/`, 'raku')
    const linked = new Set(blocks.flatMap((block) => block.kind === 'p' ? index.docSpans(block.text, server) : [])
      .flatMap((span) => span.kind === 'ref' && span.link?.symbol ? [span.link.symbol.id] : []))
    for (const name of ['start', 'attach', 'run-batch', 'from-env']) expect(linked, name).toContain(`LibTmux::Server.${name}`)
  })

  it('lists the Common Lisp client\'s operations as members of its class', () => {
    const members = API_MODELS.lisp.symbols.filter((symbol) => symbol.parent === 'libtmux:client')
    expect(members.map((symbol) => symbol.id)).toEqual(expect.arrayContaining(['libtmux:fetch-snapshot', 'libtmux:send-text']))
    expect(members.every((symbol) => symbol.kind === 'function')).toBe(true)
  })
})

describe('generated Python docstring parity', () => {
  it('keeps all source sessions and experimental emphasis in HTML input and Markdown', () => {
    const model = API_MODELS.py
    const symbol = model.symbols.find((entry) => entry.id === 'libtmux._internal.query_list.QueryList')!
    const source = readFileSync(new URL('../../packages/api-model/test/fixtures/python-querylist-docstring.txt', import.meta.url), 'utf8')
    const expected = [...source.matchAll(/^>>>[^\n]*(?:\n[^\n]+)*/gm)].map((match) => match[0])
    expect(parseApiProse(symbol.doc!.body!).filter((block) => block.kind === 'code').map((block) => block.code)).toEqual(expected)
    const markdown = symbolMarkdown({ model, symbol })
    const tree = fromMarkdown(markdown)
    expect(tree.children.filter((node) => node.type === 'code').map((node) => node.value)).toEqual(expected)
    expect(markdown).toContain('*Experimental, unstable*.')
    expect(markdown).toContain('[`list`](https://docs.python.org/3/builtins/stdtypes.html#list)')
    expect(markdown).toContain('[`t.Generic`](https://docs.python.org/3/library/typing.html#typing.Generic)')
    expect(markdown).toContain('libtmux._internal.query_list.QueryList')
  })
})


describe('a description\'s directory is drawn for every port', () => {
  const row = (title: string, refs: string) => `**${title}.** What these are for.\n\n${refs}`
  const body = (refs: string) => ['# What is on here', 'A server is what a program connects to.', row('Connecting', refs), row('Capturing', refs), row('Acting', refs)].join('\n\n')
  const render = async (port: string, text: string) => {
    const [{ Window }, { createComponent, renderTemplate }, { loadAstroTemplate, renderAstroTemplate }, { SymbolIndex }] = await Promise.all([
      import('happy-dom'), import('astro/runtime/server/index.js'), import('./astro-templates'), import('@libtmux/api-model/reference'),
    ])
    const Code = createComponent((_result: unknown, props: { code: string }) => renderTemplate`<pre>${props.code}</pre>`)
    const template = await loadAstroTemplate('components/api/ApiProse.astro', { real: ['components/api/ApiDoc.astro'], modules: { 'astro-expressive-code/components': { Code } } })
    const win = new Window()
    try {
      win.document.body.innerHTML = await renderAstroTemplate(template, { props: { text, index: new SymbolIndex([], () => '#', port) } })
      return { rows: win.document.querySelectorAll('.api-directory__row').length, chips: win.document.querySelectorAll('.api-directory__chips li').length,
        rubrics: [...win.document.querySelectorAll('p.rubric')].map((node) => node.textContent) }
    } finally { await win.happyDOM.abort() }
  }

  it.each([
    ['perl', ':obj:`"new" <LibTmux::Server::new>`, :obj:`"snapshot" <LibTmux::Server::snapshot>`'],
    ['raku', '`new`, `start`'],
    ['clojure', '[[open!]], [[close!]]'],
  ])('shows %s as three rows of chips under the heading', async (port, refs) => {
    const drawn = await render(port, body(refs))
    expect(drawn).toEqual({ rows: 3, chips: 6, rubrics: ['What is on here'] })
  })
})

describe('the Markdown twin of a Raku description', () => {
  // The page links a Raku code span to the member it names; the twin took its allowlist from a port list without Raku and
  // left the same span plain.
  it('links the Server methods its description names, as the page does', () => {
    const model = API_MODELS.raku
    const server = model.symbols.find((symbol) => symbol.id === 'LibTmux::Server')!
    const markdown = symbolMarkdown({ model, symbol: server })
    for (const name of ['start', 'from-env', 'run-batch', 'snapshot']) {
      expect(markdown, name).toMatch(new RegExp(`\\[\`${name}\`\\]\\((?!/tmux/)[^)\\s]+\\)`))
    }
  })
})
