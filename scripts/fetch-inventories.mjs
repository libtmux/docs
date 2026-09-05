#!/usr/bin/env node
/**
 * Cache the `objects.inv` files this site resolves against.
 *
 * `link.ts` carries a hand-written table of 22 CPython names. CPython's real
 * inventory has thousands, and two entries were already missing from the table
 * — `subprocess.Popen` and `dataclasses.dataclass` — with nothing to report
 * it. An inventory is the mechanism intersphinx uses for exactly this, and it
 * is one file per project.
 *
 * Cached rather than fetched at build time: the site builds fourteen times per
 * assembly, and a docs build should not need the network. Committed, small,
 * and refreshed by re-running this.
 *
 * Usage: node scripts/fetch-inventories.mjs [--check]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readInventory } from '../packages/api-model/src/inventory.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(repoRoot, 'site/src/data/inventories')

/**
 * Only projects this site's own annotations actually mention.
 *
 * A bigger set is not better: every entry is a name the resolver might match,
 * and matching `str` against some unrelated project's `str` would produce a
 * confidently wrong link.
 */
const SOURCES = {
  python: 'https://docs.python.org/3/objects.inv',
}

const check = process.argv.includes('--check')
/**
 * A JSON sidecar beside each `.inv`, because a bundler cannot see the `.inv`.
 *
 * `indexFor` resolved the inventory path from `import.meta.url` and checked
 * `existsSync`. Under Vite that path moves, the check failed silently, and the
 * federation was dead in every build for as long as it existed — 6,253 Python
 * links that all came from a hand-written fallback table, identical with the
 * inventory present and absent. A static `import` of JSON is what the API
 * models already do here, and it fails loudly when the file is missing.
 *
 * The `.inv` stays: it is the artifact Sphinx consumes and what the
 * round-trip tests validate. The sidecar is written from the same bytes in
 * the same run, and a test asserts they agree.
 */
function writeSidecar(name, bytes) {
  const { project, version, entries } = readInventory(bytes)
  // Name and URI only: those are the two fields a lookup reads, and carrying
  // the domain, role, priority and dispname as well tripled the file for
  // nothing. Short keys for the same reason — this is a build input, not
  // something anyone reads.
  writeFileSync(
    join(outDir, `${name}.entries.json`),
    `${JSON.stringify({ project, version, e: entries.map((x) => [x.name, x.uri]) })}\n`,
  )
}

mkdirSync(outDir, { recursive: true })

let failed = 0
for (const [name, url] of Object.entries(SOURCES)) {
  const out = join(outDir, `${name}.inv`)
  if (check) {
    if (!existsSync(out)) {
      console.error(`fetch-inventories: ${name}.inv missing — run without --check`)
      failed++
      continue
    }
    const { project, entries } = readInventory(readFileSync(out))
    console.log(`fetch-inventories: ${name}.inv ok (${project}, ${entries.length} entries)`)
    continue
  }

  try {
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const bytes = Buffer.from(await res.arrayBuffer())
    // Parse before writing: a captive portal's HTML error page is still a
    // 200, and a corrupt cache would degrade every link silently.
    const { project, entries } = readInventory(bytes)
    writeFileSync(out, bytes)
    writeSidecar(name, bytes)
    console.log(`fetch-inventories: ${name} -> ${entries.length} entries (${project}) ${(bytes.length / 1024).toFixed(0)} KB`)
  } catch (err) {
    console.error(`fetch-inventories: ${name} failed — ${err.message}`)
    failed++
  }
}
process.exit(failed ? 1 : 0)
