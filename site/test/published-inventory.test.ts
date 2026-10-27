import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  write('dist/versions.json', { schema: 1, ports: { rs: [{ slug: 'v0.1.0' }] }, defaultVersion: { rs: 'v0.1.0' } })
  write('dist/targets.json', { schema: 1, base: '/en/', targets: [target('rs', 'latest')] })
  write('dist/rs/latest/targets.json', { schema: 1, base: '/en/rs/latest/', scope: 'rs', version: 'latest', targets: [target('rs', 'latest')] })
  const catalog = { schema: 1, base: '/en/rs/v0.1.0/', scope: 'rs', version: 'v0.1.0', targets: [target(wrongScope ? 'py' : 'rs', 'v0.1.0')] }
  if (published) write('published/rs/v0.1.0/targets.json', catalog)
  return { path, catalog }
}

function compose(path: string, extra: string[] = [], env: NodeJS.ProcessEnv = process.env) {
  return execFileSync(process.execPath, [join(root, 'scripts/compose-published-inventory.mjs'), '--directory', 'dist', '--catalogs', 'published', '--runtime', 'inventory-runtime', ...extra], { cwd: path, encoding: 'utf8', stdio: 'pipe', env })
}

/** Add ports whose default catalogs are published; the rest stay absent. */
function addPorts(path: string, ports: Record<string, boolean>) {
  const read = (file: string) => JSON.parse(readFileSync(join(path, file), 'utf8'))
  const write = (file: string, object: unknown) => writeFileSync(join(path, file), JSON.stringify(object))
  const manifest = read('dist/versions.json')
  for (const [port, published] of Object.entries(ports)) {
    manifest.ports[port] = [{ slug: 'v1.0.0' }]
    manifest.defaultVersion[port] = 'v1.0.0'
    if (!published) continue
    const value = { scope: port, version: 'v1.0.0', product: 'core', category: 'api', identity: 'Pane', display: 'Pane', href: `/en/${port}/v1.0.0/reference/pane/#Pane` }
    const target = { ...value, key: targetKey(value), legacy: [{ type: 'std:label', name: 'Pane' }] }
    mkdirSync(join(path, `published/${port}/v1.0.0`), { recursive: true })
    write(`published/${port}/v1.0.0/targets.json`, { schema: 1, base: `/en/${port}/v1.0.0/`, scope: port, version: 'v1.0.0', targets: [target] })
  }
  write('dist/versions.json', manifest)
}

/** A fake `aws` on PATH that fails every call with the given stderr. */
function fakeAws(path: string, stderr: string) {
  const bin = join(path, 'bin'); mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'aws'), `#!/bin/sh\ncat >&2 <<'EOF'\n${stderr}\nEOF\nexit 1\n`)
  chmodSync(join(bin, 'aws'), 0o755)
  return { ...process.env, PATH: `${bin}:${process.env.PATH}` }
}
const resultOf = (output: string) => JSON.parse(output.trim().split('\n').at(-1) as string)

describe('published default inventory composition', () => {
  it('uses the published release catalog instead of a locally assembled latest tree', () => {
    const { path } = fixture()
    const result = JSON.parse(compose(path))
    const catalog = JSON.parse(readFileSync(join(path, 'dist/targets.json'), 'utf8'))
    expect(catalog.targets.map((target: { version: string }) => target.version)).toEqual(['v0.1.0'])
    expect(readInventory(readFileSync(join(path, 'dist/objects-full.inv'))).entries[0].uri).toContain('rs/v0.1.0/')
    expect(result.inputs[0].sha256).toBe(createHash('sha256').update(readFileSync(join(path, 'published/rs/v0.1.0/targets.json'))).digest('hex'))
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
      { name: 'Pane', type: 'std:label', uri: '../../rs/v0.1.0/reference/pane/#Pane' },
    ])
  })
  it('leaves out a port whose default catalog is absent and reports it', () => {
    const { path } = fixture()
    addPorts(path, { py: false })
    mkdirSync(join(path, 'dist/reference/py'), { recursive: true })
    writeFileSync(join(path, 'dist/reference/py/objects.inv'), 'stale')
    const output = compose(path)
    expect(output).toContain('py/v1.0.0')
    const catalog = JSON.parse(readFileSync(join(path, 'dist/targets.json'), 'utf8'))
    expect(catalog.coverage.missing).toEqual([{ port: 'py', version: 'v1.0.0', catalog: '/en/py/v1.0.0/targets.json' }])
    expect(catalog.coverage.inputs.map((input: { port: string }) => input.port)).toEqual(['rs'])
    expect(catalog.targets.map((target: { scope: string }) => target.scope)).toEqual(['rs'])
    expect(readInventory(readFileSync(join(path, 'dist/objects-full.inv'))).entries.map(({ uri }) => uri).join()).not.toContain('py/')
    expect(() => readFileSync(join(path, 'dist/reference/py/objects.inv'))).toThrow()
    expect(readFileSync(join(path, 'dist/reference/rs/objects.inv')).length).toBeGreaterThan(0)
  })
  it('composes an absent default from the port latest catalog and reports the fallback', () => {
    const { path } = fixture()
    addPorts(path, { py: false })
    const value = { scope: 'py', version: 'latest', product: 'core', category: 'api', identity: 'Pane', display: 'Pane', href: '/en/py/latest/reference/pane/#Pane' }
    const target = { ...value, key: targetKey(value), legacy: [{ type: 'std:label', name: 'Pane' }] }
    const latest = { schema: 1, base: '/en/py/latest/', scope: 'py', version: 'latest', targets: [target] }
    mkdirSync(join(path, 'published/py/latest'), { recursive: true })
    writeFileSync(join(path, 'published/py/latest/targets.json'), JSON.stringify(latest))
    const output = compose(path)
    expect(output).toContain('py/latest')
    const catalog = JSON.parse(readFileSync(join(path, 'dist/targets.json'), 'utf8'))
    expect(catalog.coverage.fallback).toEqual([{ port: 'py', default: 'v1.0.0', used: 'latest', catalog: '/en/py/latest/targets.json' }])
    expect(catalog.coverage.missing).toEqual([])
    expect(catalog.targets.filter((entry: { scope: string }) => entry.scope === 'py').map((entry: { href: string }) => entry.href)).toEqual(['/en/py/latest/reference/pane/#Pane'])
    expect(readInventory(readFileSync(join(path, 'dist/reference/py/objects.inv'))).entries[0].uri).toBe('../../py/latest/reference/pane/#Pane')
    // A latest catalog gets the same identity checks as any other.
    writeFileSync(join(path, 'published/py/latest/targets.json'), JSON.stringify({ ...latest, base: '/en/py/v0.1.0/' }))
    expect(() => compose(path)).toThrow('wrong identity')
  })
  it('removes the legacy port inventory when neither default nor latest is published', () => {
    const { path } = fixture()
    addPorts(path, { py: false })
    const file = join(path, 'dist/reference/py/objects.inv')
    mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, 'stale')
    compose(path)
    expect(existsSync(file)).toBe(false)
  })
  it('composes a site and tmux only inventory when no default catalog is published', () => {
    const { path } = fixture(false)
    const target = (scope: string) => { const value = { scope, version: scope === 'tmux@3.7c' ? '3.7c' : 'latest', product: 'core', category: 'api', identity: 'Site', display: 'Site', href: '/en/site/' }; return { ...value, key: targetKey(value), legacy: [{ type: 'std:label', name: 'Site' }] } }
    writeFileSync(join(path, 'dist/targets.json'), JSON.stringify({ schema: 1, base: '/en/', targets: [target('site'), target('tmux@3.7c'), target('rs')] }))
    addPorts(path, { py: false, go: false })
    const result = resultOf(compose(path))
    expect(result.missing.map(({ port }: { port: string }) => port)).toEqual(['rs', 'py', 'go'])
    const catalog = JSON.parse(readFileSync(join(path, 'dist/targets.json'), 'utf8'))
    expect(catalog.coverage.inputs).toEqual([])
    expect(catalog.targets.map((entry: { scope: string }) => entry.scope).sort()).toEqual(['site', 'tmux@3.7c'])
    expect(readInventory(readFileSync(join(path, 'dist/objects-full.inv'))).entries.length).toBe(2)
  })
  it('treats an S3 404 as absent', () => {
    const { path } = fixture(false)
    const env = fakeAws(path, 'fatal error: An error occurred (404) when calling the HeadObject operation: Key "en/rs/v0.1.0/targets.json" does not exist')
    expect(resultOf(compose(path, ['--bucket', 'bucket'], env)).missing).toHaveLength(1)
  })
  it('still fails on an aws error that is not a missing object', () => {
    const { path } = fixture(false)
    const env = fakeAws(path, 'fatal error: An error occurred (403) when calling the HeadObject operation: Forbidden')
    const full = join(path, 'dist/objects-full.inv'); writeFileSync(full, 'retained')
    expect(() => compose(path, ['--bucket', 'bucket'], env)).toThrow('Forbidden')
    expect(readFileSync(full, 'utf8')).toBe('retained')
  })
  it('still fails when a published catalog has the wrong identity', () => {
    const { path, catalog } = fixture()
    writeFileSync(join(path, 'published/rs/v0.1.0/targets.json'), JSON.stringify({ ...catalog, base: '/en/rs/other/' }))
    expect(() => compose(path)).toThrow('wrong identity')
  })
  it('still fails when a default version is not in the manifest', () => {
    const { path } = fixture()
    const file = join(path, 'dist/versions.json')
    const manifest = JSON.parse(readFileSync(file, 'utf8')); manifest.defaultVersion.rs = 'v9'
    writeFileSync(file, JSON.stringify(manifest))
    expect(() => compose(path)).toThrow('No published default for rs/v9')
  })
  it('rejects a catalog containing another port before writing the aggregate', () => {
    const { path } = fixture(true, true)
    const full = join(path, 'dist/objects-full.inv'); writeFileSync(full, 'retained')
    expect(() => compose(path)).toThrow('outside rs/v0.1.0')
    expect(readFileSync(full, 'utf8')).toBe('retained')
  })
})
