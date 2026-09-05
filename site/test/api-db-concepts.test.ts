import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { CONCEPTS } from '@libtmux/api-model'
import { bindingsOf, conceptOf, seed, symbolById } from '../src/db'
import { MODEL_DIR } from '../src/db/paths'

/**
 * The concept map, as the projection sees it.
 *
 * `packages/api-model/test/concepts.test.ts` is what keeps the map honest —
 * it resolves every id against the extracted models, so a rename upstream
 * fails there rather than silently dropping a cross-language link. This does
 * not repeat that. It checks the projection is faithful to the module and
 * answers the two questions a reference page actually asks.
 */
const hasModels = existsSync(join(MODEL_DIR, 'py.json'))
const describeIfSeeded = hasModels ? describe : describe.skip

describeIfSeeded('concept projection', () => {
  beforeAll(() => {
    seed()
  })

  it('holds every concept the module declares', () => {
    const ids = Object.keys(CONCEPTS)
    expect(ids.length).toBeGreaterThan(5)
    for (const id of ids) {
      const bindings = bindingsOf(id)
      expect(bindings.length, `bindings for ${id}`).toBeGreaterThan(0)
      expect(bindings[0].label).toBe(CONCEPTS[id].label)
    }
  })

  it('binds every port the module names, present or absent', () => {
    for (const [id, concept] of Object.entries(CONCEPTS)) {
      const got = new Map(bindingsOf(id).map((b) => [b.port, b]))
      for (const [port, symbolId] of Object.entries(concept.symbols)) {
        expect(got.get(port)?.symbol_id, `${id} in ${port}`).toBe(symbolId)
      }
      for (const [port, reason] of Object.entries(concept.absent ?? {})) {
        expect(got.get(port)?.symbol_id, `${id} absent in ${port}`).toBeNull()
        expect(got.get(port)?.absent_reason, `${id} reason for ${port}`).toBe(reason)
      }
    }
  })

  it('records why a port lacks an operation rather than omitting it', () => {
    // An omission reads as an oversight. "No direct equivalent, and here is
    // why" is a real answer to "how do I do this here", and the reason is
    // hand-written because nothing derives it.
    const withAbsences = Object.entries(CONCEPTS).filter(([, c]) => c.absent)
    expect(withAbsences.length, 'some concept records an absence').toBeGreaterThan(0)

    for (const [id, concept] of withAbsences) {
      for (const port of Object.keys(concept.absent ?? {})) {
        const binding = bindingsOf(id).find((b) => b.port === port)
        expect(binding, `${id}/${port} has a row at all`).toBeTruthy()
        expect(binding!.absent_reason?.length, `${id}/${port} explains itself`).toBeGreaterThan(0)
      }
    }
  })

  it('answers "what concept is this symbol" from a symbol page', () => {
    const [id, concept] = Object.entries(CONCEPTS)[0]
    const [port, symbolId] = Object.entries(concept.symbols)[0]

    const found = conceptOf(port, symbolId)
    expect(found?.concept, `${symbolId} in ${port}`).toBe(id)
    expect(found?.label).toBe(concept.label)
  })

  it('reaches a real symbol for most bindings', () => {
    // The module is validated against the models elsewhere; this catches the
    // projection being keyed on something the symbol table cannot match —
    // a binding on `publicId` against a table keyed by `id`, say, which would
    // leave every cross-language link dead while both sides looked correct.
    let hits = 0
    let total = 0
    for (const concept of Object.values(CONCEPTS)) {
      for (const [port, symbolId] of Object.entries(concept.symbols)) {
        total += 1
        if (symbolById(port, 'latest', symbolId) || symbolById(port, 'stable', symbolId)) hits += 1
      }
    }
    expect(total).toBeGreaterThan(0)
    expect(hits / total, `${hits}/${total} bindings resolve in the symbol table`).toBeGreaterThan(0.5)
  })

  it('never binds a port as both present and absent', () => {
    // The primary key makes this impossible to seed; asserting it states the
    // invariant for anyone who later relaxes the key.
    for (const id of Object.keys(CONCEPTS)) {
      const bindings = bindingsOf(id)
      const ports = bindings.map((b) => b.port)
      expect(new Set(ports).size, `${id} binds each port once`).toBe(ports.length)
      for (const b of bindings) {
        expect(
          (b.symbol_id === null) !== (b.absent_reason === null),
          `${id}/${b.port} is either implemented or explained, not both or neither`,
        ).toBe(true)
      }
    }
  })
})
