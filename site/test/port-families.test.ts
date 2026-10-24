import { describe, expect, it } from 'vitest'
import { OTHER_FAMILY_LABEL, PORT_FAMILIES, portFamilies } from '../src/lib/port-families'
import { PORTS } from '../src/lib/ports'

const slugs = PORTS.map((port) => port.slug)
const familiesOf = (slug: string) => PORT_FAMILIES.filter((family) => family.ports.includes(slug)).map((family) => family.label)

describe('port picker families', () => {
  it('files every registered port under exactly one family', () => {
    for (const slug of slugs) expect(familiesOf(slug), slug).toHaveLength(1)
  })

  it('names only registered ports, once each, under distinct labels', () => {
    const named = PORT_FAMILIES.flatMap((family) => family.ports)
    expect(named.filter((slug) => !slugs.includes(slug))).toEqual([])
    expect(new Set(named).size).toBe(named.length)
    const labels = [...PORT_FAMILIES.map((family) => family.label), OTHER_FAMILY_LABEL]
    expect(new Set(labels).size).toBe(labels.length)
    expect(PORT_FAMILIES.filter((family) => family.ports.length === 0)).toEqual([])
  })

  it('puts Elixir in the BEAM family and in no other', () => {
    expect(familiesOf('elixir')).toEqual(['BEAM'])
    for (const family of portFamilies(slugs)) {
      expect(family.ports.includes('elixir'), family.label).toBe(family.label === 'BEAM')
    }
  })

  it('keeps the runtime families together, after the language families', () => {
    const labels = PORT_FAMILIES.map((family) => family.label)
    expect(labels.slice(0, 2)).toEqual(['Scripting & web', 'Compiled & native'])
    expect(labels.slice(2)).toEqual(['JVM', '.NET', 'BEAM'])
  })

  it('leaves the catch-all family empty for the registered ports, and last', () => {
    const drawn = portFamilies(slugs)
    expect(drawn.at(-1)).toEqual({ label: OTHER_FAMILY_LABEL, ports: [] })
    expect(drawn.slice(0, -1)).toEqual(PORT_FAMILIES)
  })

  it('collects a port no family names under the catch-all, once', () => {
    const drawn = portFamilies([...slugs, 'zig'])
    expect(drawn.at(-1)).toEqual({ label: OTHER_FAMILY_LABEL, ports: ['zig'] })
    expect(drawn.filter((family) => family.ports.includes('zig'))).toHaveLength(1)
  })
})
