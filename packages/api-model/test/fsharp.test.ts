import { existsSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { docSummaryText, tokenizeDoc } from '../src/doc/roles.ts'
import { SymbolIndex } from '../src/link.ts'
import { extractFSharpArtifact } from '../src/languages/fsharp.ts'
import type { ApiModel } from '../src/model.ts'
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

const documented = (id: string, kind: string, parent: string, documentation: string) => ({
  ...declaration, id, name: id.split('.').at(-1)!, kind, parent,
  signature: kind === 'function' ? 'val f: unit -> unit' : `${kind} ${id}`, documentation,
})

it('reads F# XML doc tags as code and cross-references', () => {
  const model = extractFSharpArtifact({
    ...artifact,
    declarations: [
      documented('LibTmux.FSharp.Server', 'module', 'LibTmux.FSharp', '<summary>Starts servers.</summary>'),
      documented('LibTmux.FSharp.Server.sessions', 'function', 'LibTmux.FSharp.Server', '<summary>Lists sessions.</summary>'),
      documented('LibTmux.FSharp.Query', 'class', 'LibTmux.FSharp', '<summary>A listing.</summary>'),
      documented('LibTmux.FSharp.Server.within', 'function', 'LibTmux.FSharp.Server', [
        '<summary>Bounds <c>retries</c> and returns a <see cref="T:LibTmux.FSharp.Query`1"/>.</summary>',
        '<remarks><para>See <see cref="M:LibTmux.FSharp.Server.sessions"/> and ',
        '<see cref="M:LibTmux.FSharp.Server.missing"/>.</para></remarks>',
      ].join('')),
    ],
  }, 'a'.repeat(40))
  const index = new SymbolIndex(model.symbols, (symbol) => `/${symbol.id}/`, 'fsharp')
  const within = model.symbols.find((symbol) => symbol.id === 'LibTmux.FSharp.Server.within')!

  const summary = index.linkText(within.doc!.summary, within)
  expect(summary.filter((span) => span.kind === 'code')).toEqual([{ kind: 'code', text: 'retries' }])
  expect(summary.some((span) => span.kind === 'text' && span.text.includes('<'))).toBe(false)

  const refs = [...summary, ...index.linkText(within.doc!.body!, within)].filter((span) => span.kind === 'ref')
  expect(refs.map((span) => [span.target, span.link?.symbol?.id])).toEqual([
    ['LibTmux.FSharp.Query`1', 'LibTmux.FSharp.Query'],
    ['LibTmux.FSharp.Server.sessions', 'LibTmux.FSharp.Server.sessions'],
    ['LibTmux.FSharp.Server.missing', undefined],
  ])
})

const MODEL = new URL('../../../site/src/data/api/fsharp.json', import.meta.url)
it.runIf(existsSync(MODEL))('leaves no XML tag in any description of the F# reference', () => {
  const { symbols } = JSON.parse(readFileSync(MODEL, 'utf8')) as ApiModel
  const prose = symbols.flatMap((symbol) => [
    symbol.doc?.summary, symbol.doc?.body,
    ...symbol.signatures.flatMap((sig) => [
      sig.returnsDoc, ...sig.params.map((param) => param.doc), ...(sig.raises ?? []).map((raise) => raise.doc),
    ]),
  ]).filter((text): text is string => Boolean(text))
  const printed = prose.filter((text) => /<\/?[a-z]+[ />]/.test(docSummaryText(text, 'fsharp')))
  expect(printed.slice(0, 3)).toEqual([])
  // The control: the model does carry tags, so the check above can fail.
  expect(prose.some((text) => tokenizeDoc(text, 'fsharp').some((span) => span.kind === 'code'))).toBe(true)
})
