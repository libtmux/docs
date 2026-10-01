import { expect, it } from 'vitest'
import { extractFSharpArtifact } from '../src/languages/fsharp.ts'
import { ownersOf } from '../src/prose.ts'

const declaration = {
  id: 'LibTmux.FSharp.Filter', name: 'Filter', kind: 'class', parent: 'LibTmux.FSharp',
  file: 'Query.fsi', line: 10, signature: "type Filter<'T>", parameters: [], returns: '', documentation: '',
  namespaces: ['LibTmux'],
}
const artifact = { schema: 1, port: 'fsharp', compiler: '43.10.302.0', declarations: [
  declaration,
  { ...declaration, kind: 'module', signature: 'module Filter', line: 15 },
  { ...declaration, id: 'LibTmux.FSharp.Filter.eq', name: 'eq', kind: 'function', parent: 'LibTmux.FSharp.Filter',
    signature: "val eq: value: 'Value -> field: Field<'T, 'Value> -> Filter<'T>",
    parameters: [{ name: 'value', type: "'Value", optional: false }, { name: 'field', type: "Field<'T, 'Value>", optional: false }],
    returns: "Filter<'T>", documentation: '<summary>Match a field.</summary><param name="value">The expected value.</param>',
  },
] }

it('preserves F# currying and type/module identity for member navigation', () => {
  const model = extractFSharpArtifact(artifact, 'a'.repeat(40))
  expect(model.symbols).toHaveLength(2)
  expect(model.symbols[0].namespaceImports).toEqual(['LibTmux'])
  expect(ownersOf(model).map((s) => s.id)).toEqual(['LibTmux.FSharp.Filter'])
  expect(model.symbols[0].signatures.map((sig) => sig.raw)).toEqual(["type Filter<'T>", 'module Filter'])
  expect(model.symbols[1].signatures[0]).toMatchObject({
    raw: artifact.declarations[2].signature,
    params: [{ name: 'value', type: "'Value", doc: 'The expected value.' }, { name: 'field', type: "Field<'T, 'Value>" }],
    returns: "Filter<'T>",
  })
})

it('rejects empty, unversioned, duplicate or incomplete F# compiler output', () => {
  for (const invalid of [
    {}, { ...artifact, declarations: [] }, { ...artifact, compiler: undefined },
    { ...artifact, declarations: [declaration, declaration] },
    { ...artifact, declarations: [{ ...declaration, signature: '' }] },
  ]) expect(() => extractFSharpArtifact(invalid)).toThrow()
})
