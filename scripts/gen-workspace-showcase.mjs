#!/usr/bin/env node
/**
 * Cache the workspace configurations the showcase shows, at the revision each
 * port's API model records for its workspace package.
 *
 * Every example is read from committed bytes, so a dirty working tree and a
 * newer HEAD change nothing. The generator also confirms that each test named
 * for an example still exists in the test file at that revision and still
 * mentions the example. Without that check the list would keep naming tests a
 * port has since renamed or stopped running.
 *
 *   node scripts/gen-workspace-showcase.mjs           write the data file
 *   node scripts/gen-workspace-showcase.mjs --check   compare it with the sources
 *
 * Without a port's checkout, `--check` verifies that the committed block still
 * describes the sources in `lib/workspace-showcase-sources.mjs` and that its
 * bytes match their digests.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORT_BY_SLUG } from '../site/src/lib/ports.ts'
import { SOURCES, TOPICS } from './lib/workspace-showcase-sources.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(root, 'site/src/data/workspace-showcase.json')
const { checkoutFor, expand } = await import(`file://${join(root, 'site/src/plugins/remark-port-code.mjs')}`)
const { parseFrontmatter } = createRequire(join(root, 'site', 'package.json'))('@astrojs/markdown-remark')

const digest = (text) => createHash('sha256').update(text).digest('hex')
const lineOf = (text, index) => text.slice(0, index).split('\n').length

/** Committed bytes of `path` at `revision`. */
export function readAt({ checkout, revision, path }) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error(`Invalid revision: ${revision}`)
  return execFileSync('git', ['-C', checkout, 'show', `${revision}:${path}`],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
}

/** Whether the checkout has the revision's objects. */
export function hasRevision({ checkout, revision }) {
  if (!checkout || !existsSync(join(checkout, '.git'))) return false
  try {
    execFileSync('git', ['-C', checkout, 'cat-file', '-e', `${revision}^{commit}`], { stdio: 'ignore' })
    return true
  } catch { return false }
}

/**
 * The document between two literal markers, dedented and without blank edges.
 * `after` starts the search at a unique anchor, such as a test's name.
 * @returns {{ text: string, lines: [number, number] }}
 */
export function quoteDocument(source, { open, close, after }) {
  const from = after === undefined ? 0 : source.indexOf(after)
  if (from < 0) throw new Error(`anchor not found: ${JSON.stringify(after)}`)
  const start = source.indexOf(open, from)
  if (start < 0) throw new Error(`opening marker not found: ${JSON.stringify(open)}`)
  const bodyStart = start + open.length
  const end = source.indexOf(close, bodyStart)
  if (end < 0) throw new Error(`closing marker not found: ${JSON.stringify(close)}`)
  const rows = source.slice(bodyStart, end).split('\n')
  while (rows.length && !rows[0].trim()) rows.shift()
  while (rows.length && !rows.at(-1).trim()) rows.pop()
  if (!rows.length) throw new Error('the quoted document is empty')
  // The opening line may continue code, so its indent is not the document's.
  const indent = Math.min(...rows.filter((row) => row.trim()).map((row) => /^ */.exec(row)[0].length))
  const text = rows.map((row) => row.slice(indent)).join('\n')
  const firstOffset = source.indexOf(rows[0].trim(), bodyStart)
  const first = lineOf(source, firstOffset)
  return { text, lines: [first, first + rows.length - 1] }
}

/** A configuration parsed from YAML; JSON is YAML, so a JSON document also parses. */
export function parseConfig(text) {
  const { frontmatter } = parseFrontmatter(`---\n${text}\n---\n`)
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    throw new Error('a workspace document is a mapping')
  }
  return frontmatter
}

/** The first line a string appears on, or an error naming the test that lost it. */
function locate(text, needle, label) {
  const index = text.indexOf(needle)
  if (index < 0) throw new Error(`${label}: ${JSON.stringify(needle)} is not in the file`)
  return lineOf(text, index)
}

export function readExample({ checkout, revision, example }) {
  const raw = readAt({ checkout, revision, path: example.source.path })
  const quoted = example.source.extract ? quoteDocument(raw, example.source.extract) : { text: raw.replace(/\n+$/, ''), lines: undefined }
  const config = parseConfig(quoted.text)
  const tests = example.tests.map((test) => {
    const label = `${example.source.path}: ${test.path}`
    const body = readAt({ checkout, revision, path: test.path })
    const line = locate(body, test.find ?? test.name, label)
    for (const needle of test.needles ?? (example.source.extract ? [] : [basename(example.source.path)])) locate(body, needle, label)
    return { path: test.path, name: test.name, line, via: test.via, checks: test.checks }
  })
  return {
    topic: example.topic,
    also: example.also,
    source: { path: example.source.path, ...(quoted.lines ? { lines: quoted.lines } : {}) },
    ...(example.note ? { note: example.note } : {}),
    yaml: quoted.text,
    sha256: digest(quoted.text),
    json: JSON.stringify(config, null, 2),
    tests,
  }
}

/** The package whose workspace pages cite this revision. */
function workspaceSource(port) {
  const model = JSON.parse(readFileSync(join(root, `site/src/data/api/${port}.json`), 'utf8'))
  const source = model.sources?.find((entry) => entry.product === 'workspace')
  if (!source) throw new Error(`${port}: the API model records no workspace package`)
  return { repo: source.repo, revision: source.revision }
}

/** What an example names, apart from its bytes. */
const shapeOf = (example) => JSON.stringify([
  example.topic, example.also, example.source.path, example.tests.map((test) => [test.path, test.name]),
])

/** Whether a committed block can stand in for a checkout that is absent. */
export function trustedBlock(block, { repo, revision, examples }) {
  if (!block || block.repo !== repo || block.revision !== revision) return false
  if (block.examples.length !== examples.length) return false
  return block.examples.every((example, index) => shapeOf(example) === shapeOf(examples[index]) && example.sha256 === digest(example.yaml))
}

export function buildPort(port, previous) {
  const { repo, revision } = workspaceSource(port)
  const spec = SOURCES[port]
  // The docs worktree is absent on most machines; the plain checkout shares its objects.
  const candidates = [
    process.env[`LIBTMUX_DOCS_CHECKOUT_${port.toUpperCase()}`], spec.checkout, checkoutFor(port),
    PORT_BY_SLUG[port].worktree, PORT_BY_SLUG[port].checkout,
  ].filter(Boolean).map(expand)
  const checkout = candidates.find((candidate) => hasRevision({ checkout: candidate, revision }))
  const order = (list) => [...list].sort((a, b) => TOPICS.indexOf(a.topic) - TOPICS.indexOf(b.topic))
  const examples = order(spec.examples)
  if (!checkout) {
    if (trustedBlock(previous, { repo, revision, examples })) return { block: previous, offline: true }
    throw new Error(`${port}: no verified cache for ${repo}@${revision}; provide its checkout and regenerate the workspace showcase`)
  }
  return { block: { repo, revision, examples: examples.map((example) => readExample({ checkout, revision, example })) }, offline: false }
}

export function run() {
  const check = process.argv.includes('--check')
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
  const previous = current ? JSON.parse(current) : { ports: {} }
  const ports = {}
  const offline = []
  for (const port of Object.keys(SOURCES)) {
    const result = buildPort(port, previous.ports?.[port])
    ports[port] = result.block
    if (result.offline) offline.push(port)
  }
  const merged = `${JSON.stringify({ ports }, null, 2)}\n`
  if (check && merged !== current) throw new Error(`${OUT}: stale workspace showcase; run node scripts/gen-workspace-showcase.mjs`)
  if (!check) writeFileSync(OUT, merged)
  const count = Object.values(ports).reduce((sum, block) => sum + block.examples.length, 0)
  console.log(`gen-workspace-showcase: ${check ? 'cache matches' : 'wrote'} ${count} revision-bound examples for ${Object.keys(ports).length} ports`)
  if (offline.length) console.log(`gen-workspace-showcase: ${offline.join(', ')} verified from the cache; checkouts unavailable`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run()
