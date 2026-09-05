#!/usr/bin/env node
/*
 * The edge function's file-versus-page test, held to what the build emits.
 *
 * `infra/cloudfront-function.js` decides "is this a file?" from an allowlist
 * of extensions and redirects anything else to a trailing-slash URL. Deciding
 * it by "contains a dot" instead is not equivalent — a version tag, a .NET
 * type name and a locale-tagged path all carry one — so the allowlist is the
 * right shape. A hand-kept one is not: a generator adding a file type breaks
 * a URL class with nothing reporting it.
 *
 * The failure this exists for is specific. `objects.inv` is how an external
 * Sphinx project resolves an intersphinx reference into this site. Absent from
 * the allowlist it is redirected to a trailing slash and 403s, and every
 * cross-reference from every other project stops resolving — while every link
 * check here still passes, because nothing in this repository links to it.
 *
 * Usage: node scripts/check-edge-extensions.mjs [site-dir] [--function <path>]
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const fnIndex = args.indexOf('--function')
const fnPath = fnIndex === -1 ? join(repoRoot, 'infra', 'cloudfront-function.js') : args[fnIndex + 1]
const siteDir = args.find((a) => !a.startsWith('--') && a !== fnPath) ?? join(repoRoot, '_site')

if (!existsSync(siteDir)) {
  console.error(`check-edge-extensions: no site at ${siteDir} — run ./scripts/build-site.sh`)
  process.exit(1)
}

const source = readFileSync(fnPath, 'utf8')
const table = source.match(/const ASSET_EXTENSIONS = \{([\s\S]*?)\n\}/)
if (!table) {
  console.error(`check-edge-extensions: no ASSET_EXTENSIONS table in ${fnPath}`)
  process.exit(1)
}
const allowed = new Set([...table[1].matchAll(/([A-Za-z0-9_]+)\s*:\s*1/g)].map((m) => m[1].toLowerCase()))

/** Extensions actually present, and one example path each. */
const found = new Map()
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full)
      continue
    }
    const dot = entry.lastIndexOf('.')
    if (dot <= 0) continue
    const ext = entry.slice(dot + 1).toLowerCase()
    if (!found.has(ext)) found.set(ext, full.slice(siteDir.length))
  }
}
walk(siteDir)

const missing = [...found.keys()].filter((e) => !allowed.has(e)).sort()
if (missing.length) {
  console.error(`check-edge-extensions: the edge function would redirect these away from their own files.`)
  for (const ext of missing) console.error(`  .${ext.padEnd(12)} e.g. ${found.get(ext)}`)
  console.error(`\nAdd them to ASSET_EXTENSIONS in ${fnPath.slice(repoRoot.length + 1)}.`)
  process.exit(1)
}

// An allowlisted extension the tree never emits is not a failure — a generator
// may be absent on this machine — but an allowlist that has drifted far from
// the tree is worth seeing, so say which are unused rather than staying quiet.
const unused = [...allowed].filter((e) => !found.has(e)).sort()
console.log(`check-edge-extensions: ${found.size} extensions in the tree, all allowlisted`)
if (unused.length) console.log(`  allowlisted but not emitted here: ${unused.join(' ')}`)
