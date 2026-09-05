#!/usr/bin/env node
/*
 * Cross-references that resolve, per port, with a floor.
 *
 * A doc comment that says `Server.sessions` should render as a link to that
 * page. When resolution breaks the text still renders — just as plain code —
 * so nothing fails, no link is broken, and `check-links` is perfectly happy.
 * The page simply stops being useful.
 *
 * That is not hypothetical. Memoising the symbol index per port let the
 * reference landing route, which has no model and passes an empty stub,
 * claim the `py` cache key; every Python page built after it resolved against
 * an index of nothing. Python went from 74 resolved cross-references on
 * `libtmux.Server` to 3 while the other seven ports were untouched, and every
 * gate stayed green.
 *
 * So: count what resolved, per port, and refuse to let it fall. A floor
 * rather than an exact number, because adding symbols legitimately moves it.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
/* `--floor` points at a different record so `check-xrefs.negative.mjs` can
 * drive this script rather than a copy of its logic. */
const floorArg = process.argv.indexOf('--floor')
const FLOOR_FILE =
  floorArg === -1 ? join(root, 'scripts/xref-floor.json') : process.argv[floorArg + 1]
const PORTS = ['py', 'ts', 'rs', 'go', 'java', 'dotnet', 'cxx', 'swift']

const args = process.argv.slice(2)
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--floor')
const site = positional[0] ?? join(root, '_site')

/** Anchors that carry a resolved cross-reference, however it was written. */
const RESOLVED = 'api-literal--link|api-type-link|api-xref'

function countIn(dir) {
  if (!existsSync(dir)) return 0
  try {
    const out = execFileSync('rg', ['-o', '--no-filename', '-c', RESOLVED, dir], {
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    })
    return out.split('\n').reduce((n, line) => n + (Number(line) || 0), 0)
  } catch {
    return 0
  }
}

const counts = Object.fromEntries(
  PORTS.map((p) => [p, countIn(join(site, 'reference', p))]),
)

if (args.includes('--update')) {
  /*
   * A ratchet, not a setting.
   *
   * `--update` used to write whatever the count happened to be, including a
   * lower one — so the honest response to a regression and the honest
   * response to an improvement were the same keystroke, and the floor would
   * follow a collapse straight down. Lowering one now needs `--force` and a
   * reason in the commit that does it.
   */
  const existing = existsSync(FLOOR_FILE) ? JSON.parse(readFileSync(FLOOR_FILE, 'utf8')) : {}
  const lowered = PORTS.filter((p) => counts[p] < (existing[p] ?? 0))
  if (lowered.length && !args.includes('--force')) {
    console.error(
      `check-xrefs: refusing to lower the floor for ${lowered.join(', ')}.\n` +
        lowered.map((p) => `    ${p}: ${existing[p]} -> ${counts[p]}`).join('\n') +
        `\n\nA floor that follows a fall is not a floor. If fewer cross-references\n` +
        `is the intended outcome of a deliberate change, say so and pass --force.`,
    )
    process.exit(1)
  }
  writeFileSync(FLOOR_FILE, `${JSON.stringify(counts, null, 2)}\n`)
  console.log('check-xrefs: floors written')
  for (const [p, n] of Object.entries(counts)) console.log(`  ${p.padEnd(7)} ${n}`)
  process.exit(0)
}

if (!existsSync(FLOOR_FILE)) {
  console.error(`check-xrefs: no floor recorded — run node scripts/check-xrefs.mjs --update`)
  process.exit(1)
}
const floor = JSON.parse(readFileSync(FLOOR_FILE, 'utf8'))

/*
 * A port absent from the record is not a port whose floor is zero.
 * Defaulting it to zero makes this check unfailable for that port: the
 * collapse above could take it to nothing and the run would print `up` and
 * exit clean. A renamed slug reaches this branch, which is the case worth
 * stopping for.
 */
const unrecorded = PORTS.filter((p) => !(p in floor))
if (unrecorded.length) {
  console.error(
    `check-xrefs: no floor recorded for ${unrecorded.join(', ')}.\n` +
      `A port with no floor cannot fail this check. Record one:\n` +
      `  node scripts/check-xrefs.mjs --update`,
  )
  process.exit(1)
}

const below = PORTS.filter((p) => counts[p] < floor[p])
for (const p of PORTS) {
  const f = floor[p]
  const mark = counts[p] < f ? 'FELL' : counts[p] > f ? 'up' : 'ok'
  console.log(`${p.padEnd(7)} ${String(counts[p]).padStart(7)} resolved  (floor ${f})  ${mark}`)
}

if (below.length) {
  console.error(
    `\ncheck-xrefs: resolution fell on ${below.join(', ')}.\n` +
      `Cross-references still render, as plain code, so nothing else fails —\n` +
      `that is why this check exists. Something stopped the symbol index\n` +
      `resolving for these ports. If the drop is deliberate, lower the floor:\n` +
      `  node scripts/check-xrefs.mjs --update`,
  )
  process.exit(1)
}

const risen = PORTS.filter((p) => counts[p] > floor[p])
if (risen.length) {
  console.log(`\ncheck-xrefs: resolution rose on ${risen.join(', ')} — raise the floor:`)
  console.log(`  node scripts/check-xrefs.mjs --update`)
}
console.log(`\ncheck-xrefs: every port at or above its floor`)
