import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { extractProject } from '../src/project.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const SOURCE = `
/** Options. */
export interface ConnectionOptions {
  bufferSize?: number;
  signal?: AbortSignal;
}
export interface Other { other: string }
/** Options for connecting. */
export type ConnectOptions = ConnectionOptions;
export type Twice = ConnectOptions;
export type Either = ConnectionOptions | Other;
export type Shape = { readonly a: string };
export type Boxed<T extends string = "x"> = Wrapper<T>;
export type Applied = Boxed<"y">;
export type Generic = Readonly<ConnectionOptions>;
export type Loop = Loop2;
export type Loop2 = Loop;
`

async function extract(source = SOURCE) {
  const dir = mkdtempSync(join(tmpdir(), 'ts-alias-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'types.ts'), source)
  return extractProject({ port: 'ts', root: dir })
}

describe('TypeScript type aliases', () => {
  it('records the right-hand side as written, with its type parameters', async () => {
    const model = await extract()
    const type = (name: string) => model.symbols.find((symbol) => symbol.id === `types.${name}`)
    expect(type('ConnectOptions')?.type).toBe('ConnectionOptions')
    expect(type('Either')?.type).toBe('ConnectionOptions | Other')
    expect(type('Shape')?.type).toBe('{ readonly a: string }')
    expect(type('Boxed')?.type).toBe('Wrapper<T>')
    expect(type('Boxed')?.typeParams).toEqual(['T extends string = "x"'])
    // A member that is not an alias keeps its annotation in `type`, unchanged.
    expect(type('ConnectionOptions.bufferSize')?.type).toBe('number')
  })
})
