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
 * — which are supposed to be plain, and separating those by hand would be a
 * list that rots. What must not happen is the number growing.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
/* `--ceiling` points at a different record so the negative test can drive this
 * script rather than a copy of its logic. */
const ceilingArg = process.argv.indexOf('--ceiling')
const CEILING_FILE =
  ceilingArg === -1
    ? join(root, 'scripts/type-links-ceiling.json')
    : process.argv[ceilingArg + 1]
const { PORTS: PORT_DEFS } = await import(`file://${join(root, 'site/src/lib/ports.ts')}`)
const PORTS = PORT_DEFS.map((p) => p.slug)

const args = process.argv.slice(2)
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--ceiling')
const site = positional[0] ?? join(root, '_site')

/** A mangled Swift USR standing where a type name belongs. */
const USR = /^s:[A-Za-z0-9_]+$/
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' }
const text = (html) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&(#39|amp|lt|gt|quot|nbsp);/g, (_, e) => ENTITIES[e])
    .trim()

/**
 * The visible text of each `api-type` block.
 *
 * The block nests — every name inside is its own `<span>` or `<a>` — so a
 * non-greedy match to the first `</span>` returns the first fragment alone.
 * That mistake reports zero on a page full of USRs, so the depth counter here
 * is the whole point of the function.
 */
function typeBlocks(html) {
  const out = []
  const open = /<span class="api-type">/g
  let m
  while ((m = open.exec(html))) {
    let i = m.index + m[0].length
    let depth = 1
    while (depth > 0) {
      const nextOpen = html.indexOf('<span', i)
      const nextClose = html.indexOf('</span>', i)
      if (nextClose === -1) break
      if (nextOpen !== -1 && nextOpen < nextClose) {
        i = html.indexOf('>', nextOpen) + 1
        depth++
      } else {
        i = nextClose + 7
        depth--
      }
    }
    out.push(text(html.slice(m.index + m[0].length, i - 7)))
  }
  return out
}

function* htmlFiles(dir) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) yield* htmlFiles(p)
    else if (entry.endsWith('.html')) yield p
  }
}

const PUNCT_SPAN = /<span class="api-punct">((?:(?!<\/span>).)*)<\/span>/g
const TYPE_LINK = /<a [^>]*class="api-type-link"/g
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

function measure(port) {
  let resolved = 0
  const unresolved = new Map()
  const mangled = []
  for (const file of htmlFiles(join(site, 'reference', port))) {
    const html = readFileSync(file, 'utf8')
    resolved += (html.match(TYPE_LINK) ?? []).length
    for (const block of typeBlocks(html)) {
      if (USR.test(block)) mangled.push({ file: file.slice(site.length), block })
    }
    for (const m of html.matchAll(PUNCT_SPAN)) {
      const t = text(m[1])
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
