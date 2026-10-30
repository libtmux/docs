#!/usr/bin/env node
/*
 * Type names that render as neither a link nor deliberate plain text.
 *
 * `ApiType` links every name it can resolve and leaves the rest as plain
 * `api-punct` spans. That is the right behaviour — a link to a guess is worse
 * than no link — but it also means a resolution failure is invisible: the page
 * still renders, no link breaks, and `check-links` is satisfied.
 *
 * Swift's conformances showed what that hides. Every base on every type
 * rendered as a mangled USR — `s:s8CopyableP` where `Copyable` belonged — on
 * 527 type annotations, through a full green suite, until someone read the
 * page. The graph had carried the readable name all along, in the
 * `targetFallback` the extractor ignored.
 *
 * So there are two gates here. A mangled USR is never acceptable and fails on
 * sight. Everything else unresolved is counted and held under a ceiling,
 * because the residue is mostly language keywords — `impl`, `let`, `typename`
 * — which are supposed to be plain. Grammar-owned nonreference tokens carry
 * an explicit role from the native formatter. All other plain identifiers
 * remain counted; no list of names or ports exempts them.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { referenceDirs } from './reference-trees.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
/* `--ceiling` points at a different record so the negative test can drive this
 * script rather than a copy of its logic. */
const ceilingArg = process.argv.indexOf('--ceiling')
const CEILING_FILE =
  ceilingArg === -1
    ? join(root, 'scripts/type-links-ceiling.json')
    : process.argv[ceilingArg + 1]
const { API_MODEL_PORTS: PORT_DEFS } = await import(`file://${join(root, 'site/src/lib/ports.ts')}`)
const PORTS = PORT_DEFS.map((p) => p.slug)

const args = process.argv.slice(2)
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--ceiling')
const site = positional[0] ?? join(root, '_site')

/** A mangled Swift USR standing where a type name belongs. */
const USR = /^s:[A-Za-z0-9_]+$/
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' }
// Consume comments and quoted tags together so neither scans inside the other.
// HTML also closes comments at --!>, <!-->, and <!--->.
const MARKUP = /<!--(?:>|->|[\s\S]*?(?:--!?>|$))|<(?:(\/?)(span|a)\b)?((?:[^>"']|"[^"]*"|'[^']*')*)>/gi
const text = (html) =>
  html
    .replace(MARKUP, '')
    .replace(/&(#39|amp|lt|gt|quot|nbsp);/g, (_, e) => ENTITIES[e])
    .trim()

/** Attribute order and quoting do not change a rendered token's role. */
function attributes(source) {
  const result = new Map()
  for (const match of source.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = match[1].toLowerCase()
    if (!result.has(name)) result.set(name, match[2] ?? match[3] ?? match[4] ?? '')
  }
  return result
}

/**
 * Keep the recorded single-class metric; type chips need their own inventory.
 *
 * A span also classed `api-type-repeat` is a repeat of a type drawn in full elsewhere, such as a table row that
 * summarizes an entry or a variant's page (`ApiType`'s `repeated`). The name is counted where its declaration is drawn,
 * which is the entry on the same page for a product page and the variant's own page for an enum page, so the repeat
 * adds none. site/test/field-table-pages.test.ts requires that every product-page repeat has its original on its page,
 * and site/test/enum-variants.test.ts that every enum-page repeat has one on its variant's page.
 */
function singleClass(classes, name) {
  return classes.length === 1 && classes[0] === name
}

function typeMarkup(html) {
  const spans = []
  const plain = []
  const blocks = []
  let resolved = 0
  // Stack spans so operators nested inside a type cannot conceal a mangled id.
  for (const match of html.matchAll(MARKUP)) {
    if (!match[2]) continue
    const tag = match[2].toLowerCase()
    if (match[1]) {
      if (tag !== 'span') continue
      const span = spans.pop()
      if (!span) continue
      const value = text(html.slice(span.start, match.index))
      if (span.type) blocks.push(value)
      if (span.plain) plain.push(value)
      continue
    }
    const attrs = attributes(match[3])
    const classes = (attrs.get('class') ?? '').trim().split(/\s+/)
    if (tag === 'a') {
      if (singleClass(classes, 'api-type-link')) resolved++
    } else {
      spans.push({ start: match.index + match[0].length,
        type: classes.includes('api-type'),
        plain: singleClass(classes, 'api-punct') && attrs.get('data-api-role') !== 'syntax',
      })
    }
  }
  return { resolved, plain, blocks }
}

function* htmlFiles(dir) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) yield* htmlFiles(p)
    else if (entry.endsWith('.html')) yield p
  }
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

function measure(port) {
  let resolved = 0
  const unresolved = new Map()
  const mangled = []
  for (const file of referenceDirs(site, port, { products: true }).flatMap((dir) => [...htmlFiles(dir)])) {
    const html = readFileSync(file, 'utf8')
    const markup = typeMarkup(html)
    resolved += markup.resolved
    for (const block of markup.blocks) {
      if (USR.test(block)) mangled.push({ file: file.slice(site.length), block })
    }
    for (const t of markup.plain) {
      if (IDENTIFIER.test(t)) unresolved.set(t, (unresolved.get(t) ?? 0) + 1)
    }
  }
  const total = [...unresolved.values()].reduce((a, b) => a + b, 0)
  return { resolved, unresolved: total, names: unresolved, mangled }
}

const results = Object.fromEntries(PORTS.map((p) => [p, measure(p)]))
const mangled = PORTS.flatMap((p) => results[p].mangled.map((m) => ({ port: p, ...m })))

if (args.includes('--list')) {
  for (const p of PORTS) {
    const { resolved, unresolved, names } = results[p]
    const share = resolved + unresolved ? ((resolved * 100) / (resolved + unresolved)).toFixed(1) : '0.0'
    const top = [...names.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([n, c]) => `${n}(${c})`)
      .join(' ')
    console.log(`${p.padEnd(7)} ${String(resolved).padStart(6)} linked  ${String(unresolved).padStart(5)} plain  ${share.padStart(5)}% linked`)
    console.log(`        ${top}`)
  }
  process.exit(0)
}

if (args.includes('--update')) {
  const current = existsSync(CEILING_FILE) ? JSON.parse(readFileSync(CEILING_FILE, 'utf8')) : {}
  // The mirror of check-palette and check-xrefs: this ceiling only comes down.
  //
  // A port with no entry is treated as a ceiling of zero, not of infinity, so
  // it lands in `raised` and needs --force like any other rise. Recording a
  // first baseline is deliberate; so is a renamed slug arriving with no
  // history, and the two are indistinguishable here. Defaulting to infinity
  // waved both through.
  const raised = PORTS.filter((p) => results[p].unresolved > (current[p] ?? 0))
  if (raised.length && !args.includes('--force')) {
    console.error(
      `check-type-links: refusing to raise the ceiling for ${raised.join(', ')}.\n` +
        raised.map((p) => `  ${p}: ${current[p] ?? '(none recorded)'} -> ${results[p].unresolved}`).join('\n') +
        `\nAdd the missing names to BUILTINS or fix resolution. If more plain\n` +
        `names really are the intended outcome, say so and pass --force.`,
    )
    process.exit(1)
  }
  const next = Object.fromEntries(PORTS.map((p) => [p, results[p].unresolved]))
  writeFileSync(CEILING_FILE, `${JSON.stringify(next, null, 2)}\n`)
  console.log('check-type-links: ceilings written')
  for (const p of PORTS) console.log(`  ${p.padEnd(7)} ${next[p]}`)
  process.exit(0)
}

// A mangled USR is a resolution failure that reached the page. No ceiling.
if (mangled.length) {
  console.error(`check-type-links: ${mangled.length} type annotations render a mangled symbol id.`)
  for (const m of mangled.slice(0, 8)) console.error(`  ${m.port}  ${m.block}  ${m.file}`)
  console.error(
    `\nThe extractor could not name the target and fell back to its id. For a\n` +
      `Swift symbol graph the readable name is in the relationship's targetFallback.`,
  )
  process.exit(1)
}

if (!existsSync(CEILING_FILE)) {
  console.error('check-type-links: no ceiling recorded — run node scripts/check-type-links.mjs --update')
  process.exit(1)
}

const ceiling = JSON.parse(readFileSync(CEILING_FILE, 'utf8'))

// Absent is not zero here either. A ceiling of zero happens to fail closed for
// this direction, but it reports a renamed slug as a resolution regression
// rather than as an unrecorded port, which sends the reader after the wrong
// defect. See check-xrefs.mjs for the same guard on the other direction.
const unrecorded = PORTS.filter((p) => !(p in ceiling))
if (unrecorded.length) {
  console.error(
    `check-type-links: no ceiling recorded for ${unrecorded.join(', ')}.\n` +
      `Record one: node scripts/check-type-links.mjs --update`,
  )
  process.exit(1)
}

const over = PORTS.filter((p) => results[p].unresolved > ceiling[p])
if (over.length) {
  console.error('check-type-links: more type names render plain than the ceiling allows.')
  for (const p of over) {
    const top = [...results[p].names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    console.error(`  ${p.padEnd(7)} ${ceiling[p]} -> ${results[p].unresolved}   ${top.map(([n, c]) => `${n}(${c})`).join(' ')}`)
  }
  console.error('\nSee them all: node scripts/check-type-links.mjs --list')
  process.exit(1)
}

const linked = PORTS.reduce((n, p) => n + results[p].resolved, 0)
const plain = PORTS.reduce((n, p) => n + results[p].unresolved, 0)
console.log(`check-type-links: ${linked} type names linked, ${plain} plain, no mangled ids`)
// A ceiling left above its count lets that many names regress unnoticed.
const under = PORTS.filter((p) => results[p].unresolved < ceiling[p])
if (under.length) {
  console.log('check-type-links: below the ceiling; lower it with node scripts/check-type-links.mjs --update')
  for (const p of under) console.log(`  ${p.padEnd(7)} ${ceiling[p]} -> ${results[p].unresolved}`)
}
