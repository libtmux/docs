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
  it.fails('retains documented components and their implicit public accessors', async () => {
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

  it.fails('preserves explicit accessors, constructors and fields without synthesizing duplicate methods', async () => {
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
      .toEqual([{ params: [{ name: 'ignored', type: 'int' }], returns: 'String' }, { params: [], returns: 'String' }])
    expect(symbols.find((symbol) => symbol.id === 'example.Empty')).toMatchObject({ kind: 'class', signatures: [{ raw: 'public record Empty()', params: [] }] })
    expect(symbols.find((symbol) => symbol.id === 'example.Ordinary')?.signatures).toEqual([])
    expect(symbols.some((symbol) => symbol.name === 'Hidden' || symbol.name === 'secret')).toBe(false)
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
    expect(symbols.find((symbol) => symbol.name === 'Internal')?.kind).toBe('struct')
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
