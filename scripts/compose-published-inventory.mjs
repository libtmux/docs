#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Compose against the final published manifest, including independently owned port trees. */
export async function compose({ directory, runtime, catalogs, bucket, locale }) {
  const out = resolve(directory)
  const { targetEntries, compatibilityEntries, targetKey } = await import(pathToFileURL(resolve(runtime, 'targets.ts')).href)
  const { writeInventoryEntries } = await import(pathToFileURL(resolve(runtime, 'inventory.ts')).href)
  const read = (file) => JSON.parse(readFileSync(file, 'utf8'))
  const manifest = read(resolve(out, 'versions.json'))
  const shared = read(resolve(out, 'targets.json'))
  const ownership = read(resolve('shell-paths.json'))
  const base = `/${locale}/`
  if (shared.base !== base) throw new Error(`Published inventory base differs from ${base}`)
  const targets = shared.targets.filter((target) => target.scope === 'site' || target.scope.startsWith('tmux@'))
  const inputs = []
  const compatibility = []
  for (const [port, versions] of Object.entries(manifest.ports)) {
    if (!versions.length) continue
    const version = manifest.defaultVersion[port]
    if (!versions.some((entry) => entry.slug === version)) throw new Error(`No published default for ${port}/${version}`)
    const relative = `${port}/${version}/targets.json`
    let file = resolve(out, relative)
    if (ownership.portTrees.includes(port) || !existsSync(file)) {
      file = resolve(catalogs, relative)
      if (bucket) {
        mkdirSync(resolve(file, '..'), { recursive: true })
        execFileSync('aws', ['s3', 'cp', `s3://${bucket}/${locale}/${relative}`, file, '--only-show-errors'], { stdio: 'inherit' })
      }
      if (!existsSync(file)) throw new Error(`Publish ${locale}/${relative} before advertising its full inventory`)
    }
    const bytes = readFileSync(file)
    const catalog = JSON.parse(bytes.toString())
    const expectedBase = `${base}${port}/${version}/`
    if (catalog.schema !== 1 || catalog.scope !== port || catalog.version !== version || catalog.base !== expectedBase || !catalog.targets?.length) {
      throw new Error(`Published target catalog has the wrong identity: ${relative}`)
    }
    for (const target of catalog.targets) {
      if (target.scope !== port || target.version !== version || !target.href.startsWith(expectedBase) ||
          !new URL(target.href, 'https://inventory.invalid').pathname.startsWith(expectedBase) || target.key !== targetKey(target)) {
        throw new Error(`Published target is outside ${port}/${version}: ${target.key}`)
      }
    }
    targets.push(...catalog.targets)
    inputs.push({ port, version, catalog: `${base}${relative}`, sha256: createHash('sha256').update(bytes).digest('hex') })
    const entries = compatibilityEntries(catalog.targets, base).map((entry) => ({ ...entry, uri: `../../${entry.uri}` }))
    compatibility.push({
      file: resolve(out, 'reference', port, 'objects.inv'),
      bytes: writeInventoryEntries(entries, { project: `libtmux ${port}`, version, legacyCaseSensitiveLabels: true }),
    })
  }
  targets.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  const options = { project: 'libtmux', version: 'all' }
  // Validate all exports before replacing any artifact file.
  const full = writeInventoryEntries(targetEntries(targets, base), options)
  const legacy = writeInventoryEntries(compatibilityEntries(targets, base, true), { ...options, legacyCaseSensitiveLabels: true })
  for (const { file, bytes } of compatibility) {
    mkdirSync(resolve(file, '..'), { recursive: true })
    writeFileSync(file, bytes)
  }
  writeFileSync(resolve(out, 'objects-full.inv'), full)
  writeFileSync(resolve(out, 'objects.inv'), legacy)
  writeFileSync(resolve(out, 'targets.json'), `${JSON.stringify({ schema: 1, base, defaults: manifest.defaultVersion, coverage: { inputs }, targets })}\n`)
  return { targets: targets.length, inputs }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const options = { runtime: 'packages/api-model/src', catalogs: 'published-catalogs', locale: 'en' }
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i].replace(/^--/, '')
    if (!['directory', 'runtime', 'catalogs', 'bucket', 'locale'].includes(name) || !args[i + 1]) throw new Error(`Unknown or missing argument: ${args[i]}`)
    options[name] = args[i + 1]
  }
  if (!options.directory) throw new Error('Usage: compose-published-inventory.mjs --directory dist [--bucket BUCKET] [--catalogs DIRECTORY] [--runtime DIRECTORY]')
  console.log(JSON.stringify(await compose(options)))
}
