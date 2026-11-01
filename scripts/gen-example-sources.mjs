#!/usr/bin/env node
/** Cache example files at the exact revision recorded by each port's documentation. */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const plugin = join(root, 'site/src/plugins/remark-port-code.mjs')
const { LANG_TO_PORT, checkoutFor, parseMeta } = await import(`file://${plugin}`)
const { landingCacheKey } = await import(`file://${join(root, 'site/src/lib/port-landing.ts')}`)

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
for (const [owner, file] of [
  ['ruby', 'examples/quickstart.rb'],
  ['ruby', 'examples/async_cancel.rb'],
  ['lua', 'examples/quickstart.lua'],
  ['lua', 'examples/native_query.lua'],
  ['lua', 'examples/snapshot.lua'],
]) wanted.set(`${owner}:${file}`, { owner, file })
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

/*
 * A port's landing page quotes a program of each product it ships. Those files
 * are cached under their product, because Python's products live in other
 * repositories and every product has its own revision in the API model.
 */
const landingArg = process.argv.indexOf('--landing')
const LANDING = JSON.parse(readFileSync(landingArg === -1 ? join(root, 'site/src/data/landing-examples.json') : resolve(process.argv[landingArg + 1]), 'utf8'))
for (const [owner, products] of Object.entries(LANDING)) {
  for (const [product, entry] of Object.entries(products)) {
    if (entry.file) wanted.set(landingCacheKey(owner, product, entry.file), { owner, product, file: entry.file })
  }
}

/*
 * The Core Library capability showcase quotes programs and tests of each port
 * and the files that check their results; all are cached at the library's revision.
 */
const CAPABILITIES = JSON.parse(readFileSync(join(root, 'site/src/data/core-capabilities.json'), 'utf8'))
for (const [owner, capabilities] of Object.entries(CAPABILITIES)) {
  for (const entry of Object.values(capabilities)) {
    for (const file of [entry.file, ...entry.checkedBy.map((item) => item.file)]) wanted.set(`${owner}:${file}`, { owner, file })
  }
}

const digest = (content) => createHash('sha256').update(content).digest('hex')

/** Where a product's file is read: the model records one repository and revision per product. */
function sourceOf(owner, product, modelPath) {
  if (!product) {
    const provenance = existsSync(modelPath) ? JSON.parse(readFileSync(modelPath, 'utf8'))
      : JSON.parse(readFileSync(join(root, `site/src/data/port-guides/${owner}.json`), 'utf8')).source
    return { repository: provenance.repository ?? provenance.repo, revision: provenance.revision }
  }
  const source = JSON.parse(readFileSync(modelPath, 'utf8')).sources?.find((candidate) => candidate.product === product)
  if (!source) throw new Error(`${owner}: the API model records no ${product} source for the landing page's example`)
  return { repository: source.repo, revision: source.revision }
}

/** Read committed bytes; a working tree can be dirty or on a different branch. */
export function cachedExample({ repository, revision, file, checkout, current }) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error(`Invalid example revision: ${revision}`)
  if (checkout && existsSync(join(checkout, '.git'))) {
    const content = execFileSync('git', ['-C', checkout, 'show', `${revision}:${file}`],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
    return { repository, revision, sha256: digest(content), content }
  }
  if (current?.repository !== repository || current?.revision !== revision ||
      typeof current.content !== 'string' || current.sha256 !== digest(current.content)) {
    throw new Error(`${repository}:${file}: no verified cache for ${revision}; provide its checkout and regenerate example sources`)
  }
  return current
}

export function run() {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
  const previous = JSON.parse(current || '{}')
  const cache = {}
  const offline = new Set()
  for (const [key, { owner, product, file }] of [...wanted].sort((a, b) => a[0].localeCompare(b[0]))) {
    const { repository, revision } = sourceOf(owner, product, join(root, `site/src/data/api/${owner}.json`))
    const checkout = checkoutFor(owner, product)
    if (!checkout || !existsSync(join(checkout, '.git'))) offline.add(product ? `${owner}/${product}` : owner)
    cache[key] = cachedExample({ repository, revision, file, checkout, current: previous[key] })
  }
  const merged = `${JSON.stringify(cache, null, 2)}\n`
  if (check && merged !== current) throw new Error(`${OUT}: stale example sources; run node scripts/gen-example-sources.mjs`)
  if (!check) writeFileSync(OUT, merged)
  console.log(`gen-example-sources: ${check ? 'cache matches' : 'wrote'} ${Object.keys(cache).length} revision-bound example sources`)
  if (offline.size) console.log(`gen-example-sources: cached sources for ${[...offline].join(', ')}; checksums and revisions checked, source checkouts unavailable`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run()
