#!/usr/bin/env node
/*
 * Hard-coded greys, ratcheted down.
 *
 * The site has a palette — gp-sphinx's, loaded on every page from
 * `site/src/styles/gp-sphinx-tokens.css` and exposed as `bg-surface`,
 * `border-edge`, `text-muted` and `bg-surface-hover`. Anything written as
 * `border-slate-200 dark:border-slate-800` instead is two hard-coded greys
 * that have to be kept in step by hand, and they were not: the cards on the
 * port pages used a different grey from the API entries below them, and the
 * dark halves drifted apart because only one of the pair ever got edited.
 *
 * A ceiling rather than zero. The rest are real work — chart axes, syntax
 * highlighting, one-off page chrome — and a check that demands perfection on
 * day one gets suppressed. This one only has to stop the number going up.
 *
 * Comment text is skipped so a comment may name the classes it replaced.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
/* `--ceiling` points at a different record so `check-palette.negative.mjs` can
 * exercise --update without rewriting the ceiling this repo ships. */
const ceilingArg = process.argv.indexOf('--ceiling')
const CEILING_FILE =
  ceilingArg === -1 ? join(root, 'scripts/palette-ceiling.json') : process.argv[ceilingArg + 1]
const PATTERN = /(?:bg|text|border|ring|divide|from|via|to)-(?:slate|gray|zinc|neutral|stone)-\d{2,3}/g

const args = process.argv.slice(2)
const dir = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : join(root, 'site/src')

const files = execFileSync('rg', ['-l', '--glob', '*.{astro,ts,tsx,css}', PATTERN.source, dir], {
  encoding: 'utf8',
}).trim().split('\n').filter(Boolean)

/** Strip block comments and `//` lines so prose about the old classes is free. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/\S/g, ' ')).replace(/^\s*\/\/.*$/gm, '')

const hits = []
for (const file of files) {
  const src = stripComments(readFileSync(file, 'utf8'))
  src.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(PATTERN)) {
      hits.push({ file: relative(root, file), line: i + 1, cls: m[0] })
    }
  })
}

if (args.includes('--update')) {
  // The mirror of check-xrefs: this ceiling only ever comes down. Raising it
  // is how a ratchet quietly becomes a record of whatever happened.
  const current = JSON.parse(readFileSync(CEILING_FILE, 'utf8')).ceiling
  if (hits.length > current && !args.includes('--force')) {
    console.error(
      `check-palette: refusing to raise the ceiling from ${current} to ${hits.length}.\n` +
        `Use bg-surface, bg-surface-hover, border-edge and text-muted instead, or\n` +
        `pass --force if more hard-coded greys really are the intended outcome.`,
    )
    process.exit(1)
  }
  writeFileSync(CEILING_FILE, `${JSON.stringify({ ceiling: hits.length }, null, 2)}\n`)
  console.log(`check-palette: ceiling set to ${hits.length}`)
  process.exit(0)
}

if (args.includes('--list')) {
  for (const h of hits) console.log(`${h.file}:${h.line}  ${h.cls}`)
}

const { ceiling } = JSON.parse(readFileSync(CEILING_FILE, 'utf8'))

if (hits.length > ceiling) {
  const byFile = new Map()
  for (const h of hits) byFile.set(h.file, (byFile.get(h.file) ?? 0) + 1)
  console.error(
    `check-palette: ${hits.length} hard-coded palette utilities, ceiling is ${ceiling}.\n`,
  )
  for (const [f, n] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.error(`    ${String(n).padStart(3)}  ${f}`)
  }
  console.error(
    `\nUse the palette instead: bg-surface, bg-surface-hover, border-edge, text-muted.` +
      `\nThey resolve through gp-sphinx's tokens, so they are correct in both themes` +
      `\nand need no \`dark:\` twin. Run with --list to see every one.`,
  )
  process.exit(1)
}

if (hits.length < ceiling) {
  console.log(
    `check-palette: ${hits.length} hard-coded palette utilities, below the ceiling of ${ceiling}.`,
  )
  console.log(`Lower it: node scripts/check-palette.mjs --update`)
  process.exit(1)
}

console.log(`check-palette: ${hits.length} hard-coded palette utilities, at the ceiling`)
