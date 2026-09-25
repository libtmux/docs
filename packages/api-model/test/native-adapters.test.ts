import { describe, expect, it } from 'vitest'
import { extractLua } from '../src/languages/lua.ts'
import { extractRuby } from '../src/languages/ruby.ts'
import { ownersOf } from '../src/prose.ts'

const REVISION = 'a'.repeat(40)

describe('Ruby native documentation adapter', () => {
  const artifact = {
    schema: 1,
    port: 'ruby',
    source: { repository: 'libtmux/libtmux-ruby', revision: REVISION },
    exporter: { name: 'scripts/export-docs', version: 1 },
    packages: [
      { name: 'libtmux', version: '0.1.0.alpha.1', require: 'libtmux', product: 'core', rbs: '' },
      { name: 'libtmux-mcp', version: '0.1.0.alpha.1', require: 'libtmux/mcp', product: 'mcp', rbs: '' },
    ],
    namespaces: [
      {
        id: 'LibTmux::Pane', name: 'Pane', kind: 'class', package: 'libtmux', product: 'core',
        documentation: 'A pane handle.\n\nBound to one server.',
        source: { path: 'gems/libtmux/lib/libtmux/pane.rb', line: 12 },
      },
    ],
    aliases: [{
      id: 'LibTmux::Async::scope_diagnostics', name: 'scope_diagnostics', package: 'libtmux-async',
      product: 'core', type: '{ closed: bool }',
      source: { path: 'gems/libtmux-async/sig/libtmux-async.rbs', line: 7 },
    }],
    symbols: [
      {
        id: 'LibTmux::Pane#active?', owner: 'LibTmux::Pane#active?', namespace: 'LibTmux::Pane',
        name: 'active?', kind: 'method', method_kind: 'instance', package: 'libtmux', product: 'core',
        visibility: 'public', signatures: ['() -> bool'], returns: ['bool'], documentation: 'Whether this pane is active.',
        tags: [], contract: { id: 'pane-state', title: 'Pane state' },
        source: { path: 'gems/libtmux/lib/libtmux/pane.rb', line: 30 },
      },
      {
        id: 'LibTmux::Pane.active?', owner: 'LibTmux::Pane.active?', namespace: 'LibTmux::Pane',
        name: 'active?', kind: 'method', method_kind: 'singleton', package: 'libtmux', product: 'core',
        visibility: 'public', signatures: ['(name: ::String, ?force: bool) -> ::LibTmux::Pane'],
        returns: ['::LibTmux::Pane'], documentation: '', tags: [],
        contract: { id: 'pane-state', title: 'Pane state' },
        source: { path: 'gems/libtmux/lib/libtmux/pane.rb', line: 40 },
      },
    ],
    guides: [],
    examples: { manifest: {}, files: [] },
  }

  it('preserves Ruby owner punctuation, overload text, and package sources', () => {
    const model = extractRuby(artifact, REVISION)
    expect(model.port).toBe('ruby')
    expect(model.sources?.map((source) => [source.product, source.package, source.version])).toEqual([
      ['core', 'libtmux', '0.1.0.alpha.1'],
      ['mcp', 'libtmux-mcp', '0.1.0.alpha.1'],
    ])
    expect(model.symbols.map((symbol) => symbol.id)).toEqual([
      'LibTmux::Pane',
      'LibTmux::Async::scope_diagnostics',
      'LibTmux::Pane#active?',
      'LibTmux::Pane.active?',
    ])
    const singleton = model.symbols.at(-1)!
    expect(singleton.modifiers).toContain('static')
    expect(singleton.signatures[0]).toMatchObject({
      raw: '(name: ::String, ?force: bool) -> ::LibTmux::Pane',
      params: [
        { name: 'name', type: '::String' },
        { name: 'force', type: 'bool', default: 'nil' },
      ],
      returns: '::LibTmux::Pane',
    })
    expect(model.symbols[1]).toMatchObject({ package: 'libtmux-async', kind: 'typealias', apiScope: 'supporting' })
    expect(model.symbols[2]).toMatchObject({ package: 'libtmux', publicOwner: 'LibTmux::Pane#active?' })
  })

  it('rejects an artifact from a different source revision', () => {
    expect(() => extractRuby(artifact, 'b'.repeat(40))).toThrow(/source revision/i)
  })
})

describe('Lua native documentation adapter', () => {
  const definition = (file: string, line: number) => ({
    file, start: [line, 0], finish: [line, 1], type: 'doc.class', visible: 'public',
  })
  const artifact = {
    schema: 1,
    port: 'lua',
    source: { repository: 'libtmux/libtmux-lua', revision: REVISION },
    exporter: { name: 'scripts/export-docs', version: 1, luals: '3.19.1' },
    package: { name: 'libtmux', version: '0.1.0alpha1-1', source_tag: 'v0.1.0alpha1' },
    declarations: [
      {
        name: 'libtmux.query', type: 'type', view: 'libtmux.query',
        defines: [definition('lua/libtmux/query.lua', 3)],
        fields: [{
          name: 'where', file: 'lua/libtmux/query.lua', start: [20, 0], type: 'setfield', view: 'function',
          rawdesc: 'Filter records.', visible: 'public',
          extends: {
            args: [{ name: 'rows', view: 'T[]' }, { name: 'criteria', view: 'libtmux.Where' }],
            returns: [{ view: 'libtmux.Selection<T>' }],
            view: 'function libtmux.query.where(rows: T[], criteria: libtmux.Where) -> libtmux.Selection<T>',
          },
        }],
      },
      {
        name: 'libtmux.Request', type: 'type', view: 'libtmux.Request<T>',
        defines: [definition('lua/libtmux/_internal/runtime.lua', 100)],
        fields: [{
          name: 'await', file: 'lua/libtmux/_internal/runtime.lua', start: [120, 0], type: 'doc.field',
          view: 'fun(self: libtmux.Request<T>, timeout?: number):T?, libtmux.Error?', rawdesc: 'Wait for completion.',
          visible: 'public', extends: {
            args: [{ name: 'self', view: 'libtmux.Request<T>' }, { name: 'timeout', view: 'number?' }],
            returns: [{ view: 'T?' }, { name: 'error', view: 'libtmux.Error?' }],
          },
        }],
      },
    ],
    guides: [],
    examples: [],
  }

  it('keeps module functions and renders receiver methods with colon identity', () => {
    const model = extractLua(artifact, REVISION)
    expect(model.port).toBe('lua')
    expect(model.sources?.[0]).toMatchObject({ package: 'libtmux', version: '0.1.0alpha1-1' })
    expect(model.symbols.map((symbol) => symbol.id)).toEqual([
      'libtmux.query',
      'libtmux.query.where',
      'libtmux.Request',
      'libtmux.Request:await',
    ])
    const receiver = model.symbols.at(-1)!
    expect(receiver.signatures[0]).toMatchObject({
      params: [{ name: 'timeout', type: 'number?' }],
      returns: 'T?, libtmux.Error?',
    })
    expect(receiver.source).toMatchObject({ file: 'lua/libtmux/_internal/runtime.lua', line: 120 })
    expect(ownersOf(model).map((symbol) => symbol.id)).toContain('libtmux.query')
  })

  it('rejects an artifact from a different source revision', () => {
    expect(() => extractLua(artifact, 'b'.repeat(40))).toThrow(/source revision/i)
  })

  it('reads the arguments of a fun-typed field and each overload of a union', () => {
    const arg = (name: string, view: string) => ({ name: { type: 'doc.type.arg.name', view: name }, view })
    const fn = (record: string, handle: string) => ({
      type: 'doc.type.function',
      args: [arg('self', 'libtmux.Server'), arg('record', record)],
      returns: [{ view: `(${handle})?` }, { view: '(libtmux.Error)?' }],
    })
    const typed = {
      ...artifact,
      declarations: [{
        name: 'libtmux.Server', type: 'type', view: 'libtmux.Server',
        defines: [definition('lua/libtmux/_internal/server.lua', 600)],
        fields: [
          {
            name: 'new_session', file: 'lua/libtmux/_internal/server.lua', start: [610, 0], type: 'doc.field',
            view: 'fun(self: libtmux.Server, options?: libtmux.NewSessionOptions):libtmux.Request<libtmux.Creation>',
            visible: 'public',
            extends: {
              type: 'doc.type',
              view: 'fun(self: libtmux.Server, options?: libtmux.NewSessionOptions):libtmux.Request<libtmux.Creation>',
              types: [{
                type: 'doc.type.function',
                args: [arg('self', 'libtmux.Server'), arg('options', '(libtmux.NewSessionOptions)?')],
                returns: [{ view: 'libtmux.Request<libtmux.Creation>' }],
              }],
            },
          },
          {
            name: 'handle', file: 'lua/libtmux/_internal/server.lua', start: [620, 0], type: 'doc.field',
            view: 'fun(self: libtmux.Server, record: libtmux.SnapshotSession)|fun(self: libtmux.Server, record: libtmux.SnapshotPane)',
            visible: 'public',
            extends: {
              type: 'doc.type',
              types: [
                { type: 'doc.type', types: [fn('libtmux.SnapshotSession', 'libtmux.Session')] },
                { type: 'doc.type', types: [fn('libtmux.SnapshotPane', 'libtmux.Pane')] },
              ],
            },
          },
        ],
      }],
    }
    const model = extractLua(typed)
    const create = model.symbols.find((s) => s.id === 'libtmux.Server:new_session')!
    expect(create.signatures[0]).toMatchObject({
      params: [{ name: 'options', type: 'libtmux.NewSessionOptions?', default: 'nil' }],
      returns: 'libtmux.Request<libtmux.Creation>',
    })
    const handle = model.symbols.find((s) => s.id === 'libtmux.Server:handle')!
    expect(handle.modifiers).toContain('overload')
    expect(handle.signatures.map((s) => [s.params.map((p) => p.type), s.returns])).toEqual([
      [['libtmux.SnapshotSession'], 'libtmux.Session?, libtmux.Error?'],
      [['libtmux.SnapshotPane'], 'libtmux.Pane?, libtmux.Error?'],
    ])
  })

  it('credits a field LuaLS copied into a subclass to the class that declared it', () => {
    const field = (name: string, line: number) => ({
      name, file: 'lua/libtmux/_internal/entity.lua', start: [line, 0], type: 'doc.field',
      view: `fun(self: libtmux.Entity<T>)`, visible: 'public',
      extends: { args: [{ name: 'self', view: 'libtmux.Entity<T>' }], returns: [] },
    })
    const declare = (name: string, parent: string | undefined, fields: ReturnType<typeof field>[]) => ({
      name, type: 'type', view: name,
      defines: [{ ...definition('lua/libtmux/_internal/entity.lua', 1), ...(parent ? { extends: [{ view: parent }] } : {}) }],
      fields,
    })
    const hierarchy = {
      ...artifact,
      declarations: [
        declare('libtmux.Entity', undefined, [field('snapshot', 10)]),
        declare('libtmux.Configurable', 'libtmux.Entity<T>', [field('snapshot', 10), field('get_option', 20)]),
        declare('libtmux.Session', 'libtmux.Configurable<libtmux.SnapshotSession>', [
          field('snapshot', 10), field('get_option', 20), field('new_window', 30),
        ]),
      ],
    }
    const inherited = (model: ReturnType<typeof extractLua>) =>
      Object.fromEntries(model.symbols.filter((s) => s.parent === 'libtmux.Session').map((s) => [s.name, s.inheritedFrom]))
    expect(inherited(extractLua(hierarchy))).toEqual({
      snapshot: 'libtmux.Entity',
      get_option: 'libtmux.Configurable',
      new_window: undefined,
    })
    // A cycle in `extends` ends the walk instead of the stack.
    hierarchy.declarations[0]!.defines[0] = { ...hierarchy.declarations[0]!.defines[0]!, extends: [{ view: 'libtmux.Session' }] }
    expect(inherited(extractLua(hierarchy)).get_option).toBe('libtmux.Configurable')
  })
})
