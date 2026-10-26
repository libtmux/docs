import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { extractJulia, extractPowerShell, parameterId, SymbolIndex, type ApiSymbol } from '@libtmux/api-model'
import { API_MODELS, OWNER_KINDS } from '../src/lib/api-models'
import { membersByType } from '../src/lib/api-tree'
import { CONCEPT_DESCRIPTION, PORTS, PORT_BY_SLUG, referenceUrl } from '../src/lib/ports'
import { symbolMarkdown, symbolMarkdownWithLayout } from '../src/lib/symbol-markdown'
import { nativeSignatureText } from '../src/lib/api-sections'

function inlineCodes(text: string): string[] {
  const values: string[] = []
  type Node = { type: string; value?: string; children?: Node[] }
  const collect = (node: Node) => {
    if (node.type === 'inlineCode') values.push(node.value!)
    for (const child of node.children ?? []) collect(child)
  }
  collect(fromMarkdown(text))
  return values
}

it('exports the linked WhereOf generic without losing type syntax or authored content', () => {
  const model = API_MODELS.ts
  const owner = model.symbols.find((entry) => entry.id === 'selection.WhereOf')!
  const index = new SymbolIndex(model.symbols, (entry) => `/pr-42/en/ts/v1/reference/${entry.slug}/`, 'ts')
  const markdown = symbolMarkdown({ model, symbol: owner, index })
  expect(markdown).toContain('[`Selection`](/pr-42/en/ts/v1/reference/selection-selection/)`<`[`Pane`](/pr-42/en/ts/v1/reference/pane-pane/)`>`')
  expect(inlineCodes(markdown).join('')).toContain('Selection<Pane>')
  const authored = '[`Selection<Pane>`](../guide/?label=(pane)#example)'
  const fenced = '```ts\nconst panes: Selection<Pane> = snapshot.panes;\n```'
  const literal = '``Selection<Pane>``'
  const symbol = { ...owner, doc: { summary: '', body: [authored, literal, '`Selection<Missing, "Pane">`', fenced].join('\n\n') } }
  const exported = symbolMarkdown({ model, symbol, index })
  expect(exported).toContain(authored)
  expect(exported).toContain(fenced)
  expect(exported).toContain(literal)
  expect(exported).toContain('[`Selection`](/pr-42/en/ts/v1/reference/selection-selection/)`<Missing, "Pane">`')
  expect(exported).not.toContain('/reference/pane-pane/')
})

describe('API Markdown content parity', () => {
  it('links native tmux command mentions in every port without editing examples', () => {
    for (const port of PORTS) {
      const original = 'Call tmux resize-pane. Use `$ tmux run-shell` or `display-message`. Keep tmux has many panes.'
      const symbol: ApiSymbol = {
        id: 'commandExample', name: 'commandExample', kind: 'function', modifiers: [], signatures: [],
        source: { file: 'example' }, doc: { summary: original, body: 'Keep <a href="https://example.com/authored">run-shell</a>.', examples: [{ lang: 'sh', code: 'tmux run-shell true\n' }] },
      }
      const text = symbolMarkdown({ model: { ...API_MODELS[port.slug], symbols: [symbol] }, symbol })
      expect(text, port.slug).toContain('[resize-pane](/tmux/latest/manual/resize-pane/)')
      expect(text, port.slug).toMatch(/\[`(?:\$ tmux )?run-shell`\]\(\/tmux\/latest\/manual\/run-shell\/\)/)
      expect(text, port.slug).toContain('[`display-message`](/tmux/latest/manual/display-message/)')
      expect(text, port.slug).toContain('Keep tmux has many panes.')
      expect(text, port.slug).toContain('Keep <a href="https://example.com/authored">run-shell</a>.')
      expect(text, port.slug).toContain('```sh\ntmux run-shell true\n```')
    }
  })

  it('exports the Scala Using.resource callee link while preserving runnable code and authored links', () => {
    const model = API_MODELS.scala
    const server = model.symbols.find((symbol) => symbol.id === 'io.github.libtmux.scaladsl.Server')!
    const target = 'https://www.scala-lang.org/api/3.9.0/scala/util/Using$.html#resource-fffffb81'
    const markdown = symbolMarkdown({ model, symbol: server })
    expect(markdown).toContain('[`Using.resource`](' + target + ')`(server) { ... }`')
    expect(markdown).toContain('[`close()`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/AutoCloseable.html#close())')
    const source = '[`Using.resource`](https://example.com/authored)\n\n```scala\nUsing.resource(server) { ... }\n```'
    const symbol = { ...server, doc: { summary: source } }
    expect(symbolMarkdown({ model: { ...model, symbols: [symbol] }, symbol })).toContain(source)
  })

  it.each(['mcp', 'workspace'])('retains concept scope in Go %s declaration copies', (product) => {
    const model = API_MODELS.go
    const symbol = model.symbols.find((entry) => entry.product === product)!
    expect(symbolMarkdown({ model, symbol })).toContain(CONCEPT_DESCRIPTION)
  })

  it('keeps core and Python declaration copies outside concept scope', () => {
    const core = API_MODELS.go.symbols.find((entry) => entry.id === 'tmux.Server')!
    expect(symbolMarkdown({ model: API_MODELS.go, symbol: core })).not.toContain(CONCEPT_DESCRIPTION)
    const python = API_MODELS.py.symbols.find((entry) => entry.product === 'mcp')!
    expect(symbolMarkdown({ model: API_MODELS.py, symbol: python })).not.toContain(CONCEPT_DESCRIPTION)
  })

  it('exports cross-port native representations and acquisition differences', () => {
    const model = API_MODELS.cxx
    const symbol = model.symbols.find((symbol) => symbol.id === 'libtmux::Server')!
    const text = symbolMarkdown({ model, symbol })
    expect(text).toContain('## In other ports')
    expect(text).toContain('| PowerShell | [`LibTmux\\New-TmuxServer`]')
    expect(text).toContain('(cmdlet). This cmdlet constructs a shared .NET `LibTmux.Server`')
    expect(text).toContain('| Julia | [`LibTmux.Server`]')
    expect(text).toContain('| F# | [`LibTmux.FSharp.Server`]')
    expect(text).toContain('(module). This F# module provides functions')
    const snapshot = API_MODELS.julia.symbols.find((symbol) => symbol.id === 'LibTmux.snapshot')!
    const acquisition = symbolMarkdown({ model: API_MODELS.julia, symbol: snapshot })
    expect(acquisition).toContain('Capture the tmux hierarchy')
    expect(acquisition).not.toContain('at one instant')
    expect(acquisition).toContain('Acquisition is not atomic')
  })

  it('separates long TypeScript parameter lines and exports inline option descriptions as prose', () => {
    const model = API_MODELS.ts
    const symbol = model.symbols.find((entry) => entry.id === 'mcp.server.createTmuxMcpServer')!
    const text = symbolMarkdown({ model, symbol })
    const signature = fromMarkdown(text).children.find((node) => node.type === 'code')!
    expect(signature.type === 'code' && signature.value).toContain('createTmuxMcpServer(\n  tmux: Server,\n  options: {\n    readonly callerEnvironment?')
    expect(signature.type === 'code' && signature.value).not.toContain('/**')
    expect(text).not.toContain(': :')
    const params = text.slice(text.indexOf('## Parameters'))
    expect(params).toContain('`tmux` (`Server`)')
    expect(params).toContain('`callerEnvironment`: Complete environment identifying')
    expect(params).toContain('`startup`: Socket state and configuration provenance')
    expect(params).toContain('Default: `{}`.')
  })

  it('does not repeat a sole Julia method source that the header already identifies', () => {
    const model = API_MODELS.julia
    const symbol = model.symbols.find((entry) => entry.id === 'LibTmux.from_env')!
    const source = `https://github.com/${symbol.source.repo}/blob/${symbol.source.revision}/${symbol.source.file}#L${symbol.source.line}`
    const text = symbolMarkdown({ model, symbol, source })
    expect(text.split(source)).toHaveLength(2)
    expect(text).toContain('Mapping used to read `TMUX`.')
    expect(text).toContain('Explicit socket selectors bypass this lookup.')
    expect(text).toContain('Executable name or path for later operations')
  })

  it('displays Julia aliases, keyword defaults and resolved Documenter links', () => {
    const model = API_MODELS.julia
    const index = new SymbolIndex(model.symbols, (symbol) => `/reference/${symbol.slug}/`, 'julia')
    const alias = model.symbols.find((entry) => entry.id === 'LibTmux.SessionID')!
    expect(symbolMarkdown({ model, symbol: alias, index })).toContain('SessionID = TmuxID{:session}')
    const contains = model.symbols.find((entry) => entry.id === 'LibTmux.Filters.Contains')!
    expect(symbolMarkdown({ model, symbol: contains, index })).toContain('Default: `:sensitive`.')
    const cursor = model.symbols.find((entry) => entry.id === 'LibTmux.ObservationCursor')!
    const markdown = symbolMarkdown({ model, symbol: cursor, index })
    expect(markdown).not.toContain('](@ref)')
    expect(markdown).toContain('](/reference/libtmux-observation_cursor/)')
    const spans = index.linkText('[`observation_cursor`](@ref) and [Unicode](https://www.unicode.org/)', cursor)
    expect(spans.find((span) => span.kind === 'ref')?.link?.href).toBe('/reference/libtmux-observation_cursor/')
    expect(spans.find((span) => span.kind === 'link')).toMatchObject({ text: 'Unicode', href: 'https://www.unicode.org/' })
  })

  it('resolves PowerShell help links relative to their immutable source file', () => {
    const model = API_MODELS.powershell
    const commands = model.symbols.filter((symbol) => symbol.command)
    const links = commands.flatMap((symbol) => symbol.command!.relatedLinks).filter((link) => link.href)
    expect(links.length).toBeGreaterThan(100)
    expect(links.every((link) => /^https:\/\//.test(link.href))).toBe(true)
    expect(links.some((link) => link.href === `https://github.com/${model.repo}/blob/${model.revision}/docs/commands.md`)).toBe(true)
    const index = new SymbolIndex(model.symbols, (symbol) => `/reference/${symbol.slug}/`, 'powershell')
    const spans = index.linkText('[Guide](https://example.com/guide)')
    expect(spans).toEqual([{ kind: 'link', text: 'Guide', href: 'https://example.com/guide' }])
  })

  it('retains Julia method documentation, source links and optional-extension requirements', () => {
    const model = extractJulia(JSON.parse(readFileSync(new URL('../../packages/api-model/test/fixtures/julia-native.json', import.meta.url), 'utf8')))
    const index = new SymbolIndex(model.symbols, (symbol) => `/reference/${encodeURIComponent(symbol.id)}/`, 'julia')
    const kill = model.symbols.find((entry) => entry.id === 'LibTmux.kill_session')!
    const text = symbolMarkdown({ model, symbol: kill, index })
    for (const signature of kill.signatures) {
      expect(text).toContain(nativeSignatureText(kill, signature, 'julia'))
      expect(text).toContain(`/${signature.source!.file}#L${signature.source!.line}`)
      if (signature.doc?.summary) expect(text).toContain(signature.doc.summary)
    }
    expect(text).toContain('## Methods')
    expect(text).toContain('pinned daemon')
    const codec = model.symbols.find((entry) => entry.id === 'LibTmux.read_where_json')!
    expect(symbolMarkdown({ model, symbol: codec, index })).toContain('Available when `LibTmuxJSONExt` is loaded.')
  })

  it('exports separate, formatted C++ overloads with native specifiers and punctuation', () => {
    const model = API_MODELS.cxx
    const symbol = model.symbols.find((entry) => entry.id === 'libtmux::mcp::Arguments::Arguments')!
    const index = new SymbolIndex(model.symbols, (entry) => `/reference/${entry.slug}/`, 'cxx')
    const text = symbolMarkdown({ model, symbol, index })
    expect(text).toContain('Arguments() = default;\n\nArguments(\n    std::initializer_list<std::pair<std::string_view, std::string_view>> values);\n\nexplicit Arguments(FlatArguments values);')
    expect(text).not.toContain('values:')
    const signature = symbol.signatures[2]
    const spans = index.linkType(signature.raw!, symbol, signature)
    expect(spans.find((span) => span.text === 'Arguments')?.declaration).toBe(true)
    expect(spans.find((span) => span.text === 'explicit')?.keyword).toBe(true)
    expect(spans.find((span) => span.text === 'values')?.link?.href).toBe(`/reference/${symbol.slug}/#${encodeURIComponent(parameterId(symbol, 'values'))}`)
    expect(spans.find((span) => span.text === 'FlatArguments')?.link?.symbol?.id).toBe('libtmux::mcp::FlatArguments')
  })

  it('exports PowerShell syntax, parameter bindings, defaults and prose after examples', () => {
    const model = extractPowerShell(JSON.parse(readFileSync(new URL('../../packages/api-model/test/fixtures/powershell-native.json', import.meta.url), 'utf8')))
    const index = new SymbolIndex(model.symbols, (symbol) => `/reference/${encodeURIComponent(symbol.id)}/`, 'powershell')
    const pane = model.symbols.find((entry) => entry.name === 'Get-TmuxPane')!
    const text = symbolMarkdown({ model, symbol: pane, index })
    for (const signature of pane.signatures) expect(text).toContain(nativeSignatureText(pane, signature, 'powershell'))
    expect(text).toContain('## Command details')
    expect(text).toContain('Required. Position 0. Accepts pipeline input by value.')
    expect(text).toContain(' (for `Server`)')
    const invoke = model.symbols.find((entry) => entry.name === 'Invoke-TmuxPaneCommand')!
    const invocation = symbolMarkdown({ model, symbol: invoke, index })
    expect(invocation).toContain('Documented default: `30`.')
    const example = invoke.doc!.examples![0]
    expect(invocation).toContain(example.outro)
    expect(invocation.indexOf(example.outro!)).toBeGreaterThan(invocation.indexOf(example.code))
  })

  it('exports parent objects ahead of the collections and operations they own', () => {
    const model = API_MODELS.java
    const symbol = model.symbols.find((entry) => entry.id === 'io.github.libtmux.Window.Window')!
    const text = symbolMarkdown({ model, symbol })
    const parents = text.slice(text.indexOf('### Parent objects'), text.indexOf('### Collections and queries'))
    expect([...parents.matchAll(/^- `([^`]+)`/gm)].map((match) => match[1])).toEqual(['session', 'server'])
    expect(text.indexOf('### Parent objects')).toBeLessThan(text.indexOf('### Collections and queries'))
  })

  it('keeps a publicly inherited C++ server accessor with its parent objects', () => {
    const model = API_MODELS.cxx
    const symbol = model.symbols.find((entry) => entry.id === 'libtmux::Pane')!
    const text = symbolMarkdown({ model, symbol })
    const parents = text.slice(text.indexOf('### Parent objects')).split(/\n### /)[0]
    expect([...parents.matchAll(/^- `([^`]+)`/gm)].map((match) => match[1])).toEqual(['window', 'session', 'server'])
    expect(parents).toContain('inherited from `libtmux::detail::Row`')
  })

  it('links the F# lookup error to its .NET API in copied Markdown', () => {
    const model = API_MODELS.fsharp
    const symbol = model.symbols.find((entry) => entry.id === 'LibTmux.FSharp.Server.tryFindClient')!
    expect(symbolMarkdown({ model, symbol })).toContain(
      '[`System.ArgumentException`](https://learn.microsoft.com/dotnet/api/system.argumentexception)',
    )
  })

  it('prefers a library error over a same-named .NET exception in the selected version', () => {
    const error: ApiSymbol = {
      id: 'LibTmux.ArgumentException', name: 'ArgumentException', kind: 'class',
      modifiers: [], signatures: [], source: { file: 'example.fs' }, slug: 'argument-exception',
    }
    const symbol: ApiSymbol = {
      id: 'LibTmux.sample', name: 'sample', kind: 'function', modifiers: [],
      signatures: [{ params: [], raises: [{ type: 'ArgumentException', doc: 'A library error.' }] }],
      source: { file: 'example.fs' }, slug: 'sample',
    }
    const model = { ...API_MODELS.fsharp, symbols: [error, symbol] }
    const text = symbolMarkdown({ model, symbol, version: 'stable' })
    expect(text).toContain('[`ArgumentException`](' + referenceUrl(PORT_BY_SLUG.fsharp, 'stable') + 'argument-exception/)')
    expect(text).not.toContain('learn.microsoft.com')
  })

  it('keeps escaped Kotlin and Scala names literal in overload labels', () => {
    for (const [port, id, expected] of [
      ['kotlin', 'io.github.libtmux.kotlin.Hooks.`set`', '`set`(event, command) [overload 1]'],
      ['scala', 'io.github.libtmux.scaladsl.cats.CommandChain.`then`', '`then`(argv)'],
    ]) {
      const model = API_MODELS[port]
      const symbol = model.symbols.find((entry) => entry.id === id)!
      expect(inlineCodes(symbolMarkdown({ model, symbol }))).toContain(expected)
    }
  })

  it('preserves escaped parameter names and generic types as literal code', () => {
    const model = API_MODELS.kotlin
    for (const symbol of model.symbols.filter((entry) => entry.signatures.some((signature) =>
      signature.params.some((param) => param.name.includes('`'))))) {
      const codes = inlineCodes(symbolMarkdown({ model, symbol }))
      for (const signature of symbol.signatures) {
        for (const param of signature.params) {
          expect(codes, symbol.id).toContain(param.name)
          if (param.type) expect(codes, symbol.id).toContain(param.type)
        }
      }
    }
  })

  it('retains earlier overload contracts instead of replacing them with an undocumented final overload', () => {
    const model = API_MODELS.kotlin
    for (const name of ['session', 'window', 'pane']) {
      const symbol = model.symbols.find((entry) => entry.id === `io.github.libtmux.kotlin.Server.${name}`)!
      const text = symbolMarkdown({ model, symbol })
      expect(text).toContain('## Raises')
      expect(text).toContain('NoMatch')
      expect(text).toContain('MultipleMatches')
      expect(text).toContain('expression:')
    }
    const get = model.symbols.find((entry) => entry.id === 'io.github.libtmux.kotlin.Options.get')!
    expect(symbolMarkdown({ model, symbol: get })).toContain('## Returns')
  })

  for (const port of PORTS) {
    it(`${port.name} keeps every documented overload contract in Markdown`, () => {
      const model = API_MODELS[port.slug]
      for (const symbol of model.symbols.filter((entry) => entry.signatures.length > 1)) {
        const text = symbolMarkdown({ model, symbol })
        for (const signature of symbol.signatures) {
          if (signature.returnsDoc) expect(text, symbol.id).toContain(signature.returnsDoc)
          for (const param of signature.params) {
            if (param.doc) expect(text, `${symbol.id} parameter ${param.name}`).toContain(param.doc)
          }
          for (const error of signature.raises ?? []) {
            expect(text, symbol.id).toContain(error.type)
            if (error.doc) expect(text, symbol.id).toContain(error.doc)
          }
        }
      }
    })
  }

  it('preserves example bytes when blank lines and backticks are part of the program', () => {
    const code = 'const output = `first\n\n\nlast`;\nconsole.log(output);\nconsole.log("```");\n'
    const symbol: ApiSymbol = {
      id: 'example', name: 'example', kind: 'function', modifiers: [], signatures: [],
      source: { file: 'example.ts', line: 1 }, doc: { summary: 'Print the literal text.', examples: [{ lang: 'ts', code }] },
    }
    const text = symbolMarkdown({ model: { ...API_MODELS.ts, symbols: [symbol] }, symbol })
    expect(text).toContain(`\`\`\`\`ts\n${code}\`\`\`\``)
  })

  it('preserves parameters from every native overload, including undocumented bindings', () => {
    const model = API_MODELS.scala
    const symbol = model.symbols.find((entry) => entry.id === 'io.github.libtmux.scaladsl.Server.windows')!
    const text = symbolMarkdown({ model, symbol })
    expect(text).toContain('# io.github.libtmux.scaladsl.Server.windows')
    expect(text).toContain('**Module:** io.github.libtmux.scaladsl\n')
    for (const signature of symbol.signatures) expect(text).toContain(signature.raw)
    expect(text).toContain('## Parameters\n\n- `expression`')
    expect(text).toContain('- `id` (`io.github.libtmux.WindowId`)')
  })

  it('writes a Swift declaration with its parentheses once and keeps the selector in the heading', async () => {
    const model = API_MODELS.swift
    const index = new SymbolIndex(model.symbols, (entry) => `/reference/${entry.slug}/`, 'swift')
    const fence = (text: string) => text.match(/```\n([\s\S]*?)\n```/)?.[1]
    for (const [id, declaration] of [
      ['Server.panes()', 'panes() -> [Pane]'],
      ['Server.windows(named:)', 'windows(named: String) -> [Window]'],
      ['Server.init(socketName:tmuxExecutable:configurationFile:)', 'init(\n    socketName: String, tmuxExecutable: String,\n    configurationFile: String?)'],
    ] as const) {
      const symbol = model.symbols.find((entry) => entry.id === id)!
      const text = await symbolMarkdownWithLayout({ model, symbol, index })
      expect(text.startsWith(`# ${id}\n`), id).toBe(true)
      expect(fence(text), id).toBe(declaration)
    }
    // A signature the layout leaves to the plain export keeps one set of parentheses too.
    const symbol: ApiSymbol = {
      id: 'Server.apply(_:)', name: 'apply(_:)', kind: 'method', modifiers: [], source: { file: 'Server.swift' },
      signatures: [{ params: [{ name: 'count', type: 'Int', default: '1' }], returns: 'Int' }],
    }
    expect(fence(symbolMarkdown({ model: { ...model, symbols: [symbol] }, symbol, index }))).toBe('Server.apply(count: Int = 1) -> Int')
    const noArguments: ApiSymbol = { ...symbol, id: 'Server.reset()', name: 'reset()', signatures: [{ params: [{ name: 'to', type: 'Int', default: '0' }] }, { params: [] }] }
    expect(fence(symbolMarkdown({ model: { ...model, symbols: [noArguments] }, symbol: noArguments, index }))).toBe('Server.reset(to: Int = 0)\n\nServer.reset()')
  })

  it('uses the documented signature and keeps all declarations, warnings and provenance', () => {
    const symbol: ApiSymbol = {
      id: 'Server.capture', name: 'capture', kind: 'method', modifiers: ['overload'],
      source: { file: 'server.ts', line: 1 }, inheritedFrom: 'Base.capture',
      signatures: [
        { params: [{ name: 'limit', type: 'number' }], returns: 'string[]' },
        { params: [{ name: 'options', type: 'CaptureOptions', doc: 'Choose the line range.', since: '1.2', deprecated: 'Use a range.' }],
          returns: 'string[]', returnsDoc: 'The captured lines.', raises: [{ type: 'CaptureError', doc: 'The pane no longer exists.' }] },
      ],
      doc: { summary: 'Read pane output.', deprecated: 'Use Pane.capture.', changed: 'Returns complete lines.',
        admonitions: [{ kind: 'warning', text: 'The pane may exit between commands.' }],
        references: [{ name: 'manual', text: 'The tmux capture-pane manual.' }],
        examples: [{ lang: 'ts', code: 'await pane.capture()', intro: 'Read visible lines.' }] },
    }
    const text = symbolMarkdown({ model: { ...API_MODELS.ts, symbols: [symbol] }, symbol })
    expect(text).toContain('Server.capture(limit: number): string[]')
    expect(text).toContain('Server.capture(options: CaptureOptions): string[]')
    expect(text).toContain('**Inherited from:** Base.capture')
    expect(text).toContain('## Deprecated\n\nUse Pane.capture.')
    expect(text).toContain('## Changed\n\nReturns complete lines.')
    expect(text).toContain('**warning:** The pane may exit between commands.')
    expect(text).toContain('- [manual] The tmux capture-pane manual.')
    expect(text).toContain('## Parameters\n\n- `limit` (`number`)')
    expect(text).toContain('- `options` (`CaptureOptions`): Choose the line range. (added 1.2) (deprecated Use a range.)')
    expect(text).toContain('## Returns\n\nThe captured lines.')
    expect(text).toContain('## Raises\n\n- `CaptureError`: The pane no longer exists.')
    expect(text.indexOf('## Examples')).toBeLessThan(text.indexOf('## Parameters'))
  })

  for (const port of PORTS) {
    it(`${port.name} exports use the navigation's semantic order and retain inherited members`, () => {
      const model = API_MODELS[port.slug]
      const byId = new Map(model.symbols.map((symbol) => [symbol.id, symbol]))
      const tree = membersByType(port.slug)
      const entry = [...tree.entries()].find(([id, members]) => {
        const owner = byId.get(id) ?? model.symbols.find((symbol) => symbol.publicId === id)
        return owner && OWNER_KINDS.has(owner.kind) && members.length >= 3
      })
      expect(entry, `${port.slug} has an owner with members`).toBeDefined()
      const [id, ordered] = entry!
      const owner = byId.get(id) ?? model.symbols.find((symbol) => symbol.publicId === id)!
      const text = symbolMarkdown({ model, symbol: owner })
      const members = ordered.map((entry) => byId.get(entry.id)!)
      const expected = [...members.filter((member) => !member.inheritedFrom), ...members.filter((member) => member.inheritedFrom)]
        .map((member) => member.name)
      const memberText = text.slice(text.search(/^## (?:Members|Inherited members)$/m))
      const names = [...memberText.matchAll(/^- `([^`]+)` \([a-z]+\)/gm)].map((match) => match[1])
      expect(names).toEqual(expected)
      if (members.some((member) => member.inheritedFrom)) expect(text).toContain('## Inherited members')
    })
  }
})
