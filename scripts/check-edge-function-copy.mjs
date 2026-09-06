#!/usr/bin/env node
/*
 * The Terraform copy of the viewer-request function matches this one.
 *
 * `infra/cloudfront-function.js` is where the function is developed, reviewed
 * and checked — `check-edge-extensions.mjs` derives its extension allowlist
 * from a real build. What CloudFront actually runs is whatever
 * `terraform/sites/libtmux.org/cloudfront-function.js` holds in the
 * infrastructure repository, because Terraform cannot read across
 * repositories and a `file()` reference must point inside its own module.
 *
 * So there are two copies, and the interesting failure is silent: this one is
 * edited, the checks here pass, and the deployed edge keeps the old logic
 * until someone applies a Terraform change that happens to touch the file.
 * The extension allowlist is exactly the kind of edit that would go
 * unnoticed — nothing in either repository links an `objects.inv`.
 *
 * Skips when the infrastructure checkout is absent, the same way
 * `check-source-links.mjs` skips a port whose sibling checkout is missing: a
 * fresh clone of this repository alone must still pass.
 *
 * Usage:
 *   node scripts/check-edge-function-copy.mjs
 *   node scripts/check-edge-function-copy.mjs --ours A --theirs B
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? fallback : process.argv[i + 1]
}

const expandHome = (p) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)

const ours = resolve(arg('--ours', join(root, 'infra', 'cloudfront-function.js')))
const tfConfig = expandHome(process.env.LIBTMUX_TF_CONFIG ?? '~/work/tf-config')
const theirs = resolve(
  arg('--theirs', join(tfConfig, 'terraform', 'sites', 'libtmux.org', 'cloudfront-function.js')),
)

if (!existsSync(ours)) {
  console.error(`check-edge-function-copy: no function at ${ours}`)
  process.exit(1)
}

if (!existsSync(theirs)) {
  console.log(
    `check-edge-function-copy: skipped — no infrastructure checkout at ${tfConfig}\n` +
      '  (set LIBTMUX_TF_CONFIG to point at one)',
  )
  process.exit(0)
}

const a = readFileSync(ours, 'utf8')
const b = readFileSync(theirs, 'utf8')

if (a === b) {
  console.log('check-edge-function-copy: the deployed copy matches infra/cloudfront-function.js')
  process.exit(0)
}

/** The first line that differs, so the report names a place rather than a size. */
const al = a.split('\n')
const bl = b.split('\n')
let i = 0
while (i < al.length && i < bl.length && al[i] === bl[i]) i += 1

console.error('check-edge-function-copy: the Terraform copy has drifted from this repository.')
console.error(`  ours:   ${ours}`)
console.error(`  theirs: ${theirs}`)
console.error(`  first difference at line ${i + 1}:`)
console.error(`    ours:   ${al[i] ?? '<end of file>'}`)
console.error(`    theirs: ${bl[i] ?? '<end of file>'}`)
console.error('\nCopy this repository\'s function over the Terraform one and commit it there:')
console.error(`  cp ${ours} ${theirs}`)
process.exit(1)
