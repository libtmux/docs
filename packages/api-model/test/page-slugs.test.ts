import { describe, expect, it } from 'vitest'
import type { ApiModel, ApiSymbol } from '../src/model.ts'
import { recordAccessorSlugOwner } from '../src/prose.ts'

function fixture() {
  const record: ApiSymbol = { id: 'example.Result', name: 'Result', kind: 'class', modifiers: [],
    signatures: [{ raw: 'public record Result(Outcome outcome, Outcome OUTCOME)',
      params: [{ name: 'outcome', type: 'Outcome' }, { name: 'OUTCOME', type: 'Outcome' }] }], source: { file: 'Result.java', line: 1 } }
  const type: ApiSymbol = { id: 'example.Result.Outcome', name: 'Outcome', kind: 'enum', parent: record.id,
    modifiers: [], signatures: [], source: { file: 'Result.java', line: 3 } }
  const accessor: ApiSymbol = { id: 'example.Result.outcome', name: 'outcome', kind: 'method', parent: record.id,
    modifiers: [], signatures: [{ params: [], returns: 'Outcome' }], source: { file: 'Result.java' } }
  const model: ApiModel = { port: 'java', extractor: 'fixture', symbols: [record, type, accessor] }
  return { model, record, type, accessor }
}

describe('implicit Java record accessor routes', () => {
  it('keeps the native type route when an inferred accessor differs only by case', () => {
    const { model, type, accessor } = fixture()
    expect(recordAccessorSlugOwner(model, [type, accessor])).toBe(type)
    expect(recordAccessorSlugOwner(model, [accessor, type])).toBe(type)
  })

  it('keeps one native route when several inferred names share its slug', () => {
    const { model, type, accessor } = fixture()
    const second = { ...accessor, id: 'example.Result.OUTCOME', name: 'OUTCOME' }
    model.symbols.push(second)
    expect(recordAccessorSlugOwner(model, [accessor, type, second])).toBe(type)
    expect(recordAccessorSlugOwner(model, [second, accessor, type])).toBe(type)
    expect(recordAccessorSlugOwner(model, [accessor, second])).toBeUndefined()
  })

  it('does not replace normal collision handling for explicit accessors or ordinary declarations', () => {
    const { model, type, accessor, record } = fixture()
    accessor.source.line = 5
    expect(recordAccessorSlugOwner(model, [type, accessor])).toBeUndefined()
    delete accessor.source.line
    record.signatures[0].raw = 'public class Result'
    expect(recordAccessorSlugOwner(model, [type, accessor])).toBeUndefined()
  })

  it('requires an exact component name, native return type and no-argument signature', () => {
    const { model, type, accessor } = fixture()
    accessor.signatures[0].returns = 'String'
    expect(recordAccessorSlugOwner(model, [type, accessor])).toBeUndefined()
    accessor.signatures[0].returns = 'Outcome'
    accessor.signatures[0].params = [{ name: 'count', type: 'int' }]
    expect(recordAccessorSlugOwner(model, [type, accessor])).toBeUndefined()
    accessor.signatures[0].params = []
    accessor.name = 'other'
    expect(recordAccessorSlugOwner(model, [type, accessor])).toBeUndefined()
  })

  it('preserves other ports and existing groups with several explicit declarations', () => {
    const { model, type, accessor } = fixture()
    expect(recordAccessorSlugOwner({ ...model, port: 'csharp' }, [type, accessor])).toBeUndefined()
    const other: ApiSymbol = { ...type, id: 'example.Result.OUTCOME', name: 'OUTCOME' }
    model.symbols.push(other)
    expect(recordAccessorSlugOwner(model, [type, other, accessor])).toBeUndefined()
  })
})
