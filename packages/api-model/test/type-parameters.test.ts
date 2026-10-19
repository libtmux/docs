import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { tokenizeDoc } from '../src/doc/roles.ts'
import { extractDoxygen } from '../src/languages/doxygen.ts'
import { extractJvm } from '../src/languages/jvm.ts'
import { extractPython } from '../src/languages/python.ts'
import { extractWithSpec } from '../src/languages/spec.ts'
import { CSHARP, GO, JAVA, RUST, TYPESCRIPT } from '../src/languages/specs.ts'
import { extractSymbolGraph } from '../src/languages/symbolgraph.ts'
import { SymbolIndex } from '../src/link.ts'
import type { ApiSymbol, Signature, SymbolKind } from '../src/model.ts'
import { parseTypeParameter, parseTypeParameters, typeParameterList, typeParametersOf } from '../src/type-params.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'type-parameters-'))
  dirs.push(dir)
  return dir
}

async function extractSpec(spec: Parameters<typeof extractWithSpec>[0], file: string, source: string, module = 'example') {
  const path = join(scratch(), file)
  writeFileSync(path, source)
  return extractWithSpec(spec, path, module)
}

/** A same-named global that a bound type parameter must never link to. */
const decoy = (id: string, kind: SymbolKind = 'class'): ApiSymbol => ({
  id, publicId: id, name: id.split(/[.:]+/).at(-1)!, kind, modifiers: [], signatures: [], source: { file: 'decoy' },
})
const indexOf = (symbols: ApiSymbol[], lang: string) => new SymbolIndex(symbols, (entry) => `/${entry.id}/`, lang)
const find = (symbols: ApiSymbol[], id: string) => symbols.find((entry) => entry.id === id)!
const hrefs = (parts: ReturnType<SymbolIndex['linkType']>, name: string) =>
  parts.filter((part) => part.text === name).map((part) => part.link?.href)
const anchor = (owner: string, name: string) => `/${owner}/#${encodeURIComponent(`${owner}.type-parameter.${name}`)}`

describe('type parameter declarations, read apart', () => {
  it.each([
    ['ts', 'const in out Model extends Foo<A, B> = Bar', [{ name: 'Model', modifier: 'const in out', bound: 'Foo<A, B>', default: 'Bar' }]],
    ['ts', '$Pane extends Model', [{ name: '$Pane', bound: 'Model' }]],
    ['rs', "'a: 'b + 'c", [{ name: "'a", kind: 'lifetime', bound: "'b + 'c" }]],
    ['rs', 'T: Iterator<Item = u8> + Send = Vec<u8>', [{ name: 'T', bound: 'Iterator<Item = u8> + Send', default: 'Vec<u8>' }]],
    ['rs', 'const N: usize = 3', [{ name: 'N', modifier: 'const', kind: 'const', bound: 'usize', default: '3' }]],
    ['go', 'K, V comparable', [{ name: 'K', bound: 'comparable' }, { name: 'V', bound: 'comparable' }]],
    ['go', 'T interface{ ~string | ~[]byte }', [{ name: 'T', bound: 'interface{ ~string | ~[]byte }' }]],
    ['java', '@Mark T extends Bound & Comparable<T>', [{ name: 'T', bound: 'Bound & Comparable<T>' }]],
    ['csharp', 'out T', [{ name: 'T', modifier: 'out' }]],
    ['kotlin', 'reified T : Comparable<T>', [{ name: 'T', modifier: 'reified', bound: 'Comparable<T>' }]],
    ['scala', '+A <: Other', [{ name: 'A', modifier: '+', bound: 'Other' }]],
    ['scala', 'F[_]', [{ name: 'F' }]],
    ['swift', 'each T', [{ name: 'T', modifier: 'each' }]],
    ['cxx', 'typename... Ts', [{ name: 'Ts', modifier: '...' }]],
    ['cxx', 'std::integral Integer', [{ name: 'Integer', bound: 'std::integral' }]],
    ['cxx', 'std::size_t N = 3', [{ name: 'N', kind: 'const', bound: 'std::size_t', default: '3' }]],
    ['julia', 'I<:LibTmux.EntityID', [{ name: 'I', bound: 'LibTmux.EntityID' }]],
    ['julia', ':session', []],
    ['julia', 'LibTmux.BufferID', []],
    ['ruby', 'unchecked out T < Foo = Bar', [{ name: 'T', modifier: 'out', bound: 'Foo', default: 'Bar' }]],
    ['py', 'T: int = str', [{ name: 'T', bound: 'int', default: 'str' }]],
    ['py', '**P', [{ name: 'P', modifier: '**' }]],
  ])('reads %s `%s`', (lang, text, expected) => {
    expect(parseTypeParameter(lang, text)).toEqual(expected)
  })

  it('keeps one entry per name and the brackets of the language', () => {
    expect(parseTypeParameters('ts', ['T', 'T extends X', 'U'])).toEqual([{ name: 'T' }, { name: 'U' }])
    const list = parseTypeParameters('go', ['K comparable', 'V any'])
    expect(typeParameterList('go', list)).toBe('[K, V]')
    expect(typeParameterList('julia', list)).toBe('{K, V}')
    expect(typeParameterList('ts', list)).toBe('<K, V>')
  })

  it('derives the list from older models that stored only the text or only the names', () => {
    expect(typeParametersOf({ typeParams: ['Narrowed extends Model'] }, 'ts')).toEqual([{ name: 'Narrowed', bound: 'Model' }])
    expect(typeParametersOf({ typeParamNames: ['T', 'R'] }, 'java')).toEqual([{ name: 'T' }, { name: 'R' }])
    expect(typeParametersOf({ typeParams: ['I<:Id'], kind: 'typealias' }, 'julia')).toEqual([])
    const stored = [{ name: 'Model', doc: 'The element type.' }]
    expect(typeParametersOf({ typeParameters: stored, typeParams: ['Other'] }, 'ts')).toBe(stored)
  })
})

describe('TypeScript', () => {
  const source = `/**
 * An immutable set.
 *
 * @typeParam Model - The element type. Each member is a handle.
 */
export interface Selection<const Model extends Handle = Pane> extends Iterable<Model> {
  /** Keep the members matching declarative criteria. */
  where(criteria: WhereOf<Model>): Selection<Model>;
  /**
   * Narrow by predicate.
   *
   * @typeParam Narrowed - What the predicate proves.
   */
  filter<Narrowed extends Model>(predicate: (member: Model) => member is Narrowed): Selection<Narrowed>;
  readonly first: Model | undefined;
  /** Keeps the \`Model\` members it was given. */
  static pick(): void;
}
export type WhereOf<Model> = WhereForKind<ModelKindOf<Model>>;
`
  const extract = () => extractSpec(TYPESCRIPT, 'selection.ts', source, 'selection')

  it('records interface and alias parameters with bounds, defaults and TSDoc', async () => {
    const symbols = await extract()
    expect(find(symbols, 'selection.Selection').typeParameters).toEqual([
      { name: 'Model', modifier: 'const', bound: 'Handle', default: 'Pane', doc: 'The element type. Each member is a handle.' },
    ])
    expect(find(symbols, 'selection.WhereOf').typeParameters).toEqual([{ name: 'Model' }])
    expect(find(symbols, 'selection.Selection.filter').signatures[0].typeParameters).toEqual([
      { name: 'Narrowed', bound: 'Model', doc: 'What the predicate proves.' },
    ])
  })

  it('links Model in Selection.where to the interface, not to a global Model', async () => {
    const symbols = [...await extract(), decoy('types.Model'), decoy('types.Narrowed')]
    const index = indexOf(symbols, 'ts')
    const where = find(symbols, 'selection.Selection.where')
    const text = 'where(criteria: WhereOf<Model>): Selection<Model>'
    const parts = index.linkType(text, where, where.signatures[0])
    expect(parts.map((part) => part.text).join('')).toBe(text)
    expect(hrefs(parts, 'Model')).toEqual([anchor('selection.Selection', 'Model'), anchor('selection.Selection', 'Model')])
    expect(parts.filter((part) => part.text === 'Model').every((part) => part.link?.typeParameter?.owner.id === 'selection.Selection')).toBe(true)
    expect(hrefs(parts, 'WhereOf')).toEqual(['/selection.WhereOf/'])
    // The link is a type parameter, so it never claims the declaring type is what the name refers to.
    expect(parts.find((part) => part.text === 'Model')?.link?.symbol).toBeUndefined()
  })

  it('links a callable parameter on its own page and the enclosing one on the owner page', async () => {
    const symbols = [...await extract(), decoy('types.Model')]
    const index = indexOf(symbols, 'ts')
    const filter = find(symbols, 'selection.Selection.filter')
    const parts = index.linkType('filter<Narrowed extends Model>(predicate: (member: Model) => member is Narrowed): Selection<Narrowed>', filter, filter.signatures[0])
    expect(hrefs(parts, 'Narrowed')).toEqual(Array(3).fill(anchor('selection.Selection.filter', 'Narrowed')))
    expect(hrefs(parts, 'Model')).toEqual([anchor('selection.Selection', 'Model'), anchor('selection.Selection', 'Model')])
  })

  it('links code literals in prose to the same anchor', async () => {
    const symbols = [...await extract(), decoy('types.Model')]
    const index = indexOf(symbols, 'ts')
    const where = find(symbols, 'selection.Selection.where')
    expect(index.resolve('Model', 'any', where)?.href).toBe(anchor('selection.Selection', 'Model'))
    const [span] = index.linkText('`Model`', where)
    expect(span).toMatchObject({ kind: 'ref', link: { href: anchor('selection.Selection', 'Model') } })
    // Outside the declaration's scope the name is an ordinary reference again.
    expect(index.resolve('Model', 'any', find(symbols, 'selection.WhereOf'))?.href).toBe(anchor('selection.WhereOf', 'Model'))
    expect(index.resolve('Model', 'any')?.href).toBe('/types.Model/')
  })

  it('lists the enclosing parameters a member uses, including those of its property type', async () => {
    const symbols = await extract()
    const index = indexOf(symbols, 'ts')
    const used = (id: string) => index.inheritedTypeParameters(find(symbols, id)).map((entry) => [entry.owner.id, entry.parameter.name, entry.href])
    expect(used('selection.Selection.where')).toEqual([['selection.Selection', 'Model', anchor('selection.Selection', 'Model')]])
    expect(used('selection.Selection.first')).toEqual([['selection.Selection', 'Model', anchor('selection.Selection', 'Model')]])
    expect(used('selection.Selection')).toEqual([])
  })
})

describe('Rust', () => {
  const source = `pub struct Slot<T: Clone, V = Vec<u8>> where T: Send { pub value: T }
pub trait Matcher<'a, T> { fn matches(&self, value: &'a T) -> bool; }
pub type Alias<T> = Vec<T>;
impl<U: Clone> Slot<U, Vec<u8>> {
    /// Read it.
    pub fn get(&self) -> U { self.value.clone() }
    pub fn convert<F: Fn(U) -> U>(&self, f: F) -> F::Output where F: Sized {}
}
impl<T> From<T> for Slot<String, Vec<u8>> {
    pub fn from_t(value: T) -> Self {}
}
pub struct T;
`
  const extract = () => extractSpec(RUST, 'query.rs', source, 'query')

  it('records struct, trait and alias parameters with where-clause bounds and defaults', async () => {
    const symbols = await extract()
    expect(find(symbols, 'query.Slot').typeParameters).toEqual([{ name: 'T', bound: 'Clone + Send' }, { name: 'V', default: 'Vec<u8>' }])
    expect(find(symbols, 'query.Matcher').typeParameters).toEqual([{ name: "'a", kind: 'lifetime' }, { name: 'T' }])
    expect(find(symbols, 'query.Alias').typeParameters).toEqual([{ name: 'T' }])
    expect(find(symbols, 'query.Slot.convert').signatures[0].typeParameters).toEqual([{ name: 'F', bound: 'Fn(U) -> U + Sized' }])
  })

  it('binds an impl by its self type, so a renamed parameter links and an unrelated one does not', async () => {
    const symbols = await extract()
    const index = indexOf(symbols, 'rs')
    const get = find(symbols, 'query.Slot.get')
    // `U` is the impl's spelling of the struct's `T`, which is not the unit struct `T`.
    expect(hrefs(index.linkType('pub fn get(&self) -> U', get, get.signatures[0]), 'U')).toEqual([anchor('query.Slot', 'T')])
    expect(index.linkType('T', get, get.signatures[0])[0].link?.symbol?.id).toBe('query.T')
    const fromT = find(symbols, 'query.Slot.from_t')
    // The impl introduces its own `T`; the struct's `T` does not stand in for it.
    const unrelated = index.linkType('value: T', fromT, fromT.signatures[0]).find((part) => part.text === 'T')!
    expect(unrelated.declaration).toBe(true)
    expect(unrelated.link).toBeUndefined()
  })

  it('links an associated type through its parameter', async () => {
    const symbols = await extract()
    const index = indexOf(symbols, 'rs')
    const convert = find(symbols, 'query.Slot.convert')
    const parts = index.linkType('F::Output', convert, convert.signatures[0])
    expect(parts.map((part) => part.text)).toEqual(['F', '::Output'])
    expect(parts[0].link?.href).toBe(anchor('query.Slot.convert', 'F'))
  })

  it('links a field type to its struct parameter instead of the unit struct of the same name', async () => {
    const symbols = await extract()
    const index = indexOf(symbols, 'rs')
    const value = find(symbols, 'query.Slot.value')
    expect(hrefs(index.linkType(value.type!, value), 'T')).toEqual([anchor('query.Slot', 'T')])
  })
})

describe('Go', () => {
  const source = `package tmux
// Set holds comparable values.
type Set[K comparable, V, W any] struct{ m map[K]V }
// Add inserts one value.
func (s *Set[A, B, C]) Add(v A, w C) {}
func Ptr[T any](v T) *T { return &v }
type T struct{}
`
  const extract = () => extractSpec(GO, 'set.go', source, 'tmux')

  it('records one parameter per name with its constraint', async () => {
    const symbols = await extract()
    expect(find(symbols, 'tmux.Set').typeParameters).toEqual([
      { name: 'K', bound: 'comparable' }, { name: 'V', bound: 'any' }, { name: 'W', bound: 'any' },
    ])
    expect(find(symbols, 'tmux.Ptr').signatures[0].typeParameters).toEqual([{ name: 'T', bound: 'any' }])
  })

  it('binds a receiver by position to the type it names', async () => {
    const symbols = await extract()
    const index = indexOf(symbols, 'go')
    const add = find(symbols, 'tmux.Set.Add')
    expect(hrefs(index.linkType('func (s *Set[A, B, C]) Add(v A, w C)', add, add.signatures[0]), 'A')).toEqual([anchor('tmux.Set', 'K'), anchor('tmux.Set', 'K')])
    expect(hrefs(index.linkType('w C', add, add.signatures[0]), 'C')).toEqual([anchor('tmux.Set', 'W')])
    const ptr = find(symbols, 'tmux.Ptr')
    expect(hrefs(index.linkType('func Ptr[T any](v T) *T', ptr, ptr.signatures[0]), 'T')).toEqual(Array(3).fill(anchor('tmux.Ptr', 'T')))
  })
})

describe('Java', () => {
  const source = `package example;
/**
 * A box.
 *
 * @param <T> the content type
 * @param <R> the result type
 */
public class Box<@Mark T extends Bound & Comparable<T>, R> {
  /** Maps it. @param <U> the mapped type */
  public <U> U map(T value) { return null; }
  public static <T> T rebound(T value) { return value; }
  public static Bound unbound(T value) { return null; }
}
public class T {}
public class Bound {}
`
  const extract = () => extractSpec(JAVA, 'Box.java', source)

  it('reads bounds and the Javadoc parameter tags', async () => {
    const symbols = await extract()
    expect(find(symbols, 'example.Box').typeParameters).toEqual([
      { name: 'T', bound: 'Bound & Comparable<T>', doc: 'the content type' },
      { name: 'R', doc: 'the result type' },
    ])
  })

  it('links the class variable in a member and keeps a static member out of its scope', async () => {
    const symbols = await extract()
    const index = indexOf(symbols, 'java')
    const map = find(symbols, 'example.Box.map')
    expect(hrefs(index.linkType('T', map, map.signatures[0]), 'T')).toEqual([anchor('example.Box', 'T')])
    const rebound = find(symbols, 'example.Box.rebound')
    expect(hrefs(index.linkType('T', rebound, rebound.signatures[0]), 'T')).toEqual([anchor('example.Box.rebound', 'T')])
    const unbound = find(symbols, 'example.Box.unbound')
    expect(index.linkType('T', unbound, unbound.signatures[0])[0].link?.symbol?.id).toBe('example.T')
  })

  it('links {@link T} in prose to the variable', async () => {
    const symbols = await extract()
    const index = indexOf(symbols, 'java')
    const map = find(symbols, 'example.Box.map')
    const [, span] = index.linkText('See {@link T}.', map)
    expect(span).toMatchObject({ kind: 'ref', link: { href: anchor('example.Box', 'T') } })
  })
})

describe('C#', () => {
  const source = `namespace Example;
/// <summary>A handle.</summary>
/// <typeparam name="T">The kind of object it points at.</typeparam>
/// <typeparam name="U">Unused.</typeparam>
public class Handle<in T, out U> where T : class, new() where U : IDisposable
{
    /// <summary>Gets <typeparamref name="T"/> and <typeparamref name="Missing"/>.</summary>
    /// <typeparam name="V">The projection.</typeparam>
    public T Get<V>(V value) where V : struct { return default; }
}
public class T {}
`
  const extract = () => extractSpec(CSHARP, 'Handle.cs', source, 'Example')

  it('merges where-clause constraints and the typeparam tags', async () => {
    const symbols = await extract()
    expect(find(symbols, 'Example.Handle').typeParameters).toEqual([
      { name: 'T', modifier: 'in', bound: 'class, new()', doc: 'The kind of object it points at.' },
      { name: 'U', modifier: 'out', bound: 'IDisposable', doc: 'Unused.' },
    ])
    expect(find(symbols, 'Example.Handle.Get').signatures[0].typeParameters).toEqual([{ name: 'V', bound: 'struct', doc: 'The projection.' }])
  })

  it('does not read the arguments of a base type as the type\'s own parameters', async () => {
    // The grammar recovers from `record struct X : IParsable<X>` by reading `<X>` as a parameter list.
    const symbols = await extractSpec(CSHARP, 'PaneId.cs', `namespace Example;
public readonly record struct PaneId : IComparable<PaneId>, IParsable<PaneId>
{
    public static PaneId Parse(string text) => default;
}
public class Box<T> : Base<T> { }
`, 'Example')
    expect(find(symbols, 'Example.PaneId').typeParameters).toBeUndefined()
    expect(find(symbols, 'Example.PaneId').typeParams).toBeUndefined()
    expect(find(symbols, 'Example.Box').typeParameters).toEqual([{ name: 'T' }])
    const index = indexOf(symbols, 'csharp')
    const parse = find(symbols, 'Example.PaneId.Parse')
    expect(index.linkType('PaneId Parse(string text)', parse, parse.signatures[0]).find((part) => part.text === 'PaneId')?.link?.symbol?.id).toBe('Example.PaneId')
  })

  it('reads typeparamref as a type-parameter reference that never falls back to a global', async () => {
    const symbols = await extract()
    const get = find(symbols, 'Example.Handle.Get')
    const tokens = tokenizeDoc(get.doc!.summary, 'csharp')
    expect(tokens.filter((span) => span.kind === 'ref').map((span) => span.kind === 'ref' && [span.role, span.target])).toEqual([['typeparam', 'T'], ['typeparam', 'Missing']])
    const index = indexOf([...symbols, decoy('Example.Missing')], 'csharp')
    const linked = index.linkText(get.doc!.summary, get)
    expect(linked.find((span) => span.kind === 'ref')).toMatchObject({ link: { href: anchor('Example.Handle', 'T') } })
    expect(linked.filter((span) => span.kind === 'code')).toEqual([{ kind: 'code', text: 'Missing' }])
    expect(hrefs(index.linkType('T Get<V>(V value)', get, get.signatures[0]), 'T')).toEqual([anchor('Example.Handle', 'T')])
  })
})

describe('Kotlin and Scala', () => {
  it('reads Scala bounds, variance and Scaladoc tags and links the class parameter in a member', async () => {
    const root = scratch()
    writeFileSync(join(root, 'Box.scala'), `package example
/** A box.
 * @tparam F the effect
 * @tparam A the content
 */
class Box[F[_], +A <: Other, C : Ordering](val value: A) {
  def read: F[A] = TODO
}
class A
`)
    const { symbols } = await extractJvm('scala', [root])
    expect(find(symbols, 'example.Box').signatures[0].typeParameters).toEqual([
      { name: 'F', doc: 'the effect' }, { name: 'A', modifier: '+', bound: 'Other', doc: 'the content' }, { name: 'C', bound: ': Ordering' },
    ])
    const index = indexOf(symbols, 'scala')
    const read = find(symbols, 'example.Box.read')
    expect(hrefs(index.linkType('def read: F[A]', read, read.signatures[0]), 'A')).toEqual([anchor('example.Box', 'A')])
  })

  it('reads Kotlin variance, reification and where-clause bounds', async () => {
    const root = scratch()
    writeFileSync(join(root, 'Box.kt'), `package example
/** A box.
 * @param T the content
 * @param value the value
 */
class Box<in T : Comparable<T>, out R, reified Q>(val value: T) where R : Any, R : Foo {
  fun <U : Any> get(x: U): U where U : Foo = x
}
`)
    const { symbols } = await extractJvm('kotlin', [root])
    expect(find(symbols, 'example.Box').signatures[0].typeParameters).toEqual([
      { name: 'T', modifier: 'in', bound: 'Comparable<T>', doc: 'the content' },
      { name: 'R', modifier: 'out', bound: 'Any, Foo' },
      { name: 'Q', modifier: 'reified' },
    ])
    expect(find(symbols, 'example.Box.get').signatures[0].typeParameters).toEqual([{ name: 'U', bound: 'Any, Foo' }])
  })
})

describe('Python', () => {
  const source = `import typing as t
T = t.TypeVar("T", bound="Foo", covariant=True)
U = t.TypeVar("U", int, str)
P = t.ParamSpec("P")

class QueryList(list[T], t.Generic[T, U]):
    def filter(self, matcher: T) -> QueryList[T]: ...

class Plain(list[T]):
    def get(self) -> T | None: ...

class New[A: int = str, *Ts](Base):
    def m[X](self, x: X) -> X: ...

def free(items: list[T], fn: t.Callable[P, T]) -> T: ...
`
  const extract = async () => {
    const path = join(scratch(), 'ql.py')
    writeFileSync(path, source)
    return extractPython(path, 'ql')
  }

  it('reads Generic bases, PEP 695 lists and the bounds of module TypeVars', async () => {
    const symbols = await extract()
    expect(find(symbols, 'ql.QueryList').typeParameters).toEqual([{ name: 'T', bound: 'Foo' }, { name: 'U', bound: 'int | str' }])
    expect(find(symbols, 'ql.Plain').typeParameters).toEqual([{ name: 'T', bound: 'Foo' }])
    expect(find(symbols, 'ql.New').typeParameters).toEqual([{ name: 'A', bound: 'int', default: 'str' }, { name: 'Ts', modifier: '*' }])
    expect(find(symbols, 'ql.New.m').signatures[0].typeParameters).toEqual([{ name: 'X' }])
  })

  it('binds a variable the class does not own to the function that mentions it', async () => {
    const symbols = await extract()
    expect(find(symbols, 'ql.free').signatures[0].typeParameters).toEqual([{ name: 'T', bound: 'Foo' }, { name: 'P', modifier: '**' }])
    expect(find(symbols, 'ql.QueryList.filter').signatures[0].typeParameters).toBeUndefined()
  })

  it('links the class variable to the class, not to the module TypeVar constant', async () => {
    const symbols = await extract()
    const index = indexOf(symbols, 'py')
    const filter = find(symbols, 'ql.QueryList.filter')
    expect(find(symbols, 'ql.T').kind).toBe('constant')
    const parts = index.linkType('QueryList[T]', filter, filter.signatures[0])
    expect(hrefs(parts, 'T')).toEqual([anchor('ql.QueryList', 'T')])
    expect(index.resolve('T', 'any', filter)?.href).toBe(anchor('ql.QueryList', 'T'))
    expect(index.resolve('T', 'any')?.href).toBe('/ql.T/')
  })
})

describe('C++', () => {
  const xml = `<doxygen><compounddef kind="class"><compoundname>sample::Box</compoundname>
<templateparamlist><param><type>typename</type><declname>T</declname></param><param><type>std::size_t</type><declname>N</declname><defval>3</defval></param><param><type>ReferenceRange</type><declname>Range</declname></param></templateparamlist>
<sectiondef>
<memberdef kind="function" prot="public"><templateparamlist><param><type>typename</type><declname>U</declname></param></templateparamlist><type>T</type><definition>T sample::Box::get</definition><qualifiedname>sample::Box::get</qualifiedname><name>get</name><argsstring>(U x)</argsstring><param><type>U</type><declname>x</declname></param>
<detaileddescription><para>Gets.<parameterlist kind="templateparam"><parameteritem><parameternamelist><parametername>U</parametername></parameternamelist><parameterdescription><para>the projection</para></parameterdescription></parameteritem></parameterlist></para></detaileddescription></memberdef>
</sectiondef>
<briefdescription><para>A box.</para></briefdescription>
<detaileddescription><para>Boxes.<parameterlist kind="templateparam"><parameteritem><parameternamelist><parametername>T</parametername></parameternamelist><parameterdescription><para>the content</para></parameterdescription></parameteritem></parameterlist></para></detaileddescription>
<location file="box.hpp" line="1"/></compounddef></doxygen>`
  const extract = () => {
    const dir = scratch()
    writeFileSync(join(dir, 'class.xml'), xml)
    return extractDoxygen(dir)
  }

  it('reads class and member template lists, concepts, non-type parameters and \\tparam', () => {
    const symbols = extract()
    expect(find(symbols, 'sample::Box').typeParameters).toEqual([
      { name: 'T', doc: 'the content' }, { name: 'N', kind: 'const', bound: 'std::size_t', default: '3' }, { name: 'Range', bound: 'ReferenceRange' },
    ])
    expect(find(symbols, 'sample::Box::get').signatures[0].typeParameters).toEqual([{ name: 'U', doc: 'the projection' }])
  })

  it('links the class parameter in a member signature', () => {
    const symbols = [...extract(), decoy('sample::T')]
    const index = indexOf(symbols, 'cxx')
    const get = find(symbols, 'sample::Box::get')
    const parts = index.linkType('template <typename U>\nT get(U x)', get, get.signatures[0])
    expect(hrefs(parts, 'T')).toEqual([anchor('sample::Box', 'T')])
    expect(hrefs(parts, 'U')).toEqual([anchor('sample::Box::get', 'U'), anchor('sample::Box::get', 'U')])
  })
})

describe('Swift', () => {
  const graph = (symbols: unknown[]) => {
    const dir = scratch()
    const file = join(dir, 'Probe.symbols.json')
    writeFileSync(file, JSON.stringify({ module: { name: 'Probe' }, symbols }))
    return [file]
  }
  const fragments = (...parts: [string, string][]) => parts.map(([kind, spelling]) => ({ kind, spelling }))
  const symbols = () => extractSymbolGraph(graph([
    {
      identifier: { precise: 's:5Probe3BoxV' }, kind: { identifier: 'swift.struct' }, pathComponents: ['Box'], names: { title: 'Box' }, accessLevel: 'public',
      declarationFragments: fragments(['keyword', 'struct'], ['identifier', 'Box'], ['text', '<'], ['genericParameter', 'T'], ['text', ', '], ['genericParameter', 'U'], ['text', '>']),
      swiftGenerics: { parameters: [{ name: 'T', index: 0, depth: 0 }, { name: 'U', index: 1, depth: 0 }],
        constraints: [{ kind: 'conformance', lhs: 'T', rhs: 'Hashable' }, { kind: 'conformance', lhs: 'U', rhs: 'Marker' }, { kind: 'sameType', lhs: 'U', rhs: 'Int' }] },
    },
    {
      identifier: { precise: 's:5Probe3BoxV3getyxqd__lF' }, kind: { identifier: 'swift.method' }, pathComponents: ['Box', 'get(_:)'], names: { title: 'get(_:)' }, accessLevel: 'public',
      functionSignature: { parameters: [{ name: '_', declarationFragments: fragments(['internalParam', 'value'], ['text', ': '], ['typeIdentifier', 'V']) }], returns: fragments(['typeIdentifier', 'T']) },
      declarationFragments: fragments(['keyword', 'func'], ['identifier', 'get'], ['text', '<'], ['genericParameter', 'V'], ['text', '>(']),
      swiftGenerics: { parameters: [{ name: 'T', index: 0, depth: 0 }, { name: 'U', index: 1, depth: 0 }, { name: 'V', index: 0, depth: 1 }],
        constraints: [{ kind: 'conformance', lhs: 'V', rhs: 'Marker' }, { kind: 'conformance', lhs: 'V', rhs: 'Hashable' }] },
    },
  ]))

  it('names the parameters a declaration introduces and folds the graph constraints into them', () => {
    const found = symbols()
    expect(find(found, 'Box').typeParameters).toEqual([{ name: 'T', bound: 'Hashable' }, { name: 'U', bound: 'Marker, == Int' }])
    // The graph repeats the enclosing type's parameters on every member; only the new one is the member's.
    expect(find(found, 'Box.get(_:)').signatures[0].typeParameters).toEqual([{ name: 'V', bound: 'Marker & Hashable' }])
  })

  it('links the enclosing type parameter in a member and not a same-named global', () => {
    const found = [...symbols(), decoy('T')]
    const index = indexOf(found, 'swift')
    const get = find(found, 'Box.get(_:)')
    const parts = index.linkType('func get<V>(_ value: V) -> T', get, get.signatures[0])
    expect(hrefs(parts, 'T')).toEqual([anchor('Box', 'T')])
    expect(hrefs(parts, 'V')).toEqual(Array(2).fill(anchor('Box.get(_:)', 'V')))
    expect(hrefs(index.linkType('T.Element', get, get.signatures[0]), 'T')).toEqual([anchor('Box', 'T')])
  })
})

describe('Julia', () => {
  const struct: ApiSymbol = { ...decoy('LibTmux.EntityRef', 'struct'), typeParams: ['I<:LibTmux.EntityID'] }
  const alias: ApiSymbol = { ...decoy('LibTmux.PaneRef', 'typealias'), typeParams: ['LibTmux.PaneID'], type: 'EntityRef{PaneID}' }
  const method: ApiSymbol = {
    ...decoy('LibTmux.first', 'function'),
    signatures: [{ params: [{ name: 'items', type: 'AbstractVector{T}' }], typeParams: ['T<:LibTmux.Pane'], raw: 'first(items::AbstractVector{T}) where T<:LibTmux.Pane' }],
  }

  it('reads where-clause bounds and ignores the arguments an alias applies', () => {
    const index = indexOf([struct, alias, method, decoy('LibTmux.Pane'), decoy('LibTmux.T')], 'julia')
    expect(typeParametersOf(struct, 'julia')).toEqual([{ name: 'I', bound: 'LibTmux.EntityID' }])
    expect(typeParametersOf(alias, 'julia')).toEqual([])
    const signature = method.signatures[0] as Signature
    const parts = index.linkType(signature.raw!, method, signature)
    expect(hrefs(parts, 'T')).toEqual(Array(2).fill(anchor('LibTmux.first', 'T')))
    expect(hrefs(parts, 'LibTmux.Pane')).toEqual(['/LibTmux.Pane/'])
  })
})

describe('Ruby', () => {
  it('links RBS generics in a signature to the method that declares them', () => {
    const open: ApiSymbol = {
      ...decoy('LibTmux::Async.open', 'method'),
      signatures: [{ params: [], typeParams: ['T'], raw: '[T] (server: ::LibTmux::Server) { (::LibTmux::Async::Scope) -> T } -> T' }],
    }
    const index = indexOf([open, decoy('LibTmux::T')], 'ruby')
    const parts = index.linkType(open.signatures[0].raw!, open, open.signatures[0])
    expect(hrefs(parts, 'T')).toEqual(Array(3).fill(anchor('LibTmux::Async.open', 'T')))
  })
})
