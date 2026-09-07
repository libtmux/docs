#!/usr/bin/env node
/**
 * Generate the port table embedded in `site/public/_shell/shell.js`.
 *
 * That file is injected verbatim into rustdoc, Dokka, DocC and Sphinx output,
 * so it runs with no bundler and cannot import `site/src/lib/ports.ts`. The
 * table was therefore a hand-kept copy, and it had already drifted: its own
 * comment named a `referenceMode` field that `ports.ts` no longer has.
 *
 * A copy is unavoidable; a copy nothing checks is not. This writes the block
 * between the two markers from `ports.ts`, and `--check` fails when the file
 * on disk differs — the same shape as `gen-api-model.mjs --check`, which
 * exists because committed generated data rots silently otherwise.
 *
 * Usage:
 *   node scripts/gen-shell-ports.mjs           # rewrite the block
 *   node scripts/gen-shell-ports.mjs --check   # fail if it is stale
 *   node scripts/gen-shell-ports.mjs --file X  # operate on X (negative test)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fileArg = process.argv.indexOf('--file')
const target = fileArg === -1 ? join(root, 'site/public/_shell/shell.js') : process.argv[fileArg + 1]
const check = process.argv.includes('--check')

const { PORTS } = await import(`file://${resolve(root, 'site/src/lib/ports.ts')}`)

const BEGIN = '  // >>> generated from site/src/lib/ports.ts by scripts/gen-shell-ports.mjs'
const END = '  // <<< end generated'

const rows = PORTS.map((p) => ({
  slug: p.slug,
  name: p.name,
  versionedDocs: p.versionedDocs,
}))

// Two spaces of body indent inside the IIFE, matching the file around it.
const body = rows.map((r) => `    ${JSON.stringify(r)},`).join('\n')
const block = `${BEGIN}\n  var PORTS = [\n${body}\n  ]\n${END}`

const source = readFileSync(target, 'utf8')
const begin = source.indexOf(BEGIN)
const end = source.indexOf(END)
if (begin === -1 || end === -1) {
  console.error(`gen-shell-ports: ${target} has no generated block.`)
  console.error(`Expected a region delimited by:\n${BEGIN}\n${END}`)
  process.exit(1)
}

const next = `${source.slice(0, begin)}${block}${source.slice(end + END.length)}`

if (check) {
  if (next !== source) {
    console.error(`gen-shell-ports: ${target.replace(`${root}/`, '')} is stale.`)
    console.error(`${PORTS.length} ports in site/src/lib/ports.ts; rerun:`)
    console.error('  node scripts/gen-shell-ports.mjs')
    process.exit(1)
  }
  console.log(`gen-shell-ports: shell.js matches ports.ts (${PORTS.length} ports)`)
} else {
  writeFileSync(target, next)
  console.log(`gen-shell-ports: wrote ${PORTS.length} ports into ${target.replace(`${root}/`, '')}`)
}
