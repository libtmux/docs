import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { aliasTarget, membersOf, pageMembersOf } from '../src/member-order.ts'
import { SymbolIndex } from '../src/link.ts'
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

async function extract(source: string | Record<string, string> = SOURCE) {
  const dir = mkdtempSync(join(tmpdir(), 'ts-alias-'))
  dirs.push(dir)
  for (const [file, text] of Object.entries(typeof source === 'string' ? { 'types.ts': source } : source)) writeFileSync(join(dir, file), text)
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
    const names = (name: string) => pageMembersOf({ ...model, port: 'ts' }, named(name)).map((member) => member.name)
    expect(aliasTarget(model, named('ConnectOptions'))?.id).toBe('types.ConnectionOptions')
    expect(names('ConnectOptions')).toEqual(['bufferSize', 'signal'])
    // An alias is another name, so its members are not marked inherited.
    expect(pageMembersOf({ ...model, port: 'ts' }, named('ConnectOptions')).some((member) => member.inheritedFrom)).toBe(false)
    // Navigation, search and inventories read `membersOf`, where an alias owns nothing.
    expect(membersOf({ ...model, port: 'ts' }, named('ConnectOptions'))).toEqual([])
    expect(membersOf({ ...model, port: 'ts' }, named('Twice'))).toEqual([])
    expect(names('Twice')).toEqual(['bufferSize', 'signal'])
    // Controls: a union, an object type, an applied or built-in generic and an unknown name name no single declaration.
    for (const name of ['Either', 'Shape', 'Boxed', 'Applied', 'Generic']) expect(names(name), name).toEqual([])
    expect(aliasTarget(model, named('Either'))).toBeUndefined()
    expect(aliasTarget(model, named('Applied'))).toBeUndefined()
  })

  it('stops on an alias cycle and on a port that has not opted in', async () => {
    const model = await extract()
    const loop = model.symbols.find((symbol) => symbol.id === 'types.Loop')!
    expect(pageMembersOf({ ...model, port: 'ts' }, loop)).toEqual([])
    const connect = model.symbols.find((symbol) => symbol.id === 'types.ConnectOptions')!
    expect(pageMembersOf({ ...model, port: 'rs' }, connect)).toEqual([])
  })

  it.each(['Foo<T>', 'Foo[]', 'Foo | null', 'typeof foo', 'Foo["bar"]'])('does not resolve %s', async (written) => {
    const model = await extract(`export interface Foo { a: string }\nexport const foo = 1;\nexport type Alias = ${written};\n`)
    const alias = model.symbols.find((symbol) => symbol.id === 'types.Alias')!
    expect(alias.type).toBe(written)
    expect(aliasTarget(model, alias)).toBeUndefined()
    expect(pageMembersOf({ ...model, port: 'ts' }, alias)).toEqual([])
  })

  it('prefers the alias\'s own module for a name declared in two, and refuses an ambiguous one', async () => {
    const model = await extract({
      'a.ts': 'export interface Shared { fromA: string }\nexport type Local = Shared;\n',
      'b.ts': 'export interface Shared { fromB: string }\nexport type Remote = Shared;\n',
      'c.ts': 'export type Elsewhere = Shared;\n',
    })
    const target = (id: string) => aliasTarget(model, model.symbols.find((symbol) => symbol.id === id)!)?.id
    expect(target('a.Local')).toBe('a.Shared')
    expect(target('b.Remote')).toBe('b.Shared')
    expect(target('c.Elsewhere')).toBeUndefined()
  })

  it('gives the words a type binds or reserves a grammar role instead of leaving them plain', async () => {
    const model = await extract(`
export interface Foo { a: string }
declare const brand: unique symbol;
export type Mapped<Key extends string> = { readonly [K in Key]: K | Foo };
export type Guard = (x: unknown) => x is Foo;
export type Branded = string & { readonly [brand]: 1 };
export type Unwrapped<T> = T extends Array<infer Item> ? Item : never;
export type Named = { is: string; in?: number };
export type Engine = { readonly endpoint?: true; execute(request: Foo): Promise<Foo> };
`)
    const index = new SymbolIndex(model.symbols, (symbol) => `/${symbol.slug}/`, 'ts')
    const roles = (name: string) => {
      const alias = model.symbols.find((symbol) => symbol.id === `types.${name}`)!
      return index.linkType(alias.type!, alias).filter((span) => /^[A-Za-z_$]/.test(span.text))
        .map((span) => `${span.text}:${span.keyword ? 'keyword' : span.nonReference ? 'syntax' : span.declaration ? 'name' : span.link ? 'link' : 'plain'}`)
    }
    expect(roles('Mapped')).toEqual(['readonly:keyword', 'K:name', 'in:keyword', 'Key:name', 'K:name', 'Foo:link'])
    expect(roles('Guard')).toEqual(['x:name', 'unknown:link', 'x:name', 'is:keyword', 'Foo:link'])
    expect(roles('Branded')).toEqual(['string:link', 'readonly:keyword', 'brand:name'])
    expect(roles('Unwrapped')).toEqual(['T:name', 'extends:keyword', 'Array:link', 'infer:keyword', 'Item:name', 'Item:name', 'never:link'])
    expect(roles('Engine')).toEqual(['readonly:keyword', 'endpoint:name', 'true:syntax', 'execute:name', 'request:name', 'Foo:link', 'Promise:link', 'Foo:link'])
    // A field that is called `is` or `in` stays a field name.
    expect(roles('Named')).toEqual(['is:name', 'string:link', 'in:name', 'number:link'])
  })
})
