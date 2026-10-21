#!/usr/bin/env node
/*
 * Proof that every refusal in site-bundle.mjs is load-bearing.
 *
 * site-bundle.negative.mjs passes when the script refuses what it should, but
 * a rule nobody exercises could be deleted and leave it green. This copies the
 * script once per rule, switches that one rule off with a text replacement,
 * runs the negative against the copy, and requires the negative to fail. The
 * unmodified copy must pass first, and a replacement that does not match
 * exactly once aborts the run, so a rewrite of the script cannot turn a rule
 * into an unchecked one.
 *
 * Usage: node scripts/site-bundle.mutations.mjs
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'site-bundle.mjs'), 'utf8')
const negative = join(here, 'site-bundle.negative.mjs')

const rules = [
  ['an absolute name or link target', "if (name.startsWith('/')) return", 'if (false) return'],
  ['a ".." segment in a name or link target', "if (name.split('/').includes('..')) return", 'if (false) return'],
  ['an absolute symlink target', "if (link === '' || link.startsWith('/')) fail(", 'if (false) fail('],
  ['a symlink target that climbs out', 'else if (resolved.pop() === undefined) fail(', 'else if (false) fail('],
  ['a hard link target outside the destination', 'if (escapeOf(link)) fail(', 'if (false) fail('],
  ['a hard link to anything but an earlier regular file', "if (kinds.get(target.join('/')) !== 'file') fail(", 'if (false) fail('],
  ['a hard link through a symlink', 'throughOf(target.slice(0, -1)', 'void (target.slice(0, -1)'],
  ['a member through a symlink', "if (kinds.get(parent) === 'symlink') fail(", 'if (false) fail('],
  ['a member through a file', "if (kinds.get(parent) === 'file') fail(", 'if (false) fail('],
  ['a type other than file, directory or link', 'if (!kind) fail(', 'if (false) fail('],
  ['a repeated name', 'if (listed.has(path)) fail(', 'if (false) fail('],
  ['a link over a directory an earlier member created', "if (kind !== 'dir' && kinds.get(path) === 'dir') fail(", 'if (false) fail('],
  ['the destination as a non-directory', "if (path === '' && kind !== 'dir') fail(", 'if (false) fail('],
  ['a listing line the scan cannot read', 'if (!parsed) fail(', 'if (false) fail('],
  ['a quoting escape the scan cannot read', 'else fail(`tar quoted', 'else bytes.push(63); void (`tar quoted'],
  ['tar failing while it lists', 'if ((await closed) !== 0) fail(', 'if (false) fail('],
  ['a missing archive', 'if (!existsSync(join(first, ARCHIVE))) fail(', 'if (false) fail('],
  ['tar failing while it extracts', 'if (extracted.status !== 0) fail(', 'if (false) fail('],
  ['control characters in a name reaching the log', 'if (code >= 0x20 && code !== 0x7f) return char', 'if (true) return char'],
  ['the scan itself', 'const scanned = await scan(join(first, ARCHIVE))', 'const scanned = 0'],
  ['a destination that already holds files', 'if (readdirSync(second).length > 0) fail(', 'if (false) fail('],
  ['an archive that does not hash to its manifest', 'if (archive !== manifest.tar) fail(', 'if (false) fail('],
  ['a digest other than the one the producer reported', 'if (expected !== undefined && actual !== expected) {', 'if (false) {'],
  ['a tree that does not hash to its manifest', 'if (found.tree !== manifest.tree) {', 'if (false) {'],
  ['the quoting style tar lists names in', "'--quoting-style=c'", "'--quoting-style=literal'"],
  ['the padding tar puts between listing columns', '/^(\\S)\\S{9} +\\S+ +\\S+ +\\S+ +\\S+ +("', '/^(\\S)\\S{9} \\S+ +\\S+ \\S+ \\S+ ("'],
]

const scratch = mkdtempSync(join(tmpdir(), 'libtmux-site-bundle-mutations-'))

function negativeAgainst(name, text) {
  const copy = join(scratch, `${name}.mjs`)
  writeFileSync(copy, text)
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [negative], { env: { ...process.env, LIBTMUX_SITE_BUNDLE_SCRIPT: copy }, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => resolve({ code, stderr }))
  })
}

try {
  const baseline = await negativeAgainst('baseline', source)
  if (baseline.code !== 0) {
    console.error(`site-bundle.mutations: the unmodified script fails its own negative:\n${baseline.stderr}`)
    process.exit(1)
  }
  console.log('ok   the unmodified script passes the negative')

  const queue = rules.map(([rule, find, replace], index) => {
    const matches = source.split(find).length - 1
    if (matches !== 1) {
      console.error(`site-bundle.mutations: "${rule}" matches ${matches} times in site-bundle.mjs; update the rule`)
      process.exit(1)
    }
    return { rule, text: source.replace(find, () => replace), name: `rule-${index}` }
  })
  const results = []
  const workers = Array.from({ length: 4 }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const { code, stderr } = await negativeAgainst(next.name, next.text)
      const caught = /^(?:AssertionError.*|.*Error.*)$/m.exec(stderr)?.[0] ?? stderr.trim().split('\n')[0]
      results.push({ rule: next.rule, survived: code === 0, caught })
    }
  })
  await Promise.all(workers)

  results.sort((a, b) => rules.findIndex(([rule]) => rule === a.rule) - rules.findIndex(([rule]) => rule === b.rule))
  let survivors = 0
  for (const { rule, survived, caught } of results) {
    if (survived) survivors += 1
    console.log(`${survived ? 'FAIL' : 'ok  '} switching off ${rule}${survived ? ' left the negative green' : ` fails it: ${caught.slice(0, 110)}`}`)
  }
  if (survivors > 0) {
    console.error(`site-bundle.mutations: ${survivors} rule(s) are not exercised by site-bundle.negative.mjs`)
    process.exit(1)
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
