import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { extractWithSpec } from '../src/languages/spec.ts'
import { JAVA } from '../src/languages/specs.ts'
import { moduleOf, qualifiedNameOf } from '../src/modules.ts'
import { SymbolIndex } from '../src/link.ts'
import { Resolver } from '../src/resolver.ts'
import { parentInventory } from '../src/parent-inventory.ts'
import { readInventory, writeInventory } from '../src/inventory.ts'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function extract(source: string, privateMembers = false, module = 'example') {
  const dir = mkdtempSync(join(tmpdir(), 'java-api-'))
  dirs.push(dir)
  const file = join(dir, 'Example.java')
  writeFileSync(file, source)
  return extractWithSpec(JAVA, file, module, { privateMembers })
}

describe('Java record components', () => {
  it('retains documented components and their implicit public accessors', async () => {
    const symbols = await extract(`package io.github.libtmux.batch;
/** What became of every operation in one batch.
 * @param operations one result per submitted operation, in submission order
 */
public record BatchResult(@ReadOnly List<OperationResult> operations) {
    public BatchResult { operations = List.copyOf(operations); }
    /** Whether every operation succeeded. */
    public boolean succeeded() { return true; }
}`)
    const record = symbols.find((symbol) => symbol.id === 'example.BatchResult')!
    expect(record.signatures).toEqual([{
      raw: 'public record BatchResult(@ReadOnly List<OperationResult> operations)',
      params: [{ name: 'operations', type: 'List<OperationResult>',
        doc: 'one result per submitted operation, in submission order' }],
    }])
    expect(record.kind).toBe('class')
    expect(record.qualifiedName).toBe('io.github.libtmux.batch.BatchResult')
    const accessor = symbols.find((symbol) => symbol.id === 'example.BatchResult.operations')!
    expect(accessor).toMatchObject({
      name: 'operations', kind: 'method', parent: record.id,
      qualifiedName: 'io.github.libtmux.batch.BatchResult.operations',
      signatures: [{ params: [], returns: 'List<OperationResult>' }],
      doc: { summary: 'one result per submitted operation, in submission order' },
      source: { file: record.source.file },
    })
    expect(accessor.source.line).toBeUndefined()
    expect(symbols.some((symbol) => symbol.kind === 'attribute' && symbol.name === 'operations')).toBe(false)
    expect(symbols.find((symbol) => symbol.name === 'succeeded')).toMatchObject({
      signatures: [{ params: [], returns: 'boolean' }],
      doc: { summary: 'Whether every operation succeeded.' }, source: { line: 8 },
    })
    const model = { port: 'java' as const, extractor: 'test', symbols }
    const hrefFor = (symbol: typeof symbols[number]) => `/reference/${symbol.id}/`
    const index = new SymbolIndex(symbols, hrefFor, 'java')
    expect(index.resolve('operations', 'meth', record)?.symbol?.id).toBe(accessor.id)
    expect(index.resolve(accessor.qualifiedName!)?.href).toBe(hrefFor(accessor))
    expect(readInventory(writeInventory(model, { project: 'java', version: 'test', uriFor: hrefFor }))
      .entries.find((entry) => entry.name === accessor.id)?.uri).toBe(hrefFor(accessor))
  })

  it('preserves explicit accessors, constructors and fields without synthesizing duplicate methods', async () => {
    const symbols = await extract(`package example;
/** @param value the supplied value */
public record Result<T>(T value) {
    public static final int LIMIT = 4;
    public Result(T value) { this.value = value; }
    /** The normalized value. */
    public T value() { return value; }
    public T value(int ignored) { return value; }
}
public record Overloaded(String name) {
    public String name(int ignored) { return name; }
}
public record Empty() {}
public class Ordinary {
    public int count;
    private record Hidden(int secret) {}
}`)
    const record = symbols.find((symbol) => symbol.id === 'example.Result')!
    expect(record.signatures[0]).toMatchObject({ params: [{ name: 'value', type: 'T', doc: 'the supplied value' }], typeParams: ['T'] })
    const accessor = symbols.find((symbol) => symbol.id === 'example.Result.value')!
    expect(accessor.signatures).toHaveLength(2)
    expect(accessor.doc?.summary).toBe('The normalized value.')
    expect(accessor.source.line).toBe(7)
    expect(symbols.find((symbol) => symbol.id === 'example.Result.Result')).toMatchObject({
      kind: 'method', signatures: [{ params: [{ name: 'value', type: 'T' }] }], source: { line: 5 },
    })
    expect(symbols.find((symbol) => symbol.id === 'example.Result.LIMIT')).toMatchObject({ kind: 'attribute', type: 'int', source: { line: 4 } })
    expect(symbols.find((symbol) => symbol.id === 'example.Overloaded.name')?.signatures)
      .toEqual([{ raw: 'public String name(int ignored)', params: [{ name: 'ignored', type: 'int' }], returns: 'String' }, { params: [], returns: 'String' }])
    expect(symbols.find((symbol) => symbol.id === 'example.Empty')).toMatchObject({ kind: 'class', signatures: [{ raw: 'public record Empty()', params: [] }] })
    expect(symbols.find((symbol) => symbol.id === 'example.Ordinary')?.signatures).toEqual([])
    expect(symbols.some((symbol) => symbol.name === 'Hidden' || symbol.name === 'secret')).toBe(false)
  })
})

describe('Java record component boundaries', () => {
  it.each(['String', 'T', 'String[]'])('keeps variable-arity %s components and their array accessor types', async (element) => {
    const symbols = await extract(`public record Varargs<T>(@ReadOnly ${element}... values) {}`)
    const owner = symbols.find((symbol) => symbol.id === 'example.Varargs')!
    expect(owner.signatures[0]).toMatchObject({
      raw: `public record Varargs<T>(@ReadOnly ${element}... values)`,
      params: [{ name: 'values', type: `${element}[]`, variadic: 'positional' }], typeParams: ['T'],
    })
    expect(symbols.filter((symbol) => symbol.parent === owner.id).map((symbol) => [symbol.name, symbol.signatures]))
      .toEqual([['values', [{ params: [], returns: `${element}[]` }]]])
  })

  it('skips line and block comments between record components', async () => {
    const symbols = await extract(`public record WithComment(int a, /* separate b */ String b,
        // separate c
        boolean c) {}`)
    const owner = symbols.find((symbol) => symbol.id === 'example.WithComment')!
    expect(owner.signatures[0].params).toEqual([
      { name: 'a', type: 'int' }, { name: 'b', type: 'String' }, { name: 'c', type: 'boolean' },
    ])
    expect(symbols.filter((symbol) => symbol.parent === owner.id).map((symbol) => symbol.name)).toEqual(['a', 'b', 'c'])
  })

  it.each(['public static class Value {}', 'public record Value(int x) {}', 'public record Value() {}'])
    ('keeps a same-name type distinct from its accessor: %s', async (nested) => {
      const symbols = await extract(`package nativepkg; public record NameClash(int Value) { ${nested} }`, false, 'legacy.NameClash')
      const owner = symbols.find((symbol) => symbol.id === 'legacy.NameClash.NameClash')!
      const type = symbols.find((symbol) => symbol.id === `${owner.id}.Value`)!
      const accessor = symbols.find((symbol) => symbol.id === `${owner.id}.Value()`)!
      expect(type.kind).toBe('class')
      expect(type.modifiers).not.toContain('overload')
      expect(type.signatures.flatMap((signature) => signature.params.map((param) => param.name)))
        .toEqual(nested.includes('(int x)') ? ['x'] : [])
      expect(accessor).toMatchObject({ kind: 'method', parent: owner.id, name: 'Value', signatures: [{ params: [], returns: 'int' }] })
      const hrefFor = (symbol: typeof symbols[number]) => `/reference/${symbol.id}/`
      const index = new SymbolIndex(symbols, hrefFor, 'java')
      expect(index.resolve('Value', 'class', owner)?.symbol?.id).toBe(type.id)
      expect(index.resolve('Value', 'meth', owner)?.symbol?.id).toBe(accessor.id)
      expect(index.resolve('Value()', 'any', owner)?.symbol?.id).toBe(accessor.id)
      expect(index.resolve(accessor.qualifiedName! + '()', 'meth')?.symbol?.id).toBe(accessor.id)
      expect(index.resolve(type.id, 'class')?.symbol?.id).toBe(type.id)
      const model = { port: 'java' as const, extractor: 'test', symbols }
      const resolver = new Resolver([model])
      expect(resolver.resolve('java', type.qualifiedName!)).toMatchObject({ symbol: { id: type.id } })
      expect(resolver.resolve('java', 'Value')).toMatchObject({ symbol: { id: type.id } })
      expect(resolver.resolve('java', 'Value()')).toMatchObject({ symbol: { id: accessor.id } })
      expect(resolver.resolve('java', accessor.qualifiedName! + '()')).toMatchObject({ symbol: { id: accessor.id } })
      expect(resolver.resolve('java', 'NameClash.Value()')).toMatchObject({ symbol: { id: accessor.id } })
      const entries = readInventory(writeInventory(model, { project: 'java', version: 'test', uriFor: hrefFor })).entries
      for (const symbol of [type, accessor]) expect(entries.find((entry) => entry.name === symbol.id)?.uri).toBe(hrefFor(symbol))
      const parents = parentInventory(model, hrefFor)
      expect(parents.find((entry) => entry.name === type.qualifiedName)?.uri).toBe(hrefFor(type).slice(1))
      expect(parents.find((entry) => entry.name === accessor.qualifiedName + '()')?.uri).toBe(hrefFor(accessor).slice(1))
    })

  it('keeps explicit constructor identities separate from a same-name record component', async () => {
    const symbols = await extract(`package example; public record SelfName(int SelfName) {
      public SelfName(int SelfName) { this.SelfName = SelfName; }
      public SelfName() { this(0); }
    }`)
    const owner = symbols.find((symbol) => symbol.id === 'example.SelfName')!
    const constructor = symbols.find((symbol) => symbol.id === 'example.SelfName.SelfName')!
    const accessor = symbols.find((symbol) => symbol.id === 'example.SelfName.SelfName()')!
    expect(constructor.signatures).toEqual([
      { raw: 'public SelfName(int SelfName)', params: [{ name: 'SelfName', type: 'int' }] },
      { raw: 'public SelfName()', params: [] },
    ])
    expect(accessor.signatures).toEqual([{ params: [], returns: 'int' }])
    const index = new SymbolIndex(symbols, (symbol) => `/reference/${symbol.id}/`, 'java')
    expect(index.resolve(constructor.id, 'meth')?.symbol?.id).toBe(constructor.id)
    expect(index.resolve('SelfName()', 'any', owner)?.symbol?.id).toBe(accessor.id)
  })
})

describe('Java callable source headers', () => {
  it('retains annotations, modifiers, generics, throws and comments without the method body', async () => {
    const raw = `@Note("Target  literal")
@ReadOnly
public synchronized <T extends Target & Comparable<T>>
Map<String, List<? super T[]>> read(final @Safe T value)
    throws IOException, Other /* retained  comment */`
    const symbols = await extract(`public class Example { ${raw} { throw new IOException(); } }`)
    const method = symbols.find((symbol) => symbol.name === 'read')!
    expect(method.signatures[0].raw).toBe(raw)
    expect(method.signatures[0].params).toEqual([{ name: 'value', type: 'T' }])
    expect(method.signatures[0].typeParams).toEqual(['T extends Target & Comparable<T>'])
    expect(method.signatures[0].returns).toBe('Map<String, List<? super T[]>>')
  })

  it('retains complete overloads and constructor headers in source order', async () => {
    const symbols = await extract(`package example;
public class Example {
    @ReadOnly public List<Session> sessions(FilterExpr<Session> expression) { return null; }
    @ReadOnly public List<Session> sessions() { return null; }
    protected Example(String name) {}
}`)
    const method = symbols.find((symbol) => symbol.name === 'sessions')!
    expect(method.signatures.map((signature) => signature.raw)).toEqual([
      '@ReadOnly public List<Session> sessions(FilterExpr<Session> expression)',
      '@ReadOnly public List<Session> sessions()',
    ])
    expect(method.id).toBe('example.Example.sessions')
    expect(method.parent).toBe('example.Example')
    const constructor = symbols.find((symbol) => symbol.id === 'example.Example.Example')!
    expect(constructor.signatures[0]).toMatchObject({ raw: 'protected Example(String name)', params: [{ name: 'name', type: 'String' }] })
    expect(constructor.signatures[0].returns).toBeUndefined()
  })

  it('preserves bodyless interface syntax without inventing public or removing its semicolon', async () => {
    const symbols = await extract(`public interface Example {
    @ReadOnly List<Session> sessions(FilterExpr<Session> expression) throws IOException;
    default List<Session> sessions() { return null; }
}`)
    expect(symbols.find((symbol) => symbol.name === 'sessions')!.signatures.map((signature) => signature.raw)).toEqual([
      '@ReadOnly List<Session> sessions(FilterExpr<Session> expression) throws IOException;',
      'default List<Session> sessions()',
    ])
  })

  it.each(['String', 'T', 'String[]'])('retains variable-arity %s names, types and owning documentation', async (type) => {
    const symbols = await extract(`public class Example<T> {
    /** @param values values in their original order */
    @SafeVarargs public final void accept(final @ReadOnly ${type}... values) {}
    public Example(${type}... initial) {}
}`)
    const method = symbols.find((symbol) => symbol.name === 'accept')!
    expect(method.signatures[0].params).toEqual([{
      name: 'values', type, variadic: 'positional', doc: 'values in their original order',
    }])
    const constructor = symbols.find((symbol) => symbol.id === 'example.Example.Example')!
    expect(constructor.signatures[0].params).toEqual([{ name: 'initial', type, variadic: 'positional' }])
  })

  it('does not fabricate a source header or line for an implicit record accessor', async () => {
    const symbols = await extract('public record Example(String value) {}')
    const accessor = symbols.find((symbol) => symbol.id === 'example.Example.value')!
    expect(accessor.signatures).toEqual([{ params: [], returns: 'String' }])
    expect(accessor.source.line).toBeUndefined()
  })
})

describe('Java record accessor resolution boundaries', () => {
  it.each([['int', 'int'], ['java.lang.String', 'String']])('retains an explicit accessor with component %s and return %s', async (component, returns) => {
    const symbols = await extract(`public record Self(${component} Self) {
      /** Explicit accessor. */
      public ${returns} Self() { return Self; }
    }`)
    const owner = symbols.find((symbol) => symbol.id === 'example.Self')!
    const accessors = symbols.filter((symbol) => symbol.parent === owner.id && symbol.name === 'Self')
    expect(accessors).toHaveLength(1)
    expect(accessors[0]).toMatchObject({
      id: 'example.Self.Self', signatures: [{ params: [], returns }],
      doc: { summary: 'Explicit accessor.' }, source: { line: 3 },
    })
  })

  it('keeps an unqualified collision accessor ambiguous with an ordinary method', async () => {
    const symbols = await extract(`package example;
      public record HasType(int Value) { public static class Value {} }
      public class Ordinary { public int Value() { return 0; } }`)
    const accessor = symbols.find((symbol) => symbol.id === 'example.HasType.Value()')!
    const ordinary = symbols.find((symbol) => symbol.id === 'example.Ordinary.Value')!
    const resolver = new Resolver([{ port: 'java', extractor: 'test', symbols }])
    expect(resolver.resolve('java', 'Value()')).toMatchObject({ how: 'ambiguous', candidates: 2 })
    expect(resolver.resolve('java', 'example.HasType.Value()')).toMatchObject({ symbol: { id: accessor.id } })
    expect(resolver.resolve('java', 'example.Ordinary.Value()')).toMatchObject({ symbol: { id: ordinary.id } })
  })
})

describe('Java callable visibility', () => {
  it('excludes package-private overloads before merging public signatures', async () => {
    const source = `
      public class Example {
        static String serve(Internal surface) { return ""; }
        public String serve(String input) { return input; }
        protected String serve(int count) { return ""; }
        private String serve(boolean hidden) { return ""; }
        Example(Internal surface) {}
        public Example(String input) {}
      }
      record Internal(String value) {
        String inspect() { return value; }
      }
    `
    const symbols = await extract(source)
    const method = symbols.find((symbol) => symbol.name === 'serve')
    expect(method?.signatures.map((signature) => signature.params[0].type)).toEqual(['String', 'int'])
    expect(symbols.find((symbol) => symbol.id === 'example.Example.Example')?.signatures).toHaveLength(1)
    expect(symbols.find((symbol) => symbol.name === 'Internal')?.kind).toBe('class')
    expect(symbols.find((symbol) => symbol.id === 'example.Internal.inspect')).toBeDefined()

    const all = await extract(source, true)
    expect(all.find((symbol) => symbol.name === 'serve')?.signatures).toHaveLength(4)
  })

  it('keeps implicitly public interface methods and enum constants', async () => {
    const symbols = await extract(`
      public interface Contract {
        String read();
        default String value() { return ""; }
        static String create() { return ""; }
        private String hidden() { return ""; }
      }
      public enum Mode { SAFE, FAST }
    `)
    expect(symbols.filter((symbol) => symbol.parent).map((symbol) => symbol.name)).toEqual([
      'read', 'value', 'create', 'SAFE', 'FAST',
    ])
  })
})

describe('Java source-qualified names', () => {
  it('reads the package and nested ownership independently of file-based link ids', async () => {
    const symbols = await extract(`
      // package fabricated.filename;
      package org . org /* package comment */ . api;
      public class Example {
        public Example() {}
        public static class Builder {
          public Builder() {}
          public Example build() { return new Example(); }
        }
      }
    `)
    expect(symbols.map(({ id, qualifiedName, namespace, parent }) => ({ id, qualifiedName, namespace, parent }))).toEqual([
      { id: 'example.Example', qualifiedName: 'org.org.api.Example', namespace: 'org.org.api', parent: undefined },
      { id: 'example.Example.Example', qualifiedName: 'org.org.api.Example.Example', namespace: 'org.org.api', parent: 'example.Example' },
      { id: 'example.Example.Builder', qualifiedName: 'org.org.api.Example.Builder', namespace: 'org.org.api', parent: 'example.Example' },
      { id: 'example.Example.Builder.Builder', qualifiedName: 'org.org.api.Example.Builder.Builder', namespace: 'org.org.api', parent: 'example.Example.Builder' },
      { id: 'example.Example.Builder.build', qualifiedName: 'org.org.api.Example.Builder.build', namespace: 'org.org.api', parent: 'example.Example.Builder' },
    ])
    expect(moduleOf(symbols.at(-1)!)).toBe('org.org.api')
    expect(qualifiedNameOf(symbols.at(-1)!)).toBe('org.org.api.Example.Builder.build')

    const model = { port: 'java' as const, extractor: 'test', symbols }
    const hrefFor = (symbol: typeof symbols[number]) => `/reference/${symbol.id}/#${symbol.id}`
    const index = new SymbolIndex(symbols, hrefFor, 'java')
    const resolver = new Resolver([model])
    for (const symbol of symbols) {
      expect(index.resolve(symbol.qualifiedName!)?.symbol?.id).toBe(symbol.id)
      expect(index.resolve(symbol.id)?.symbol?.id).toBe(symbol.id)
      expect(resolver.resolve('java', symbol.qualifiedName!)).toMatchObject({ symbol: { id: symbol.id } })
    }
    const builder = symbols.find((symbol) => symbol.name === 'build')!
    expect(index.resolve('Example', 'class', builder)?.symbol?.id).toBe('example.Example')
    expect(index.resolve('Builder', 'class', builder)?.symbol?.id).toBe('example.Example.Builder')
    const parents = parentInventory(model, hrefFor)
    expect(parents.find((entry) => entry.name === 'org.org.api.Example.Builder.build')?.uri).toBe(hrefFor(builder).slice(1))
    expect(parents.find((entry) => entry.name === 'org.org.api.Example.Example')?.uri).toBe(hrefFor(symbols[1]).slice(1))
    const inventory = readInventory(writeInventory(model, { project: 'java', version: 'test', uriFor: hrefFor }))
    expect(inventory.entries.find((entry) => entry.name === builder.id)).toMatchObject({
      dispname: 'org.org.api.Example.Builder.build', uri: hrefFor(builder),
    })
  })

  it('preserves legitimate repeated type and package names and unnamed packages', async () => {
    const symbols = await extract('package api.Example; public class Example { public Example() {} }')
    expect(symbols.map(qualifiedNameOf)).toEqual(['api.Example.Example', 'api.Example.Example.Example'])
    expect(symbols.map(moduleOf)).toEqual(['api.Example', 'api.Example'])
    const unnamed = await extract('public class Example { public void run() {} }')
    expect(unnamed.map(qualifiedNameOf)).toEqual(['Example', 'Example.run'])
    expect(unnamed.map(moduleOf)).toEqual(['', ''])
  })

  it('keeps legacy type links when a constructor has the same canonical spelling', async () => {
    const symbols = await extract('package example; public class Example { public Example() {} }', false, 'example.Example')
    const index = new SymbolIndex(symbols, (symbol) => `/reference/${symbol.id}`, 'java')
    expect(index.resolve('example.Example')?.symbol?.kind).toBe('class')
    // This is the constructor's native name and an existing type's stable id.
    expect(index.resolve('example.Example.Example')?.symbol?.kind).toBe('class')
    expect(index.resolve('example.Example.Example.Example')?.symbol?.kind).toBe('method')
  })
})
