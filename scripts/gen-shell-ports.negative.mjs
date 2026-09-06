#!/usr/bin/env node
/*
 * Proof that `gen-shell-ports.mjs --check` fails on a stale port table.
 *
 * The control is the freshly generated file, because a check that always
 * failed would satisfy the first case on its own. Three ways to be stale are
 * tested rather than one: a dropped port, a renamed port, and an ecosystem
 * home pointed somewhere else. They are distinct because the table is a
 * literal — a check comparing only the port count would pass the last two,
 * and that is the drift that actually happened (its own comment named a
 * `referenceMode` field `ports.ts` no longer has).
 */
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, 'gen-shell-ports.mjs')
const real = join(here, '..', 'site/public/_shell/shell.js')

function run(args) {
  try {
    return { code: 0, out: execFileSync('node', [script, ...args], { encoding: 'utf8', stdio: 'pipe' }) }
  } catch (err) {
    return { code: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

/** A copy of shell.js, regenerated so it is current by construction. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'gen-shell-ports-'))
  const file = join(dir, 'shell.js')
  copyFileSync(real, file)
  const wrote = run(['--file', file])
  if (wrote.code !== 0) {
    console.error(`FAIL could not generate a control fixture — ${wrote.out}`)
    process.exit(1)
  }
  return { dir, file }
}

let failures = 0
const check = (name, ok, detail) => {
  if (ok) console.log(`ok   ${name}`)
  else {
    console.error(`FAIL ${name} — ${detail}`)
    failures += 1
  }
}

// Control: generated then immediately checked, so it must be current.
{
  const { dir, file } = fixture()
  const res = run(['--check', '--file', file])
  check('a freshly generated table passes', res.code === 0, `exit ${res.code}: ${res.out.trim()}`)
  rmSync(dir, { recursive: true, force: true })
}

// Each mutation is applied to its own fresh fixture, so one case cannot mask
// another by leaving the file already broken.
const mutations = [
  ['a dropped port is caught', (s) => s.replace(/^ {4}\{"slug":"swift".*\n/m, '')],
  ['a renamed port is caught', (s) => s.replace('"name":"Python"', '"name":"Python 3"')],
  ['a moved ecosystem home is caught', (s) => s.replace('https://docs.rs/libtmux', 'https://example.invalid/libtmux')],
]

for (const [name, mutate] of mutations) {
  const { dir, file } = fixture()
  const before = readFileSync(file, 'utf8')
  const after = mutate(before)
  if (after === before) {
    check(name, false, 'the mutation changed nothing — the fixture no longer has what it targets')
    rmSync(dir, { recursive: true, force: true })
    continue
  }
  writeFileSync(file, after)
  const res = run(['--check', '--file', file])
  check(name, res.code === 1 && /stale/.test(res.out), `exit ${res.code}: ${res.out.trim()}`)
  rmSync(dir, { recursive: true, force: true })
}

if (failures) {
  console.error(`\ngen-shell-ports.negative: ${failures} case(s) did not behave as required.`)
  process.exit(1)
}
console.log('gen-shell-ports.negative: the staleness check can fail, and passes when current')
