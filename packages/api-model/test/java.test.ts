import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { extractWithSpec } from '../src/languages/spec.ts'
import { JAVA } from '../src/languages/specs.ts'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function extract(source: string, privateMembers = false) {
  const dir = mkdtempSync(join(tmpdir(), 'java-api-'))
  dirs.push(dir)
  const file = join(dir, 'Example.java')
  writeFileSync(file, source)
  return extractWithSpec(JAVA, file, 'example', { privateMembers })
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
