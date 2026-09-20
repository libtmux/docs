#!/usr/bin/env node
// Merge successfully published per-port manifest fragments into the runtime
// manifest served by both version switchers.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

function fail(message) {
  throw new Error(`merge-version-manifests: ${message}`)
}

function parseArgs(argv) {
  const options = { base: undefined, fragments: undefined, out: undefined }
  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i]
    if (argument === '--base') options.base = argv[++i]
    else if (argument === '--fragments') options.fragments = argv[++i]
    else if (argument === '--out') options.out = argv[++i]
    else fail(`unrecognised argument ${argument}`)
  }
  if (!options.base || !options.fragments || !options.out) {
    fail('usage: --base FILE --fragments DIRECTORY --out FILE')
  }
  return options
}

function readManifest(path) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  if (manifest.schema !== 1 || typeof manifest.ports !== 'object' || typeof manifest.defaultVersion !== 'object') {
    fail(`${path} is not a version manifest`)
  }
  return manifest
}

export function merge(base, fragments) {
  const merged = structuredClone(base)
  for (const { port, manifest } of fragments) {
    const owned = Object.keys(manifest.ports)
    if (owned.some((candidate) => candidate !== port)) {
      fail(`${port}.json contains another port: ${owned.join(', ')}`)
    }
    const entries = manifest.ports[port] ?? []
    if (entries.some((entry) => entry.kind === 'pr' || /^pr-\d+$/.test(entry.slug))) {
      fail(`${port}.json contains a preview entry`)
    }
    const slugs = new Set(entries.map((entry) => entry.slug))
    const selectedDefault = manifest.defaultVersion[port]
    if (selectedDefault && !slugs.has(selectedDefault)) {
      fail(`${port}.json default ${selectedDefault} has no published entry`)
    }
    merged.ports[port] = entries
    if (selectedDefault) merged.defaultVersion[port] = selectedDefault
  }
  return merged
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const directory = resolve(options.fragments)
  const fragments = existsSync(directory)
    ? readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => ({
        port: basename(entry.name, '.json'),
        manifest: readManifest(resolve(directory, entry.name)),
      }))
    : []
  const result = merge(readManifest(resolve(options.base)), fragments)
  writeFileSync(resolve(options.out), `${JSON.stringify(result, null, 2)}\n`)
  process.stderr.write(`merge-version-manifests: merged ${fragments.length} published port fragment(s)\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
