import { describe, expect, it } from 'vitest'
import { PORT_BY_SLUG } from '../src/lib/ports'
import { API_MODELS, API_NAV, ownersOf } from '../src/lib/api-models'
import { sourceGuidesFor } from '../src/lib/port-documentation'
import { INVENTORY } from '../src/lib/port-inventory'

describe('Clojure JVM facade', () => {
  it('registers its public source without inventing registry availability', () => {
    const port = PORT_BY_SLUG.clojure
    expect(port).toBeDefined()
    if (!port) return
    expect(port.language).toBe('Clojure')
    expect(port.parentLibrary).toEqual({ slug: 'java', runtime: 'JVM' })
    expect(port.docsDispatch).toEqual({ ...PORT_BY_SLUG.java.docsDispatch, language: 'clojure' })
    expect(port.source).toEqual({ path: 'libtmux-clojure', ref: 'master' })
    expect(port.packageName).toBe('io.github.libtmux:libtmux-clojure')
    expect(port.registry).toBeUndefined()
    expect(port.ecosystemHost).toBeUndefined()
  })

  it('delivers public namespaces, navigation, guides and honest package inventory', () => {
    const model = API_MODELS.clojure
    expect(model).toBeDefined()
    expect(ownersOf(model!)).toHaveLength(5)
    expect(API_NAV.clojure?.unplaced).toEqual([])
    expect(sourceGuidesFor('clojure').map((guide) => guide.sourcePath)).toContain('docs/guide/clojure.md')
    const packages = INVENTORY.clojure?.filter((entry) => entry.kind === 'library' || entry.kind === 'companion')
    expect(packages?.map((entry) => [entry.coordinate, entry.status])).toEqual([
      ['io.github.libtmux:libtmux-clojure', 'configured-unpublished'],
      ['io.github.libtmux:libtmux-clojure-core-async', 'configured-unpublished'],
    ])
    expect(packages?.every((entry) => !entry.package && !entry.api)).toBe(true)
    const examples = model!.symbols.find((symbol) => symbol.id === 'libtmux.core/open!')?.doc?.examples
    expect(examples?.some((example) => example.code.includes('connected=true'))).toBe(true)
    expect(examples?.some((example) => example.code.includes(':mvn/local-repo "m2"'))).toBe(true)
  })
})
