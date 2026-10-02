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
