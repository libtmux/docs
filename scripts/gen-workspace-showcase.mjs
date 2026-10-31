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
 *   ... --data <file>                                 use another data file, such as a copy to check
 *
 * Without a port's checkout, `--check` verifies that the committed block still
 * describes the sources in `lib/workspace-showcase-sources.mjs`: the files, the
 * tests, how each test reaches its file (`via`), what it checks, each note and
 * whether a document is quoted, and that the bytes match their digests. The
 * line numbers come from the port's files, so only a run with the checkout
 * compares them.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORT_BY_SLUG } from '../site/src/lib/ports.ts'
import { SOURCES, SUPPORT, TMUXP_EXAMPLES, TOPICS, TOPIC_EXAMPLES, VIA } from './lib/workspace-showcase-sources.mjs'

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
 * The document between its opening and closing markers, dedented and without blank edges.
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

/** Refuse a test whose `via` is not a value the page knows how to describe. */
export function assertVia(label, test) {
  if (!VIA.includes(test.via)) throw new Error(`${label}: via ${JSON.stringify(test.via)} is none of ${VIA.join(', ')}`)
}

export function readExample({ checkout, revision, example, tmuxp = {} }) {
  const raw = readAt({ checkout, revision, path: example.source.path })
  const quoted = example.source.extract ? quoteDocument(raw, example.source.extract) : { text: raw.replace(/\n+$/, ''), lines: undefined }
  const config = parseConfig(quoted.text)
  const tests = example.tests.map((test) => {
    const label = `${example.source.path}: ${test.path}`
    assertVia(label, test)
    const body = readAt({ checkout, revision, path: test.path })
    const line = locate(body, test.find ?? test.name, label)
    for (const needle of test.needles ?? (example.source.extract ? [] : [basename(example.source.path)])) locate(body, needle, label)
    return { path: test.path, name: test.name, line, via: test.via, checks: test.checks }
  })
  const sha256 = digest(quoted.text)
  const identical = Object.entries(tmuxp).find(([, sum]) => sum === sha256)?.[0]
  return {
    topic: example.topic,
    also: example.also,
    ...(identical ? { tmuxp: identical } : {}),
    source: { path: example.source.path, ...(quoted.lines ? { lines: quoted.lines } : {}) },
    ...(example.note ? { note: example.note } : {}),
    yaml: quoted.text,
    sha256,
    json: JSON.stringify(config, null, 2),
    tests,
  }
}

/**
 * A pin is for a port whose fixtures are newer than the revision its API model
 * records. It must go once the model has caught up, or the showcase would keep
 * reading older sources than the page cites.
 */
export function assertPinNeeded(port, pin, model, isAncestor) {
  if (pin === model) throw new Error(`${port}: SOURCES.${port}.revision equals the API model's revision; remove the pin`)
  if (isAncestor(pin, model)) throw new Error(`${port}: SOURCES.${port}.revision ${pin} is older than the API model's ${model}; remove the pin`)
}

/** The package whose workspace pages cite this revision, or the newer one a port's sources pin. */
function workspaceSource(port) {
  const model = JSON.parse(readFileSync(join(root, `site/src/data/api/${port}.json`), 'utf8'))
  const source = model.sources?.find((entry) => entry.product === 'workspace')
  if (!source) throw new Error(`${port}: the API model records no workspace package`)
  const pin = SOURCES[port]?.revision
  if (!pin) return { repo: source.repo, revision: source.revision }
  const checkout = findCheckout(port, pin)
  assertPinNeeded(port, pin, source.revision, (older, newer) => {
    if (!checkout || !hasRevision({ checkout, revision: newer })) return false
    try {
      execFileSync('git', ['-C', checkout, 'merge-base', '--is-ancestor', older, newer], { stdio: 'ignore' })
      return true
    } catch { return false }
  })
  return { repo: source.repo, revision: pin }
}

/** A checkout that has the revision's objects: the docs worktree is absent on most machines, the plain checkout shares its objects. */
function findCheckout(port, revision) {
  const candidates = [
    process.env[`LIBTMUX_DOCS_CHECKOUT_${port.toUpperCase()}`], SOURCES[port].checkout, checkoutFor(port),
    PORT_BY_SLUG[port].worktree, PORT_BY_SLUG[port].checkout,
  ].filter(Boolean).map(expand)
  return candidates.find((candidate) => hasRevision({ checkout: candidate, revision }))
}

const trimmed = (text) => text.replace(/\n+$/, '')

/**
 * Digests of tmuxp's examples at the revision the Python port's API model
 * records for its workspace package. Without the checkout the committed digests
 * stand in when they describe that revision and the same files.
 */
export function readTmuxp(previous) {
  const { revision } = workspaceSource('py')
  const checkout = findCheckout('py', revision)
  if (!checkout) {
    if (previous?.revision === revision && JSON.stringify(Object.keys(previous.examples ?? {})) === JSON.stringify(TMUXP_EXAMPLES)) return { value: previous, offline: true }
    throw new Error(`tmuxp@${revision}: no verified cache; provide the tmuxp checkout and regenerate the workspace showcase`)
  }
  const listed = execFileSync('git', ['-C', checkout, 'ls-tree', '--name-only', revision, 'examples/'], { encoding: 'utf8' })
    .split('\n').filter((name) => name.endsWith('.yaml')).map((name) => basename(name, '.yaml'))
  if (JSON.stringify(listed) !== JSON.stringify(TMUXP_EXAMPLES)) throw new Error(`tmuxp's examples at ${revision} are ${listed.join(', ')}; update TMUXP_EXAMPLES`)
  return {
    value: { revision, examples: Object.fromEntries(TMUXP_EXAMPLES.map((name) => [name, digest(trimmed(readAt({ checkout, revision, path: `examples/${name}.yaml` })))])) },
    offline: false,
  }
}

/** The status of a tmuxp example on a port, from what the manifest says and what the port shows. */
export function testedStatus(name, examples, libraryOnly = []) {
  if (examples.some((example) => example.tmuxp === name)) return 'identical'
  if (libraryOnly.includes(name)) return 'library-only'
  const topic = Object.entries(TOPIC_EXAMPLES).find(([, example]) => example === name)?.[0]
  return topic && examples.some((example) => example.topic === topic) ? 'other' : 'missing'
}

/** Refuse a manifest that shows a preset the port does not support, or names an example tmuxp lacks. */
export function validateSupport(port, support = {}, examples = []) {
  const { unsupported = {}, caveats = {}, libraryOnly = [] } = support
  for (const name of [...Object.keys(unsupported), ...Object.keys(caveats), ...libraryOnly]) {
    if (!TMUXP_EXAMPLES.includes(name)) throw new Error(`${port}: ${name} is not one of tmuxp's examples`)
  }
  for (const example of examples) {
    if (!example.tmuxp) continue
    if (unsupported[example.tmuxp]) throw new Error(`${port}: ${example.topic} is tmuxp's ${example.tmuxp}, which the loader does not support: ${unsupported[example.tmuxp].reason}`)
    if (libraryOnly.includes(example.tmuxp)) throw new Error(`${port}: ${example.tmuxp} is shown, so it cannot be library-only`)
  }
}

const citeTriple = (cite) => cite ? [cite.path, cite.find, cite.from ?? null] : null
const supportRow = (name, status, entry) => [name, status, entry?.reason ?? null, citeTriple(entry?.cite)]

/** What the manifest says about a port's support, without the lines the generator adds. */
export function supportInputs(support = {}) {
  const { unsupported = {}, caveats = {}, defaultLayout } = support
  return JSON.stringify({
    presets: TMUXP_EXAMPLES.map((name) => supportRow(name, unsupported[name] ? 'no' : caveats[name] ? 'caveat' : 'yes', unsupported[name] ?? caveats[name])),
    defaultLayout: defaultLayout ? [defaultLayout.layout, citeTriple(defaultLayout.cite)] : null,
  })
}

/** The same, read back from a committed block. */
function committedInputs(block) {
  const presets = block.support?.presets ?? {}
  return JSON.stringify({
    presets: TMUXP_EXAMPLES.map((name) => supportRow(name, presets[name]?.supported, presets[name])),
    defaultLayout: block.support?.defaultLayout ? [block.support.defaultLayout.layout, citeTriple(block.support.defaultLayout.cite)] : null,
  })
}

/**
 * What an example names, apart from its bytes: the topics, the file, whether a
 * document is quoted from inside it, the note, and for each test the file, the
 * name, how it reaches the file and what it checks. A source has `extract` where
 * a committed block has `lines`.
 */
const shapeOf = (example) => JSON.stringify([
  example.topic, example.also, example.source.path, Boolean(example.source.extract ?? example.source.lines), example.note ?? null,
  example.tests.map((test) => [test.path, test.name, test.via, test.checks]),
])

/** Whether a quoted document's line range spans exactly the rows of its text. */
const spansItsText = ({ source, yaml }) => {
  const { lines } = source
  if (!lines) return true
  return Array.isArray(lines) && lines.length === 2 && Number.isInteger(lines[0]) && lines[0] > 0 &&
    lines[1] - lines[0] + 1 === yaml.split('\n').length
}

/** Whether a committed block can stand in for a checkout that is absent. */
export function trustedBlock(block, { repo, revision, examples, support }, digests = {}) {
  if (!block || block.repo !== repo || block.revision !== revision) return false
  if (block.examples.length !== examples.length || committedInputs(block) !== supportInputs(support)) return false
  return block.examples.every((example, index) => {
    if (shapeOf(example) !== shapeOf(examples[index]) || !spansItsText(example) || example.sha256 !== digest(example.yaml)) return false
    // An identical claim must still match the committed digest of tmuxp's example.
    return example.tmuxp ? digests[example.tmuxp] === example.sha256 : !Object.values(digests).includes(example.sha256)
  })
}

/** The support table of a port: each tmuxp example, whether the loader takes it and whether a test loads it. */
export function supportTable(port, spec, support = {}, examples, locateCite) {
  const { unsupported = {}, caveats = {}, libraryOnly = [], defaultLayout } = support
  const resolve = (entry) => entry && ({ ...(entry.reason ? { reason: entry.reason } : {}), ...(entry.cite ? { cite: locateCite(entry.cite) } : {}) })
  return {
    presets: Object.fromEntries(TMUXP_EXAMPLES.map((name) => [name, {
      supported: unsupported[name] ? 'no' : caveats[name] ? 'caveat' : 'yes',
      ...resolve(unsupported[name] ?? caveats[name]),
      tested: testedStatus(name, examples, libraryOnly),
    }])),
    ...(defaultLayout ? { defaultLayout: { layout: defaultLayout.layout, cite: locateCite(defaultLayout.cite) } } : {}),
  }
}

export function buildPort(port, previous, tmuxp) {
  const { repo, revision } = workspaceSource(port)
  const spec = SOURCES[port]
  const checkout = findCheckout(port, revision)
  const order = (list) => [...list].sort((a, b) => TOPICS.indexOf(a.topic) - TOPICS.indexOf(b.topic))
  const examples = order(spec.examples)
  const support = SUPPORT[port]
  for (const example of examples) for (const test of example.tests) assertVia(`${port} ${example.source.path}: ${test.path}`, test)
  if (!checkout) {
    if (trustedBlock(previous, { repo, revision, examples, support }, tmuxp.examples)) return { block: previous, offline: true }
    throw new Error(`${port}: no verified cache for ${repo}@${revision}; provide its checkout and regenerate the workspace showcase`)
  }
  const read = examples.map((example) => readExample({ checkout, revision, example, tmuxp: tmuxp.examples }))
  validateSupport(port, support, read)
  // A citation in another port's source is read at that port's pinned revision.
  const locateCite = (entry) => {
    const owner = entry.from ?? port
    const source = workspaceSource(owner)
    const where = findCheckout(owner, source.revision)
    if (!where) throw new Error(`${port}: no checkout of ${owner} to read ${entry.path} at ${source.revision}`)
    const body = readAt({ checkout: where, revision: source.revision, path: entry.path })
    return { path: entry.path, find: entry.find, line: locate(body, entry.find, `${port} ${entry.path}`), ...(entry.from ? { from: entry.from } : {}) }
  }
  return { block: { repo, revision, support: supportTable(port, spec, support, read, locateCite), examples: read }, offline: false }
}

/** The data file: `--data <file>` names another, so a copy can be checked without touching the committed file. */
function dataFile(argv) {
  const index = argv.indexOf('--data')
  if (index < 0) return OUT
  if (!argv[index + 1]) throw new Error('--data needs a file')
  return resolve(argv[index + 1])
}

export function run(argv = process.argv) {
  const check = argv.includes('--check')
  const out = dataFile(argv)
  const current = existsSync(out) ? readFileSync(out, 'utf8') : ''
  const previous = current ? JSON.parse(current) : { ports: {} }
  const tmuxp = readTmuxp(previous.tmuxp)
  const ports = {}
  const offline = []
  for (const port of Object.keys(SOURCES)) {
    const result = buildPort(port, previous.ports?.[port], tmuxp.value)
    ports[port] = result.block
    if (result.offline) offline.push(port)
  }
  const merged = `${JSON.stringify({ tmuxp: tmuxp.value, ports }, null, 2)}\n`
  if (check && merged !== current) throw new Error(`${out}: stale workspace showcase; run node scripts/gen-workspace-showcase.mjs`)
  if (!check) writeFileSync(out, merged)
  const count = Object.values(ports).reduce((sum, block) => sum + block.examples.length, 0)
  console.log(`gen-workspace-showcase: ${check ? 'cache matches' : 'wrote'} ${count} revision-bound examples and the support of ${Object.keys(ports).length} ports`)
  if (offline.length || tmuxp.offline) console.log(`gen-workspace-showcase: ${[...offline, ...(tmuxp.offline ? ['tmuxp'] : [])].join(', ')} verified from the cache; checkouts unavailable`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run()
