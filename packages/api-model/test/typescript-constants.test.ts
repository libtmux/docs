import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SymbolIndex } from '../src/link.ts'
import { extractWithSpec } from '../src/languages/spec.ts'
import { TYPESCRIPT } from '../src/languages/specs.ts'
import overwriteProbes from './fixtures/typescript-constant-overwrites.json'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
async function extract(source: string) {
  const directory = mkdtempSync(join(tmpdir(), 'typescript-constants-'))
  directories.push(directory)
  const file = join(directory, 'constants.ts')
  writeFileSync(file, source)
  return extractWithSpec(TYPESCRIPT, file, 'constants')
}

describe('TypeScript constant-object members', () => {
  it.each(overwriteProbes)('retains only proven final members for $name', async ({ source, name, members }) => {
    const symbols = await extract(source)
    expect(new Set(symbols.map((symbol) => symbol.id)).size).toBe(symbols.length)
    const children = symbols.filter((symbol) => symbol.parent === 'constants.Direction')
    expect(children.map((symbol) => [symbol.name, symbol.value ?? null])).toEqual(members)
    if (name === 'real-enum') {
      expect(symbols[0].kind).toBe('enum')
      expect(symbols[0].declarations).toBeUndefined()
      expect(children.every((symbol) => symbol.kind === 'constant')).toBe(true)
    } else expect(children.every((symbol) => symbol.kind === 'property' && symbol.modifiers.includes('readonly'))).toBe(true)
  })

  it('keeps the winning declaration source and documentation once', async () => {
    const symbols = await extract(`export const Direction = {
  /** Superseded value. */
  Up: "old",
  /** Final value. */
  Up: "UP",
} as const;`)
    expect(symbols.filter((symbol) => symbol.parent === 'constants.Direction')).toMatchObject([
      { id: 'constants.Direction.Up', value: '"UP"', source: { line: 5 }, doc: { summary: 'Final value.' } },
    ])
  })

  it.each([
    ['Up: "UP", Up: makeValue()', []],
    ['Up: "UP", Up', []],
    ['Up: "UP", get Down() { return "DOWN"; }', [['Up', '"UP"']]],
    ['Up: "UP", set Up(value: string) {}', []],
    ['Up: "UP", Up() {}', []],
    ['Up: "UP", "Up": "DOWN", Down: "DOWN"', [['Down', '"DOWN"']]],
    ['Up: "UP", "\\u0055p": "DOWN"', []],
  ])('handles later writes without evaluating %s', async (entries, expected) => {
    const symbols = await extract(`export const Direction = { ${entries} } as const;`)
    expect(symbols.filter((symbol) => symbol.parent === 'constants.Direction').map((symbol) => [symbol.name, symbol.value])).toEqual(expected)
  })

  it('preserves a type/value pair and its members without creating overloads', async () => {
    const symbols = await extract(`export const ResizeAdjustmentDirection = {
  /** Move the upper boundary. */
  Up: "UP",
  Down: "DOWN",
  Left: "LEFT",
  Right: "RIGHT",
} as const;
/** Which edge a resize moves. See \`Up\`. */
export type ResizeAdjustmentDirection =
  (typeof ResizeAdjustmentDirection)[keyof typeof ResizeAdjustmentDirection];
export const OtherDirection = { Up: "other" } as const;
`)
    const owner = symbols.find((symbol) => symbol.id === 'constants.ResizeAdjustmentDirection')!
    expect(owner).toMatchObject({ kind: 'typealias', modifiers: [], signatures: [], source: { line: 9 } })
    expect(owner.declarations?.map((declaration) => [declaration.kind, declaration.source.line]))
      .toEqual([['constant', 1], ['typealias', 9]])
    expect(owner.declarations?.[0].text).toContain('const ResizeAdjustmentDirection = {')
    expect(owner.declarations?.[1].text).toContain('type ResizeAdjustmentDirection =')
    expect(owner.doc?.summary).toContain('Which edge a resize moves.')
    const members = symbols.filter((symbol) => symbol.parent === owner.id)
    expect(members.map((member) => [member.name, member.value, member.kind, member.source.line]))
      .toEqual([['Up', '"UP"', 'property', 3], ['Down', '"DOWN"', 'property', 4], ['Left', '"LEFT"', 'property', 5], ['Right', '"RIGHT"', 'property', 6]])
    expect(members.every((member) => member.modifiers.includes('readonly'))).toBe(true)
    expect(members[0].doc?.summary).toBe('Move the upper boundary.')
    expect(members[1].doc).toBeUndefined()
    const index = new SymbolIndex(symbols, (symbol) => `/reference/${symbol.id}/`, 'ts')
    expect(index.resolve('Up', 'any', owner)?.symbol?.id).toBe('constants.ResizeAdjustmentDirection.Up')
    expect(index.resolve('Up')).toBeUndefined()
  })

  it('retains exact scalar spellings and does not evaluate initializers or expose map keys', async () => {
    const symbols = await extract(`const Private = { Hidden: "hidden" } as const;
export let Mutable = { Hidden: "hidden" } as const;
export const Plain = { Hidden: "hidden" };
export const Flags = {
  [Other.Up]: "map key",
  Zero: 0,
  Huge: 9007199254740993123456789n,
  Negative: -12,
  Escaped: "a\\n  b",
  Yes: true,
  Nothing: null,
  __proto__: null,
  Computed: makeValue(),
  "quoted-key": "map key",
  Nested: { item: "not a named scalar" },
} as const;
`)
    const owner = symbols.find((symbol) => symbol.id === 'constants.Flags')!
    expect(owner.kind).toBe('constant')
    expect(symbols.filter((symbol) => symbol.parent === owner.id).map((symbol) => [symbol.name, symbol.value]))
      .toEqual([['Zero', '0'], ['Huge', '9007199254740993123456789n'], ['Negative', '-12'], ['Escaped', '"a\\n  b"'], ['Yes', 'true'], ['Nothing', 'null']])
    expect(symbols.some((symbol) => symbol.name === 'Hidden' || symbol.name === 'Private' || symbol.name === 'Mutable' || symbol.name === 'Plain')).toBe(false)
  })

  it('merges the same type/value pair when the alias precedes the constant', async () => {
    const symbols = await extract(`/** The allowed values. */
export type Choice = (typeof Choice)[keyof typeof Choice];
/** Runtime choices. */
export const Choice = { First: "first" } as const;
`)
    expect(symbols.map((symbol) => symbol.id)).toEqual(['constants.Choice', 'constants.Choice.First'])
    expect(symbols[0].declarations?.map((declaration) => declaration.kind)).toEqual(['typealias', 'constant'])
    expect(symbols[0].declarations?.[1].doc?.summary).toBe('Runtime choices.')
    expect(symbols[0].modifiers).not.toContain('overload')
  })
})
