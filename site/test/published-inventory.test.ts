import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readInventory, targetKey, writeInventoryEntries } from '@libtmux/api-model'

const root = resolve(import.meta.dirname, '../..')
const scratch: string[] = []
afterEach(() => { for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true }) })

function fixture(published = true, wrongScope = false) {
  const path = mkdtempSync(join(tmpdir(), 'libtmux-published-inventory-')); scratch.push(path)
  const write = (file: string, object: unknown) => { const target = join(path, file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, JSON.stringify(object)) }
  for (const file of ['inventory', 'targets', 'modules']) {
    mkdirSync(join(path, 'inventory-runtime'), { recursive: true })
    cpSync(join(root, `packages/api-model/src/${file}.ts`), join(path, `inventory-runtime/${file}.ts`))
  }
  write('inventory-runtime/package.json', { type: 'module' })
  const target = (scope: string, version: string) => {
    const value = { scope, version, product: 'core', category: 'api', identity: 'Pane', display: 'Pane', href: `/en/${scope}/${version}/reference/pane/#Pane` }
    return { ...value, key: targetKey(value), legacy: [{ type: 'std:label', name: 'Pane' }] }
  }
  write('shell-paths.json', { portTrees: ['rs'] })
  write('dist/versions.json', { schema: 1, ports: { rs: [{ slug: 'stable' }] }, defaultVersion: { rs: 'stable' } })
  write('dist/targets.json', { schema: 1, base: '/en/', targets: [target('rs', 'latest')] })
  write('dist/rs/latest/targets.json', { schema: 1, base: '/en/rs/latest/', scope: 'rs', version: 'latest', targets: [target('rs', 'latest')] })
  const catalog = { schema: 1, base: '/en/rs/stable/', scope: 'rs', version: 'stable', targets: [target(wrongScope ? 'py' : 'rs', 'stable')] }
  if (published) write('published/rs/stable/targets.json', catalog)
  return { path, catalog }
}

function compose(path: string) {
  return execFileSync(process.execPath, [join(root, 'scripts/compose-published-inventory.mjs'), '--directory', 'dist', '--catalogs', 'published', '--runtime', 'inventory-runtime'], { cwd: path, encoding: 'utf8', stdio: 'pipe' })
}

describe('published default inventory composition', () => {
  it('uses the published stable catalog instead of a locally assembled latest tree', () => {
    const { path } = fixture()
    const result = JSON.parse(compose(path))
    const catalog = JSON.parse(readFileSync(join(path, 'dist/targets.json'), 'utf8'))
    expect(catalog.targets.map((target: { version: string }) => target.version)).toEqual(['stable'])
    expect(readInventory(readFileSync(join(path, 'dist/objects-full.inv'))).entries[0].uri).toContain('rs/stable/')
    expect(result.inputs[0].sha256).toBe(createHash('sha256').update(readFileSync(join(path, 'published/rs/stable/targets.json'))).digest('hex'))
  })
  it('replaces stale root compatibility entries with the selected published API', () => {
    const { path } = fixture()
    const file = join(path, 'dist/reference/rs/objects.inv')
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, writeInventoryEntries(['Pane', 'Retired'].map((name) => ({
      name, type: 'std:label', priority: 1, uri: `../../rs/latest/reference/old/#${name}`, dispname: name,
    })), { project: 'libtmux rs', version: 'latest', legacyCaseSensitiveLabels: true }))
    compose(path)
    expect(readInventory(readFileSync(file)).entries.map(({ name, type, uri }) => ({ name, type, uri }))).toEqual([
      { name: 'Pane', type: 'std:label', uri: '../../rs/stable/reference/pane/#Pane' },
    ])
  })
  it('refuses to advertise a default whose catalog has not been published', () => {
    expect(() => compose(fixture(false).path)).toThrow('Publish en/rs/stable/targets.json before advertising')
  })
  it('rejects a catalog containing another port before writing the aggregate', () => {
    const { path } = fixture(true, true)
    const full = join(path, 'dist/objects-full.inv'); writeFileSync(full, 'retained')
    expect(() => compose(path)).toThrow('outside rs/stable')
    expect(readFileSync(full, 'utf8')).toBe('retained')
  })
})
