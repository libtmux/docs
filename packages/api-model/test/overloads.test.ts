import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { extractDoxygen } from '../src/languages/doxygen.ts'
import { extractJvm } from '../src/languages/jvm.ts'
import { extractWithSpec } from '../src/languages/spec.ts'
import { CSHARP, JAVA, RUST, TYPESCRIPT } from '../src/languages/specs.ts'
import { extractSymbolGraph } from '../src/languages/symbolgraph.ts'
import type { ApiModel, ApiSymbol, PortSlug } from '../src/model.ts'
import { canOverload, misplacedOverloads } from '../src/overloads.ts'
import { extractProject } from '../src/project.ts'

const here = dirname(fileURLToPath(import.meta.url))
const DATA = join(here, '../../../site/src/data/api')

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A source tree on disk: `files` maps a relative path to its text. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'overload-'))
  dirs.push(root)
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), text)
  }
  return root
}

/** One file through a language spec, the way a single-file port extracts it. */
async function oneFile(spec: Parameters<typeof extractWithSpec>[0], name: string, module: string, text: string) {
  return extractWithSpec(spec, join(tree({ [name]: text }), name), module)
}

/** A whole source tree through the project pass, which merges across files. */
async function project(port: PortSlug, files: Record<string, string>) {
  return (await extractProject({ port, root: tree(files), revision: 'test' })).symbols
}

const get = (symbols: ApiSymbol[], id: string): ApiSymbol => {
  const found = symbols.find((symbol) => symbol.id === id)
  if (!found) throw new Error(`no ${id} in ${symbols.map((symbol) => symbol.id).join(', ')}`)
  return found
}

describe('the rule', () => {
  const symbol = (kind: ApiSymbol['kind'], signatures: number, modifiers: ApiSymbol['modifiers'] = ['overload']): ApiSymbol => ({
    id: `m.${kind}`, name: kind, kind, modifiers,
    signatures: Array.from({ length: signatures }, () => ({ params: [] })),
    source: { file: 'm.ts' },
  })

  it('allows a callable with several signatures and nothing else', () => {
    expect(canOverload(symbol('method', 2))).toBe(true)
    expect(canOverload(symbol('function', 3))).toBe(true)
    expect(canOverload(symbol('method', 1))).toBe(false)
    for (const kind of ['class', 'struct', 'enum', 'interface', 'trait', 'attribute', 'property', 'module'] as const) {
      expect(canOverload(symbol(kind, 2)), kind).toBe(false)
    }
  })

  it('names a type, and a callable with one signature, that claims to be an overload set', () => {
    const planted = [symbol('struct', 0), symbol('class', 2), symbol('attribute', 1), symbol('method', 1)]
    expect(misplacedOverloads([...planted, symbol('method', 2), symbol('function', 2), symbol('struct', 0, [])]))
      .toEqual(planted)
  })
})

describe('Rust types written as a declaration and its impl blocks', () => {
  it('keeps one struct and one enum without an overload, however many impls they have', async () => {
    const symbols = await oneFile(RUST, 'session.rs', 'session', `
/// A tmux session.
pub struct Session { pub id: u32 }
impl Session { pub fn name(&self) -> String { todo!() } }
impl Clone for Session { fn clone(&self) -> Self { todo!() } }
/// How a pane splits.
pub enum Direction { Left, Right }
impl Direction { pub fn flip(&self) -> Self { todo!() } }
`)
    expect(get(symbols, 'session.Session')).toMatchObject({ kind: 'struct', doc: { summary: 'A tmux session.' } })
    expect(get(symbols, 'session.Direction').kind).toBe('enum')
    expect(get(symbols, 'session.Session.name').kind).toBe('method')
    expect(misplacedOverloads(symbols)).toEqual([])
  })

  it.each([
    ['impl blocks sort after the declaration', 'a_declaration.rs', 'b_impls.rs'],
    ['impl blocks sort before the declaration', 'b_declaration.rs', 'a_impls.rs'],
  ])('keeps a type whose impl blocks live in another file without an overload when %s', async (_, declaration, impls) => {
    const symbols = await project('rs', {
      [declaration]: '/// A tmux session.\npub struct Session { pub id: u32 }\n',
      [impls]: 'impl Session { pub fn name(&self) -> String { todo!() } }\nimpl Clone for Session { fn clone(&self) -> Self { todo!() } }\n',
    })
    expect(symbols.filter((symbol) => symbol.name === 'Session')).toHaveLength(1)
    expect(symbols.some((symbol) => symbol.name === 'name' && symbol.kind === 'method')).toBe(true)
    expect(misplacedOverloads(symbols)).toEqual([])
  })
})

describe('TypeScript declaration merging', () => {
  it('keeps a class and the interface that merges into it without an overload', async () => {
    const symbols = await oneFile(TYPESCRIPT, 'client.ts', 'client', `
/** A tmux client. */
export class Client { run(): void {} }
export interface Client extends AliasedFields<ClientRow> {}
`)
    expect(get(symbols, 'client.Client')).toMatchObject({ kind: 'class', doc: { summary: 'A tmux client.' } })
    expect(misplacedOverloads(symbols)).toEqual([])
  })

  it('keeps a static and an instance property of one name without an overload', async () => {
    const symbols = await oneFile(TYPESCRIPT, 'errors.ts', 'errors', `
export class LibTmuxError extends Error {
  static readonly code: string = "LibTmuxError";
  readonly code: string;
}
`)
    expect(get(symbols, 'errors.LibTmuxError.code').kind).toBe('attribute')
    expect(misplacedOverloads(symbols)).toEqual([])
  })

  it('keeps the overload on a function and a method declared with several signatures', async () => {
    const symbols = await oneFile(TYPESCRIPT, 'panes.ts', 'panes', `
export function pick(key: string): string;
export function pick(key: number): number;
export function pick(key: string | number): string | number { return key; }
export class Pane {
  send(keys: string): void;
  send(count: number): void;
  send(what: string | number): void {}
}
`)
    for (const id of ['panes.pick', 'panes.Pane.send']) {
      expect(get(symbols, id).signatures.length, id).toBeGreaterThan(1)
      expect(get(symbols, id).modifiers, id).toContain('overload')
    }
    expect(get(symbols, 'panes.Pane').modifiers).not.toContain('overload')
  })
})

describe('C# types that share a name', () => {
  it('keeps a type and its generic arity variant in one file without an overload', async () => {
    const symbols = await oneFile(CSHARP, 'WorkspaceAction.cs', 'LibTmux', `namespace LibTmux;
/// <summary>An action.</summary>
public class WorkspaceAction { }
public sealed class WorkspaceAction<TRequest> : WorkspaceAction where TRequest : notnull { }
`)
    expect(get(symbols, 'LibTmux.WorkspaceAction')).toMatchObject({ kind: 'class', doc: { summary: 'An action.' } })
    expect(misplacedOverloads(symbols)).toEqual([])
  })

  it('keeps records that share a name across files without an overload, and both constructors', async () => {
    const symbols = await project('csharp', {
      'Result.cs': 'namespace LibTmux;\npublic record Result(int Code);\n',
      'ResultOfT.cs': 'namespace LibTmux;\npublic record Result<T>(T Value);\n',
    })
    const result = get(symbols, 'LibTmux.Result')
    expect(result.kind).toBe('class')
    expect(result.signatures.map((signature) => signature.params.map((param) => param.type))).toEqual([['int'], ['T']])
    expect(misplacedOverloads(symbols)).toEqual([])
  })

  it('keeps the overload on a method declared in two parts of a partial class', async () => {
    const symbols = await project('csharp', {
      'Pane.cs': 'namespace LibTmux;\npublic partial class Pane { public void Send(string keys) { } }\n',
      'Pane.Keys.cs': 'namespace LibTmux;\npublic partial class Pane { public void Send(int count) { } }\n',
    })
    expect(get(symbols, 'LibTmux.Pane.Send')).toMatchObject({ kind: 'method', modifiers: ['overload'] })
    expect(get(symbols, 'LibTmux.Pane.Send').signatures).toHaveLength(2)
    expect(get(symbols, 'LibTmux.Pane').modifiers).not.toContain('overload')
  })
})

describe('Java members that share a name', () => {
  it('keeps a field and the accessor named after it without an overload', async () => {
    const symbols = await oneFile(JAVA, 'FakeWindow.java', 'FakeWindow', `package io.github.libtmux.junit5;
final class FakeWindow {
    boolean active;
    FakePane active() { return null; }
}
`)
    expect(symbols.filter((symbol) => symbol.name === 'active').map((symbol) => symbol.kind)).toEqual(['attribute'])
    expect(misplacedOverloads(symbols)).toEqual([])
  })

  it('keeps the overload on methods declared with several signatures', async () => {
    const symbols = await oneFile(JAVA, 'Pane.java', 'Pane', `package io.github.libtmux;
public final class Pane {
    public void send(String keys) { }
    public void send(int count) { }
    public void close() { }
}
`)
    expect(get(symbols, 'Pane.Pane.send')).toMatchObject({ kind: 'method', modifiers: ['overload'] })
    expect(get(symbols, 'Pane.Pane.close').modifiers).toEqual([])
    expect(get(symbols, 'Pane.Pane').modifiers).not.toContain('overload')
  })
})

describe('Kotlin declarations merged across source sets', () => {
  it('keeps an expect class and its actual without an overload, and a real overload set with one', async () => {
    const root = tree({
      'Common.kt': 'package example\nexpect class Platform { fun name(): String }\n',
      'Jvm.kt': 'package example\nactual class Platform { actual fun name(): String = "jvm" }\n',
      'Pane.kt': 'package example\nclass Pane {\n  fun send(keys: String) {}\n  fun send(count: Int) {}\n  fun close() {}\n}\n',
    })
    const { symbols } = await extractJvm('kotlin', [root])
    expect(get(symbols, 'example.Platform').modifiers).not.toContain('overload')
    expect(get(symbols, 'example.Pane.send')).toMatchObject({ kind: 'method', modifiers: ['overload'] })
    expect(get(symbols, 'example.Pane.close').modifiers).toEqual([])
  })
})

describe('C++ names shared by a type and a function', () => {
  it('keeps a struct and a same-named function without an overload, and real overloads with one', () => {
    const xml = tree({
      'a_struct.xml': `<doxygen><compounddef kind="struct"><compoundname>sample::Result</compoundname>
        <location file="result.hpp" line="1"/></compounddef></doxygen>`,
      'b_namespace.xml': `<doxygen><compounddef kind="namespace"><compoundname>sample</compoundname><sectiondef>
        <memberdef kind="function" prot="public"><type>Result</type><definition>Result sample::Result</definition><qualifiedname>sample::Result</qualifiedname><name>Result</name><argsstring>(int code)</argsstring><param><type>int</type><declname>code</declname></param></memberdef>
        <memberdef kind="function" prot="public"><type>Result</type><definition>Result sample::Result</definition><qualifiedname>sample::Result</qualifiedname><name>Result</name><argsstring>(bool ok)</argsstring><param><type>bool</type><declname>ok</declname></param></memberdef>
        <memberdef kind="function" prot="public"><type>void</type><definition>void sample::run</definition><qualifiedname>sample::run</qualifiedname><name>run</name><argsstring>(int count)</argsstring><param><type>int</type><declname>count</declname></param></memberdef>
        <memberdef kind="function" prot="public"><type>void</type><definition>void sample::run</definition><qualifiedname>sample::run</qualifiedname><name>run</name><argsstring>(bool now)</argsstring><param><type>bool</type><declname>now</declname></param></memberdef>
        </sectiondef></compounddef></doxygen>`,
    })
    const symbols = extractDoxygen(xml)
    expect(get(symbols, 'sample::Result').kind).toBe('struct')
    expect(get(symbols, 'sample::run')).toMatchObject({ kind: 'function', modifiers: ['overload'] })
    expect(misplacedOverloads(symbols)).toEqual([])
  })
})

describe('Swift names shared by a type and a function', () => {
  it('keeps a struct and its same-named functions without an overload, and real overloads with one', () => {
    const fn = (precise: string, title: string, parameter: string) => ({
      identifier: { precise }, kind: { identifier: 'swift.func' }, pathComponents: [title], accessLevel: 'public',
      names: { title },
      functionSignature: { parameters: [{ name: 'value', declarationFragments: [{ kind: 'typeIdentifier', spelling: parameter }] }], returns: [] },
    })
    const root = tree({
      'Thing.symbols.json': JSON.stringify({
        symbols: [
          { identifier: { precise: 'thing' }, kind: { identifier: 'swift.struct' }, pathComponents: ['Thing'], accessLevel: 'public', names: { title: 'Thing' } },
          fn('thing-int', 'Thing', 'Int'), fn('thing-string', 'Thing', 'String'),
          fn('run-int', 'run', 'Int'), fn('run-string', 'run', 'String'),
        ],
        relationships: [],
      }),
    })
    const symbols = extractSymbolGraph([join(root, 'Thing.symbols.json')])
    expect(get(symbols, 'Thing').kind).toBe('struct')
    expect(get(symbols, 'run')).toMatchObject({ kind: 'function', modifiers: ['overload'] })
    expect(misplacedOverloads(symbols)).toEqual([])
  })
})

describe('the committed models', () => {
  const ports = [
    'py', 'ruby', 'lua', 'ts', 'rs', 'go', 'java', 'csharp', 'cxx', 'swift',
    'kotlin', 'scala', 'fsharp', 'powershell', 'julia',
  ] as const
  const models = ports.flatMap((port) => {
    const path = join(DATA, `${port}.json`)
    return existsSync(path) ? [[port, JSON.parse(readFileSync(path, 'utf8')) as ApiModel] as const] : []
  })

  it.each(models)('%s marks no type, field or lone signature as an overload', (_, model) => {
    expect(misplacedOverloads(model.symbols).map((symbol) => `${symbol.kind} ${symbol.id}`)).toEqual([])
  })

  it.each(['ts', 'java', 'csharp', 'cxx', 'swift', 'kotlin', 'scala'] as const)(
    '%s still marks its real overload sets',
    (port) => {
      const model = models.find(([name]) => name === port)?.[1]
      const marked = model?.symbols.filter((symbol) => symbol.modifiers.includes('overload')) ?? []
      expect(marked.length).toBeGreaterThan(0)
      expect(marked.every((symbol) => canOverload(symbol))).toBe(true)
    },
  )
})
