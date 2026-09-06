#!/usr/bin/env node
/*
 * The reference sidebar's curation, checked against the model it curates.
 *
 * Reads the compiled `<port>.nav.json` sidecars rather than recompiling from
 * the configuration. The sidecar is what a page renders, so linting the
 * artifact is the only way lint and render cannot disagree.
 *
 * Four failures, each naming what it found:
 *
 *   unmatched  a symbol no bucket claims. Curation rotting as a port grows.
 *   dead       a bucket that claims nothing in ANY port. A rule that has
 *              stopped matching, usually because a type was renamed.
 *   ambiguous  a symbol two unrelated buckets claim. Order-dependent, so the
 *              sidebar would change under an unrelated edit.
 *   stale      an `unsettled` entry that now matches. An exemption outliving
 *              its reason.
 *   orphaned   a bucket holding symbols that the bucket tree does not
 *              contain, so nothing renders it. Splitting the large buckets
 *              into children put 83 of Rust's symbols in exactly this state:
 *              every page still built, every link still resolved, and the
 *              sidebar simply stopped listing them.
 *
 * A bucket empty in SOME ports is not a failure and is reported separately:
 * the buckets are shared vocabulary across eight ports, and Python having no
 * MCP types is a fact about Python, not a broken rule.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const json = process.argv.includes('--json')
/*
 * `--dir` points the checks at fixture sidecars instead of the real ones.
 * It exists so `check-nav.negative.mjs` can prove each check fails on input
 * that should fail it, driving this script rather than a copy of its logic.
 */
const dirArg = process.argv.indexOf('--dir')
const dir = dirArg === -1 ? join(root, 'site/src/data/api') : process.argv[dirArg + 1]
/*
 * From ports.ts on a real run, like every other check in this directory. The
 * literal that stood here was one more hand-kept copy of the port list, and
 * the one place a ninth port would have been skipped in silence rather than
 * reported: a port absent from the list is a port whose nav is never checked.
 * A fixture run still derives its ports from the fixture, since that is the
 * whole point of `--dir`.
 */
const { PORTS: PORT_DEFS } = await import(`file://${join(root, 'site/src/lib/ports.ts')}`)
const PORTS =
  dirArg === -1
    ? PORT_DEFS.map((p) => p.slug)
    : readdirSync(dir)
        .filter((f) => f.endsWith('.nav.json'))
        .map((f) => f.replace('.nav.json', ''))

const navs = []
const missing = []
for (const port of PORTS) {
  const file = join(dir, `${port}.nav.json`)
  if (!existsSync(file)) missing.push(port)
  else navs.push(JSON.parse(readFileSync(file, 'utf8')))
}
if (missing.length) {
  console.error(`check-nav: no sidecar for ${missing.join(', ')} — run scripts/gen-api-model.mjs`)
  process.exit(1)
}

/** Bucket ids that claimed at least one symbol somewhere, and where. */
const liveSomewhere = new Set()
const emptyIn = new Map()
for (const nav of navs) {
  for (const [bucket, members] of Object.entries(nav.assignments)) {
    if (members.length) liveSomewhere.add(bucket)
    else emptyIn.set(bucket, [...(emptyIn.get(bucket) ?? []), nav.port])
  }
}

const failures = []
const label = (nav, id) => nav.unplaced.find((s) => s.id === id)?.name ?? id

/** Every bucket id in the tree, children included — what a page can render. */
const renderable = (buckets) =>
  buckets.flatMap((b) => [b.id, ...renderable(b.children ?? [])])

for (const nav of navs) {
  const d = nav.diagnostics
  if (d.unmatched.length)
    failures.push({
      check: 'unmatched',
      port: nav.port,
      detail: `${d.unmatched.length} symbols no bucket claims`,
      names: d.unmatched.map((id) => label(nav, id)),
    })
  if (d.ambiguous.length)
    failures.push({
      check: 'ambiguous',
      port: nav.port,
      detail: `${d.ambiguous.length} symbols claimed by two unrelated buckets`,
      names: d.ambiguous.map((a) => `${a.id} (${a.buckets.join(' + ')})`),
    })
  const rendered = new Set(renderable(nav.buckets))
  const orphaned = Object.entries(nav.assignments).filter(
    ([bucket, members]) => members.length > 0 && !rendered.has(bucket),
  )
  if (orphaned.length)
    failures.push({
      check: 'orphaned',
      port: nav.port,
      detail: `${orphaned.length} buckets hold symbols the tree never renders`,
      names: orphaned.map(([b, m]) => `${b} (${m.length} symbols)`),
    })
  if (d.staleUnsettled.length)
    failures.push({
      check: 'stale',
      port: nav.port,
      detail: `${d.staleUnsettled.length} unsettled entries that now match`,
      names: d.staleUnsettled,
    })
}

const dead = [...emptyIn.keys()].filter((b) => !liveSomewhere.has(b))
if (dead.length)
  failures.push({
    check: 'dead',
    port: 'all',
    detail: `${dead.length} buckets claim nothing in any port`,
    names: dead,
  })

if (json) {
  console.log(JSON.stringify({ failures, emptySomewhere: Object.fromEntries(emptyIn) }, null, 2))
  process.exit(failures.length ? 1 : 0)
}

for (const nav of navs) {
  const placed = Object.values(nav.assignments).reduce((n, m) => n + m.length, 0)
  console.log(
    `${nav.port.padEnd(7)} ${String(placed).padStart(4)} placed  ${String(nav.unplaced.length).padStart(3)} unplaced  ` +
      `${Object.values(nav.assignments).filter((m) => m.length).length}/${Object.keys(nav.assignments).length} buckets used`,
  )
}

const sharedEmpty = [...emptyIn].filter(([b]) => liveSomewhere.has(b))
if (sharedEmpty.length) {
  console.log(`\nshared buckets a port simply has none of (not a failure):`)
  for (const [b, ports] of sharedEmpty) console.log(`  ${b.padEnd(13)} absent in ${ports.join(' ')}`)
}

if (!failures.length) {
  console.log(`\ncheck-nav: ${navs.length} ports, every symbol placed or named, no dead rules`)
  process.exit(0)
}

console.error('')
for (const f of failures) {
  console.error(`check-nav: ${f.check} [${f.port}] — ${f.detail}`)
  for (const n of f.names) console.error(`    ${n}`)
}
console.error(
  `\n${failures.length} failing checks. Place these in a bucket, or record them in ` +
    `\`unsettled\` in packages/api-model/src/nav-config.ts with the reason they are unplaced.`,
)
process.exit(1)
