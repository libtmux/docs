#!/usr/bin/env node
/**
 * Check that every badge in the source guides a port stages can be rendered.
 *
 * Staging localizes each guide's shields badges through `badgeSpec`, which
 * throws on a service it has no mapping for. The committed guides were checked
 * when they were cached; a port's trunk README can gain a new badge service
 * afterwards and break that port's publish. This reads the guides from a
 * checkout of the port (its trunk, in the scheduled port-heads workflow) and
 * names the port, file and URL of each badge that would fail.
 *
 * Usage: node scripts/check-port-badges.mjs [--port <slug>] [--require]
 *   The checkout comes from LIBTMUX_DOCS_CHECKOUT_<PORT>, else ports.ts.
 *   --require  fail, instead of skipping, when a port has no checkout.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SOURCE_GUIDE_PORTS } from '../site/src/lib/port-documentation.ts'
import { badgeProblems, readRegistry } from './lib/badges.mjs'
import { resolveCheckout } from './lib/port-checkout.mjs'
import { stagedRoutesFor } from './stage-port-docs.mjs'

const option = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const only = option('--port')
const require = process.argv.includes('--require')
if (only && !SOURCE_GUIDE_PORTS.includes(only)) throw new Error(`check-port-badges: ${only} stages no source guides`)

const registry = readRegistry()
const problems = []
const skipped = []
let files = 0
for (const port of SOURCE_GUIDE_PORTS.filter((slug) => !only || slug === only)) {
  const checkout = resolveCheckout(port, { order: ['checkout'] })
  if (!existsSync(checkout)) {
    skipped.push(port)
    continue
  }
  for (const path of Object.keys(stagedRoutesFor(port))) {
    const file = join(checkout, path)
    if (!existsSync(file)) continue
    files++
    for (const problem of badgeProblems(readFileSync(file, 'utf8'), port, registry)) {
      problems.push(`${port}: ${path}: ${problem.url}: ${problem.reason}`)
    }
  }
}
for (const problem of problems) console.error(`check-port-badges: ${problem}`)
if (skipped.length) console.log(`check-port-badges: no checkout for ${skipped.join(', ')}`)
if (problems.length || (require && skipped.length)) process.exit(1)
console.log(`check-port-badges: ${files} guide files read, every badge renders`)
