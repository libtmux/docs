import { describe, expect, it } from 'vitest'
import { inventoryType, readInventory, writeInventoryEntries, type InventoryEntry } from '../src/inventory.ts'
import { compatibilityEntries, targetEntries, targetKey, type InventoryTarget } from '../src/targets.ts'
import type { ApiSymbol } from '../src/model.ts'

const entry: InventoryEntry = { name: 'sample', type: 'std:label', priority: 1, uri: 'guide/#sample', dispname: 'Example' }
const options = { project: 'libtmux', version: 'test' }
const target: InventoryTarget = { scope: 'cxx', product: 'core', category: 'api', identity: 'libtmux::Pane', display: 'Pane', href: '/pr-42/en/cxx/v0.1.0/reference/pane/#Pane', version: 'v0.1.0' }

describe('inventory records', () => {
  it('is byte-stable regardless of collection order and preserves spaces in option names', () => {
    const option = { ...entry, name: 'tmux-workspace load --detached', type: 'std:cmdoption' }
    const first = writeInventoryEntries([entry, option], options)
    expect(first).toEqual(writeInventoryEntries([option, entry], options))
    expect(readInventory(first).entries.map((entry) => entry.name)).toContain(option.name)
  })
  it('escapes a literal terminal dollar instead of letting Sphinx substitute a name', () => {
    const result = readInventory(writeInventoryEntries([{ ...entry, uri: 'guide/#literal$' }], options))
    expect(result.entries[0].uri).toBe('guide/#literal%24')
  })
  it('represents the mapping root with an empty URI', () => {
    const result = readInventory(writeInventoryEntries([{ ...entry, uri: '' }], options))
    expect(result.entries[0].uri).toBe('')
    expect(result.entries[0].dispname).toBe('Example')
  })
  it.each(['', '   '])('keeps a record whose display text is %j', (dispname) => {
    const result = readInventory(writeInventoryEntries([{ ...entry, dispname }], options))
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].dispname).toBe(entry.name)
  })
  it.each(['cpp:struct', 'cpp:var', 'cpp:namespace', 'rs:struct', 'mcp:tool', 'py:label'])('rejects the unregistered type %s', (type) => {
    expect(() => writeInventoryEntries([{ ...entry, type }], options)).toThrow('unsupported object type')
  })
  it('rejects duplicate records and standard-role case collisions', () => {
    expect(() => writeInventoryEntries([entry, entry], options)).toThrow('duplicate reference')
    expect(() => writeInventoryEntries([entry, { ...entry, name: 'Sample' }], options)).toThrow('duplicate reference')
  })
  it('maps C++ declaration kinds to object types rather than role names', () => {
    const symbol = (kind: ApiSymbol['kind']) => ({ kind, modifiers: [] }) as unknown as ApiSymbol
    expect(inventoryType(symbol('struct'), 'cxx')).toBe('cpp:class')
    expect(inventoryType(symbol('constant'), 'cxx')).toBe('cpp:member')
    expect(inventoryType(symbol('constant'), 'cxx', 'enum')).toBe('cpp:enumerator')
    expect(inventoryType(symbol('module'), 'cxx')).toBe('std:label')
    expect(inventoryType(symbol('trait'), 'rs')).toBe('std:label')
  })
})

describe('durable portable references', () => {
  it('preserves unambiguous C spellings in legacy inventories without choosing a file-local duplicate', () => {
    const named = { ...target, scope: 'tmux@latest', identity: 'c:function:global', native: [{ type: 'c:function', name: 'global' }], legacy: [{ type: 'c:function', name: 'c:function:global' }] }
    const local = { ...named, identity: 'file:local', native: [{ type: 'c:function', name: 'local' }], legacy: [{ type: 'c:function', name: 'file:local' }], href: named.href + '-local' }
    const other = { ...local, identity: 'other:local', legacy: [{ type: 'c:function', name: 'other:local' }], href: named.href + '-other' }
    const names = compatibilityEntries([named, local, other], '/pr-42/en/').map((entry) => entry.name)
    expect(names).toEqual(['c:function:global', 'global', 'file:local', 'other:local'])
  })
  it('preserves case, separators, literal percent escapes, and Unicode under lowercase processing', () => {
    const keys = ['Pane', 'pane', '%50ane', 'p:ane', 'p%3aane', 'Päne', 'päne'].map((identity) => targetKey({ ...target, identity }))
    expect(new Set(keys.map((key) => key.toLowerCase())).size).toBe(keys.length)
    expect(targetKey(target)).toBe('cxx:core:api:libtmux%3a%3a%50ane')
  })
  it('separates identity and display from the current page URL', () => {
    const moved = { ...target, display: 'A new title', href: '/pr-42/en/cxx/v0.1.0/new-page/#retained' }
    expect(targetKey(moved)).toBe(targetKey(target))
    expect(targetEntries([moved], '/pr-42/en/')[0].uri).toBe('cxx/v0.1.0/new-page/#retained')
  })
  it('normalizes glossary aliases for the case-insensitive standard term role', () => {
    const entries = targetEntries([{ ...target, native: [{ type: 'std:term', name: 'Blocking Call' }] }], '/pr-42/en/', true)
    expect(entries.filter((entry) => entry.type === 'std:term').map((entry) => entry.name)).toEqual(['cxx:core:blocking call', 'cxx:blocking call', 'blocking call'])
  })
  it('exports canonical program option names alongside explicit human names', () => {
    const option = { ...target, scope: 'py', product: 'workspace', native: [{ type: 'std:cmdoption', name: 'tmuxp load --append' }] }
    const names = targetEntries([option], '/pr-42/en/', true).filter((entry) => entry.type === 'std:cmdoption').map((entry) => entry.name)
    expect(names).toEqual(expect.arrayContaining([
      'py:workspace:tmuxp load --append', 'tmuxp load --append',
      'py:workspace:tmuxp-load.--append', 'py:tmuxp-load.--append', 'tmuxp-load.--append',
    ]))
  })
  it('does not choose between commands whose Sphinx program names collide', () => {
    const spaced = { ...target, native: [{ type: 'std:cmdoption', name: 'tmuxp load --append' }] }
    const dashed = { ...spaced, identity: 'other-command', href: target.href + '-other', native: [{ type: 'std:cmdoption', name: 'tmuxp-load --append' }] }
    const names = targetEntries([spaced, dashed], '/pr-42/en/', true).filter((entry) => entry.type === 'std:cmdoption').map((entry) => entry.name)
    expect(names).toEqual(expect.arrayContaining(['tmuxp load --append', 'tmuxp-load --append']))
    for (const name of ['cxx:core:tmuxp-load.--append', 'cxx:tmuxp-load.--append', 'tmuxp-load.--append']) expect(names).not.toContain(name)
  })
  it('keeps unqualified options and existing canonical names unchanged', () => {
    const names = targetEntries([{ ...target, native: [
      { type: 'std:cmdoption', name: '--help' },
      { type: 'std:cmdoption', name: 'tmuxp-load.--append' },
    ] }], '/pr-42/en/', true).filter((entry) => entry.type === 'std:cmdoption').map((entry) => entry.name)
    expect(names).toHaveLength(6)
    expect(names).toEqual(expect.arrayContaining(['--help', 'tmuxp-load.--append']))
  })
  it('rejects a target escaping the configured preview or mapping scope', () => {
    expect(() => targetEntries([target], '/en/')).toThrow('escapes')
    expect(() => targetEntries([target], '/pr-42/en/cxx/latest/')).toThrow('escapes')
  })
  it('retains qualified native aliases when short names are ambiguous across products', () => {
    const core = { ...target, native: [{ type: 'cpp:class', name: 'Pane' }] }
    const workspace = { ...core, product: 'workspace', href: core.href.replace('reference/', 'workspace/reference/') }
    const names = targetEntries([core, workspace], '/pr-42/en/cxx/v0.1.0/', true).filter((entry) => entry.type === 'cpp:class').map((entry) => entry.name)
    expect(names).toEqual(['cxx:core:Pane', 'cxx:workspace:Pane'])
  })
})
