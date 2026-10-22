import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseElixirDoc } from '../src/doc/elixir.ts'
import { ELIXIR_DECLARATION_COLUMNS, extractElixir } from '../src/languages/elixir.ts'
import { SymbolIndex } from '../src/link.ts'
import { tokenizeDoc } from '../src/doc/roles.ts'
import { builtinHref } from '../src/builtins.ts'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/elixir-native.json', import.meta.url), 'utf8'))
const model = extractElixir(fixture, fixture.source.revision)
const symbol = (id: string) => model.symbols.find((entry) => entry.id === id)!
const index = new SymbolIndex(model.symbols, (entry) => `/${entry.publicId ?? entry.id}/`, 'elixir')

describe('Elixir native API adapter', () => {
  it('names the package, the exporter and the commit it describes', () => {
    expect(model).toMatchObject({ port: 'elixir', repo: 'libtmux/libtmux-elixir', revision: fixture.source.revision })
    expect(model.sources).toEqual([expect.objectContaining({ package: 'libtmux', product: 'core', version: '0.0.1-alpha.1' })])
    expect(model.extractor).toContain(fixture.exporter.name)
    expect(model.nativeProvenance?.files).toEqual(fixture.source.files)
    expect(fixture.exporter.columns).toBe(ELIXIR_DECLARATION_COLUMNS)
  })

  it('maps a module to its Elixir role and keeps its namespace apart from its name', () => {
    expect(symbol('LibTmux.Server')).toMatchObject({ name: 'Server', namespace: 'LibTmux', kind: 'struct', apiScope: 'exported' })
    expect(symbol('LibTmux.Error')).toMatchObject({ kind: 'exception', extends: ['Exception'] })
    expect(symbol('LibTmux.Snapshot').kind).toBe('struct')
  })

  it('names a member by its arity and gives it the module as parent', () => {
    const run = symbol('LibTmux.Server.run/3')
    expect(run).toMatchObject({ name: 'run/3', kind: 'function', parent: 'LibTmux.Server', namespace: 'LibTmux.Server' })
    expect(run.source).toMatchObject({ file: 'lib/libtmux/server.ex', repo: 'libtmux/libtmux-elixir', revision: fixture.source.revision })
    expect(run.source.line).toBeGreaterThan(1)
  })

  it('shows the head and the spec, with a parameter for each head argument', () => {
    const [signature] = symbol('LibTmux.Server.run/3').signatures
    expect(signature!.raw!.split('\n')[0]).toBe('run(server, command, options \\\\ [])')
    expect(signature!.raw).toContain('@spec run(t(), LibTmux.Command.t(), [')
    expect(signature!.params.map((param) => [param.name, param.type, param.default])).toEqual([
      ['server', 't()', undefined],
      ['command', 'LibTmux.Command.t()', undefined],
      ['options', '[LibTmux.Transport.OneShot.option()]', '[]'],
    ])
    expect(signature!.returns).toBe('{:ok, LibTmux.Transport.OneShot.result()} | {:error, LibTmux.Error.t()}')
  })

  it('lays every declaration out within the reference width', () => {
    for (const entry of model.symbols) {
      for (const signature of entry.signatures) {
        const widest = Math.max(...signature.raw!.split('\n').map((line) => line.length))
        expect(widest, entry.id).toBeLessThanOrEqual(ELIXIR_DECLARATION_COLUMNS + 4)
      }
    }
  })

  it('turns each spec clause of a function into an overload', () => {
    const selection = symbol('LibTmux.Selection.new/2')
    expect(selection.signatures).toHaveLength(5)
    expect(selection.modifiers).toContain('overload')
    expect(selection.signatures.map((signature) => signature.params[1]!.type)).toContain(':pane | LibTmux.Pane')
    expect(symbol('LibTmux.Server.run/3').modifiers).not.toContain('overload')
  })

  it('records a spec guard as a type parameter with its bound', () => {
    const where = symbol('LibTmux.Selection.where/2').signatures[0]!
    expect(where.typeParams).toEqual(['item: LibTmux.Schema.observation()'])
  })

  it('declares a type with its attribute and hides what an opaque type holds', () => {
    const server = symbol('LibTmux.Server.t/0')
    expect(server).toMatchObject({ kind: 'typealias', name: 't/0' })
    expect(server.signatures[0]!.raw).toMatch(/^@type t\(\) :: %LibTmux\.Server\{/)
    expect(server.type).toMatch(/^t\(\) :: %LibTmux\.Server\{/)
    const opaque = symbol('LibTmux.Selection.t/1')
    expect(opaque.modifiers).toContain('opaque')
    expect(opaque.signatures[0]!.raw).toBe('@opaque t(item)')
    expect(opaque.type).toBeUndefined()
    expect(opaque.typeParams).toEqual(['item'])
  })

  it('lists the fields of a struct whose type is public and none for an opaque one', () => {
    const fields = model.symbols.filter((entry) => entry.parent === 'LibTmux.Server' && entry.kind === 'property')
    expect(fields.map((field) => [field.name, field.type])).toEqual([
      ['executable', 'String.t()'], ['socket', 'String.t()'], ['cwd', 'String.t()'], ['env', '%{optional(binary()) => binary()}'],
    ])
    expect(fields[0]!.doc?.summary).toBe('Required: building the struct without this key is an error.')
    const session = model.symbols.filter((entry) => entry.parent === 'LibTmux.Session' && entry.kind === 'property')
    expect(session.find((field) => field.name === 'name')).toMatchObject({ value: ':unloaded', doc: undefined })
    expect(model.symbols.some((entry) => entry.parent === 'LibTmux.Selection' && entry.kind === 'property')).toBe(false)
    expect(model.symbols.some((entry) => entry.name === '__exception__')).toBe(false)
  })

  it('keeps ids unique and every symbol on a real source line', () => {
    const ids = model.symbols.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const entry of model.symbols.filter((candidate) => candidate.kind !== 'property')) expect(entry.source.line, entry.id).toBeGreaterThan(0)
  })

  it('carries since, deprecation and the target of a delegate without inventing them', () => {
    const input = structuredClone(fixture)
    const run = input.modules.find((entry: { name: string }) => entry.name === 'LibTmux.Server').members
      .find((entry: { id: string }) => entry.id === 'LibTmux.Server.run/3')
    run.since = '0.0.2'
    run.deprecated = 'Use snapshot/2.'
    run.doc = null
    run.delegateTo = 'LibTmux.Transport.OneShot.run/3'
    const edited = extractElixir(input).symbols.find((entry) => entry.id === 'LibTmux.Server.run/3')!
    expect(edited.modifiers).toContain('deprecated')
    expect(edited.doc).toMatchObject({ since: '0.0.2', deprecated: 'Use snapshot/2.', summary: 'See `LibTmux.Transport.OneShot.run/3`.' })
    expect(symbol('LibTmux.Server.run/3').doc?.since).toBeUndefined()
  })

  it('models a callback as an abstract method declared by its own attribute', () => {
    const input = structuredClone(fixture)
    const module = input.modules.find((entry: { name: string }) => entry.name === 'LibTmux.Server')
    module.kind = 'behaviour'
    module.members.push({
      id: 'LibTmux.Server.open/1', name: 'open', arity: 1, kind: 'callback', line: 99, doc: 'Opens one connection.',
      since: null, deprecated: null, source: { file: 'lib/libtmux/server.ex', line: 99 }, signature: 'open(keyword)', head: 'open(keyword)',
      parameters: [{ name: 'keyword', default: null }], defaults: 0, guard: false, delegateTo: null, equiv: null,
      specs: [{ parameters: ['keyword()'], returns: '{:ok, term()}', constraints: [], text: '@callback open(keyword()) :: {:ok, term()}' }],
    })
    const edited = extractElixir(input)
    expect(edited.symbols.find((entry) => entry.id === 'LibTmux.Server')!.kind).toBe('interface')
    const callback = edited.symbols.find((entry) => entry.id === 'LibTmux.Server.open/1')!
    expect(callback).toMatchObject({ kind: 'method', modifiers: ['abstract'] })
    expect(callback.signatures[0]!.raw).toBe('@callback open(keyword()) :: {:ok, term()}')
  })

  it.each([
    ['an unsupported schema', (artifact: typeof fixture) => { artifact.schema = 2 }],
    ['a revision that is not a commit', (artifact: typeof fixture) => { artifact.source.revision = 'main' }],
    ['declarations laid out for another width', (artifact: typeof fixture) => { artifact.exporter.columns = 80 }],
    ['a repeated member', (artifact: typeof fixture) => { artifact.modules[0].members.push(artifact.modules[0].members[0]) }],
    ['a member without a source line', (artifact: typeof fixture) => { artifact.modules[0].members[0].source.line = 0 }],
  ])('rejects %s', (_name, mutate) => {
    const input = structuredClone(fixture)
    mutate(input)
    expect(() => extractElixir(input)).toThrow()
  })

  it('rejects an artifact exported from another checkout', () => {
    expect(() => extractElixir(fixture, 'f'.repeat(40))).toThrow('differs from the selected checkout')
  })
})

describe('ExDoc Markdown', () => {
  const doctest = [
    'Counts the items.',
    '',
    '## Examples',
    '',
    '    iex> Selection.size(selection)',
    '    3',
    '',
    '    iex> Selection.size(empty)',
    '    ...> |> Kernel.+(0)',
    '    0',
    '',
    'The count never refreshes.',
  ].join('\n')

  it('fences an indented doctest as one Elixir example and keeps its prompts and results', () => {
    const { doc } = parseElixirDoc(doctest)
    expect(doc.summary).toBe('Counts the items.')
    // The expressions of one indented block stay together, as ExDoc draws them.
    expect(doc.examples).toEqual([
      { lang: 'elixir', code: 'iex> Selection.size(selection)\n3\n\niex> Selection.size(empty)\n...> |> Kernel.+(0)\n0', intro: undefined },
    ])
    expect(doc.body ?? '').not.toContain('iex>')
  })

  it('leaves a fenced block alone and treats a bare fence as Elixir', () => {
    const { doc } = parseElixirDoc('Summary.\n\n```\nServer.new(socket: "/tmp/tmux")\n```\n')
    expect(doc.examples).toEqual([{ lang: 'elixir', code: 'Server.new(socket: "/tmp/tmux")', intro: undefined }])
  })

  it('does not mistake a prompt inside a fence for a second doctest', () => {
    const { doc } = parseElixirDoc('Summary.\n\n```text\n    iex> 1 + 1\n```\n')
    expect(doc.examples).toHaveLength(1)
    expect(doc.examples![0]!.code).toBe('    iex> 1 + 1')
  })

  it('lifts an ExDoc admonition into a callout', () => {
    const { doc } = parseElixirDoc('Summary.\n\n> #### Careful {: .warning}\n>\n> Do not replay a mutation.\n')
    expect(doc.admonitions).toEqual([{ kind: 'warning', text: '**Careful** Do not replay a mutation.' }])
  })

  it('reads a code destination as a reference', () => {
    const spans = tokenizeDoc('See [the server](`LibTmux.Server`) and `new/1`.', 'elixir')
    expect(spans.filter((span) => span.kind === 'ref')).toEqual([
      { kind: 'ref', role: 'any', target: 'LibTmux.Server', label: 'the server' },
      { kind: 'ref', role: 'any', target: 'new/1', label: 'new/1' },
    ])
  })
})

describe('Elixir references', () => {
  const server = symbol('LibTmux.Server')
  const snapshot = symbol('LibTmux.Server.snapshot/2')

  it.each([
    ['LibTmux.Server', '/LibTmux.Server/'],
    ['Server', '/LibTmux.Server/'],
    ['LibTmux.Server.snapshot/2', '/LibTmux.Server.snapshot/2/'],
    ['Server.snapshot/2', '/LibTmux.Server.snapshot/2/'],
    ['snapshot/2', '/LibTmux.Server.snapshot/2/'],
    ['snapshot', '/LibTmux.Server.snapshot/2/'],
    ['t:option/0', '/LibTmux.Server.option/0/'],
    ['t:t/0', '/LibTmux.Server.t/0/'],
    ['Snapshot.sessions/1', '/LibTmux.Snapshot.sessions/1/'],
  ])('resolves %s from inside Server', (target, href) => {
    expect(index.resolve(target, 'any', snapshot)?.href).toBe(href)
  })

  it('resolves a module name from a module that sits beside it', () => {
    expect(index.resolve('Snapshot', 'any', server)?.href).toBe('/LibTmux.Snapshot/')
  })

  it('prefers the function to a type of the same name unless the reference says t:', () => {
    const input = structuredClone(fixture)
    const members = input.modules.find((entry: { name: string }) => entry.name === 'LibTmux.Server').members
    members.push({ ...members.find((entry: { id: string }) => entry.id === 'LibTmux.Server.run/3'), id: 'LibTmux.Server.option/1',
      name: 'option', arity: 1, line: 98, source: { file: 'lib/libtmux/server.ex', line: 98 } })
    const edited = extractElixir(input)
    const both = new SymbolIndex(edited.symbols, (entry) => `/${entry.id}/`, 'elixir')
    expect(both.resolve('option', 'any', edited.symbols.find((entry) => entry.id === 'LibTmux.Server')!)?.href).toBe('/LibTmux.Server.option/1/')
    expect(both.resolve('t:option', 'any', edited.symbols.find((entry) => entry.id === 'LibTmux.Server')!)?.href).toBe('/LibTmux.Server.option/0/')
  })

  it('sends the standard library to its own documentation and invents nothing else', () => {
    expect(index.resolve('Enum.to_list/1', 'any', snapshot)).toMatchObject({ external: true, href: 'https://hexdocs.pm/elixir/Enum.html#to_list/1' })
    expect(index.resolve('t:Enumerable.t/0', 'any', snapshot)).toMatchObject({ external: true, href: 'https://hexdocs.pm/elixir/Enumerable.html#t:t/0' })
    expect(index.resolve('Nonexistent.thing/1', 'any', snapshot)).toBeUndefined()
    expect(index.resolve('missing/9', 'any', snapshot)).toBeUndefined()
  })

  it('links the types in a declaration and leaves values, keys and attributes plain', () => {
    const [signature] = snapshot.signatures
    const spans = index.linkType(signature!.raw!, snapshot, signature)
    const linked = Object.fromEntries(spans.filter((span) => span.link).map((span) => [span.text, span.link!.href]))
    expect(linked).toMatchObject({
      server: '/LibTmux.Server.snapshot/2/#LibTmux.Server.snapshot%2F2.parameter.server',
      'LibTmux.Snapshot.t': '/LibTmux.Snapshot.t/0/',
      'LibTmux.Error.t': '/LibTmux.Error.t/0/',
    })
    expect(spans.find((span) => span.text === 'spec')).toMatchObject({ keyword: true })
    expect(spans.filter((span) => span.declaration && !span.link).map((span) => span.text)).toEqual(['snapshot', 'snapshot'])
    // `:ok` and `:error` are atoms, not references to anything named ok.
    expect(spans.filter((span) => span.text === 'ok' || span.text === 'error').every((span) => !span.link)).toBe(true)
  })

  it('links a standard-library type written as a remote call', () => {
    const server = symbol('LibTmux.Server.t/0')
    const spans = index.linkType(server.signatures[0]!.raw!, server, server.signatures[0])
    expect(spans.find((span) => span.text === 'String.t')?.link).toMatchObject({ external: true, href: builtinHref('elixir', 'String.t') })
    expect(spans.find((span) => span.text === 'binary')?.link?.href).toContain('typespecs.html#built-in-types')
  })

  it('binds a type variable to the declaration that introduces it', () => {
    const where = symbol('LibTmux.Selection.where/2')
    const spans = index.linkType(where.signatures[0]!.raw!, where, where.signatures[0])
    expect(spans.filter((span) => span.text === 'item').every((span) => span.link?.typeParameter)).toBe(true)
  })
})
