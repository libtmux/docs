#!/usr/bin/env node
/**
 * Cache the example sources that prose inlines, so a build needs no port
 * checkouts.
 *
 * `remark-port-code.mjs` turns a fence like
 *
 *     ```typescript file="examples/quickstart/quickstart.ts"
 *
 * into the real contents of that file, read out of the port's own checkout.
 * That is the point: the code on the page is the code the port tests, and a
 * missing source fails the build rather than shipping an empty fence.
 *
 * It also means the build cannot run anywhere the eight checkouts are absent,
 * which is every CI runner. This writes what those fences resolve to into a
 * committed file, exactly as `gen-api-model.mjs` does for the extracted
 * models and for the same reason — CI builds from committed data, and
 * `--check` is what stops that data rotting, since nothing else compares it
 * against the source it came from.
 *
 * Whole files are cached, not the sliced regions: `sliceRegion` stays the one
 * implementation, so a cached read and a live read cannot disagree about what
 * a region means.
 *
 * Usage:
 *   node scripts/gen-example-sources.mjs             # rewrite the cache
 *   node scripts/gen-example-sources.mjs --check     # fail if it is stale
 *   node scripts/gen-example-sources.mjs --out PATH  # a fixture, for the
 *                                                    # negative test
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const plugin = join(root, 'site/src/plugins/remark-port-code.mjs')
const { LANG_TO_PORT, checkoutFor, parseMeta } = await import(`file://${plugin}`)

const CONTENT = join(root, 'site/src/content/docs')
const outArg = process.argv.indexOf('--out')
const OUT = outArg === -1 ? join(root, 'site/src/data/example-sources.json') : resolve(process.argv[outArg + 1])
const check = process.argv.includes('--check')

/** Every Markdown file under the content collection. */
function markdownFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...markdownFiles(full))
    else if (/\.mdx?$/.test(name)) out.push(full)
  }
  return out
}

/*
 * Every (port, file) a fence names. The region is deliberately dropped: the
 * cache holds whole files, and two fences quoting different regions of one
 * file are one entry.
 */
const wanted = new Map()
for (const md of markdownFiles(CONTENT)) {
  const text = readFileSync(md, 'utf8')
  for (const m of text.matchAll(/^```(\w+)([^\n]*)$/gm)) {
    const owner = LANG_TO_PORT[m[1]]
    if (!owner) continue
    const meta = parseMeta(m[2])
    if (!meta.file) continue
    wanted.set(`${owner}:${meta.file}`, { owner, file: meta.file })
  }
}

const cache = {}
const missing = []
for (const [key, { owner, file }] of [...wanted].sort((a, b) => a[0].localeCompare(b[0]))) {
  const checkout = checkoutFor(owner)
  const abs = join(checkout, file)
  if (!existsSync(abs)) {
    missing.push(`${key} (looked in ${checkout})`)
    continue
  }
  cache[key] = readFileSync(abs, 'utf8')
}

const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''

/*
 * A checkout that is not here cannot be read, and its cached entry cannot be
 * confirmed either way. Reported rather than treated as agreement: silence
 * would read as "verified" on a machine that verified nothing.
 */
if (missing.length) {
  console.error(`gen-example-sources: ${missing.length} source(s) unreadable — checkout absent:`)
  for (const m of missing) console.error(`  ${m}`)
  const kept = missing.filter((m) => Object.hasOwn(JSON.parse(current || '{}'), m.split(' ')[0]))
  if (kept.length) {
    console.error(`  ${kept.length} of these are in the cache already; keeping the cached copy.`)
    for (const m of kept) cache[m.split(' ')[0]] = JSON.parse(current)[m.split(' ')[0]]
  }
}

const merged = `${JSON.stringify(Object.fromEntries(Object.entries(cache).sort()), null, 2)}\n`

if (check) {
  if (merged !== current) {
    console.error(`\ngen-example-sources: ${OUT.replace(`${root}/`, '')} is stale. Rerun:`)
    console.error('  node scripts/gen-example-sources.mjs')
    process.exit(1)
  }
  console.log(`gen-example-sources: cache matches ${Object.keys(cache).length} example source(s)`)
} else {
  writeFileSync(OUT, merged)
  console.log(`gen-example-sources: wrote ${Object.keys(cache).length} example source(s) to ${OUT.replace(`${root}/`, '')}`)
}
