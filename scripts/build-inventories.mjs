#!/usr/bin/env node
/**
 * Build `objects.inv` files for projects that do not publish one.
 *
 * CPython ships an inventory; the JDK and the web platform do not. Both
 * publish something equivalent in a different shape, so this converts rather
 * than invents: Oracle's javadoc emits `type-search-index.js` and
 * `member-search-index.js`, which are its own complete index of every type and
 * member with the URL for each, and TypeScript ships the DOM and ECMAScript
 * declarations this site's own toolchain already has on disk.
 *
 * The alternative was a URL template that guesses — `?q=Stream.filter` into a
 * search page. That resolves every name, including the ones that do not
 * exist, which is the failure mode this whole subsystem exists to avoid: a
 * link that looks deliberate and goes nowhere.
 *
 * Usage: node scripts/build-inventories.mjs [--check]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readInventory, writeInventory } from '../packages/api-model/src/inventory.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(repoRoot, 'site/src/data/inventories')
const check = process.argv.includes('--check')

const JDK = 'https://docs.oracle.com/en/java/javase/21/docs/api/'

/**
 * Packages worth carrying.
 *
 * The JDK's member index is 4.8 MB and most of it is Swing, CORBA and
 * compiler internals that no tmux library references. Every entry is a name
 * the resolver might match, and a bigger inventory is a wider surface for a
 * confidently wrong link, not a better one.
 */
const JDK_PACKAGES = /^java\.(lang|util|io|nio|time|net|text|math|security)(\.|$)/

/** Fetch and strip the `name = ` prefix javadoc's index files carry. */
async function javadocIndex(file) {
  const res = await fetch(JDK + file, { redirect: 'follow' })
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`)
  const text = await res.text()
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end < 0) throw new Error(`${file}: not a JSON array`)
  return JSON.parse(text.slice(start, end + 1))
}

async function buildJdk() {
  const types = await javadocIndex('type-search-index.js')
  const members = await javadocIndex('member-search-index.js')
  const symbols = []

  for (const t of types) {
    if (!t.p || !t.l || !JDK_PACKAGES.test(t.p)) continue
    // The bare class name as well as the qualified one: prose writes
    // `Optional`, not `java.util.Optional`, and an inventory keyed only on the
    // qualified form answers neither.
    const path = `${t.p.replace(/\./g, '/')}/${t.l.replace(/\./g, '.')}.html`
    symbols.push({ id: `${t.p}.${t.l}`, name: t.l, kind: 'class', uri: path })
    symbols.push({ id: t.l, name: t.l, kind: 'class', uri: path })
  }

  for (const m of members) {
    if (!m.p || !m.c || !m.l || !JDK_PACKAGES.test(m.p)) continue
    // `l` is the display label, which carries the parameter list;
    // `u` is the URL fragment when it differs.
    const bare = m.l.replace(/\(.*$/, '')
    if (!bare || /[^A-Za-z0-9_$]/.test(bare)) continue
    const path = `${m.p.replace(/\./g, '/')}/${m.c.replace(/\./g, '.')}.html#${m.u ?? m.l}`
    symbols.push({ id: `${m.c}.${bare}`, name: bare, kind: 'method', uri: path })
  }

  return { name: 'jdk', project: 'Java SE 21', baseUrl: JDK, symbols }
}

/**
 * The web platform, from the declarations TypeScript already ships.
 *
 * Read from `node_modules`, not fetched: this is the same file the port's own
 * compiler resolves against, so the names here are exactly the ones its
 * annotations can mention.
 */
function buildDom() {
  const libDir = join(repoRoot, 'node_modules/typescript/lib')
  // MDN files the two apart, and so must this. `Promise` under `Web/API/` is
  // a page that does not exist: it is a language builtin, not a DOM
  // interface, and guessing one scheme for both produces a confident 404 —
  // the exact failure this inventory replaces a search-URL template to avoid.
  const files = [
    { file: 'lib.dom.d.ts', prefix: 'en-US/docs/Web/API/' },
    { file: 'lib.es5.d.ts', prefix: 'en-US/docs/Web/JavaScript/Reference/Global_Objects/' },
    { file: 'lib.es2015.promise.d.ts', prefix: 'en-US/docs/Web/JavaScript/Reference/Global_Objects/' },
    { file: 'lib.es2015.iterable.d.ts', prefix: 'en-US/docs/Web/JavaScript/Reference/Global_Objects/' },
  ]
  const seen = new Map()
  for (const { file, prefix } of files) {
    const path = join(libDir, file)
    if (!existsSync(path)) continue
    const text = readFileSync(path, 'utf8')
    for (const m of text.matchAll(/^\s*(?:declare\s+)?(?:interface|declare var|type|class)\s+([A-Z][A-Za-z0-9_]*)/gm)) {
      const name = m[1]
      if (seen.has(name)) continue
      seen.set(name, { id: name, name, kind: 'interface', uri: `${prefix}${name}` })
    }
  }
  return {
    name: 'dom',
    project: 'MDN Web Docs',
    baseUrl: 'https://developer.mozilla.org/',
    symbols: [...seen.values()],
  }
}

function emit({ name, project, symbols }) {
  const out = join(outDir, `${name}.inv`)
  const model = {
    port: name,
    symbols: symbols.map((s) => ({
      id: s.id,
      publicId: s.id,
      name: s.name,
      kind: s.kind,
      modifiers: [],
      signatures: [],
      source: { file: '', line: 1 },
    })),
  }
  const uriById = new Map(symbols.map((s) => [s.id, s.uri]))
  const bytes = writeInventory(model, {
    project,
    version: '1',
    uriFor: (s) => uriById.get(s.publicId ?? s.id) ?? '',
  })
  writeFileSync(out, bytes)
  writeSidecar(name, bytes)
  const back = readInventory(bytes)
  console.log(`build-inventories: ${name}.inv — ${back.entries.length} entries, ${(bytes.length / 1024).toFixed(0)} KB`)
}

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

if (check) {
  let failed = 0
  for (const name of ['jdk', 'dom']) {
    const out = join(outDir, `${name}.inv`)
    if (!existsSync(out)) {
      console.error(`build-inventories: ${name}.inv missing — run without --check`)
      failed++
      continue
    }
    const { project, entries } = readInventory(readFileSync(out))
    console.log(`build-inventories: ${name}.inv ok — ${project}, ${entries.length} entries`)
  }
  process.exit(failed ? 1 : 0)
}

emit(buildDom())
emit(await buildJdk())
