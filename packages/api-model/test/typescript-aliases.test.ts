import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { aliasTarget, membersOf } from '../src/member-order.ts'
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

  it('resolves only a lone reference, following alias chains', async () => {
    const model = await extract()
    const named = (name: string) => model.symbols.find((symbol) => symbol.id === `types.${name}`)!
    const names = (name: string) => membersOf({ ...model, port: 'ts' }, named(name)).map((member) => member.name)
    expect(aliasTarget(model, named('ConnectOptions'))?.id).toBe('types.ConnectionOptions')
    expect(names('ConnectOptions')).toEqual(['bufferSize', 'signal'])
    // An alias is another name, so its members are not marked inherited.
    expect(membersOf({ ...model, port: 'ts' }, named('ConnectOptions')).some((member) => member.inheritedFrom)).toBe(false)
    expect(names('Twice')).toEqual(['bufferSize', 'signal'])
    // Controls: a union, an object type, an applied or built-in generic and an unknown name name no single declaration.
    for (const name of ['Either', 'Shape', 'Boxed', 'Applied', 'Generic']) expect(names(name), name).toEqual([])
    expect(aliasTarget(model, named('Either'))).toBeUndefined()
    expect(aliasTarget(model, named('Applied'))).toBeUndefined()
  })

  it('stops on an alias cycle and on a port that has not opted in', async () => {
    const model = await extract()
    const loop = model.symbols.find((symbol) => symbol.id === 'types.Loop')!
    expect(membersOf({ ...model, port: 'ts' }, loop)).toEqual([])
    const connect = model.symbols.find((symbol) => symbol.id === 'types.ConnectOptions')!
    expect(membersOf({ ...model, port: 'rs' }, connect)).toEqual([])
  })
})
