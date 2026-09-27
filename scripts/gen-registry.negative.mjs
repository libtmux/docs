#!/usr/bin/env node
/*
 * Proof that `gen-registry.mjs --check --offline` can still fail.
 *
 * Offline, the check re-emits the committed entries and compares the file with
 * that. A check that compared a file with itself would pass anything, so the
 * control is a copy of the committed file and each case edits its own copy:
 * a dropped port, a version edited by hand, and a file that is not what the
 * generator writes byte for byte. None of them touches the network, which is
 * the point of running the gate offline.
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, 'gen-registry.mjs')
const real = join(here, '..', 'site/src/data/registry.json')

function run(file) {
  try {
    const out = execFileSync('node', [script, '--check', '--offline', '--out', file], { encoding: 'utf8', stdio: 'pipe' })
    return { code: 0, out }
  } catch (err) {
    return { code: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

/** A copy of the committed registry in a directory of its own. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'gen-registry-'))
  const file = join(dir, 'registry.json')
  copyFileSync(real, file)
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

{
  const { dir, file } = fixture()
  const res = run(file)
  check('the committed registry passes', res.code === 0, `exit ${res.code}: ${res.out.trim()}`)
  rmSync(dir, { recursive: true, force: true })
}

const mutations = [
  ['a dropped port is caught', (s) => {
    const data = JSON.parse(s)
    delete data.ports.rs
    return `${JSON.stringify(data, null, 2)}\n`
  }],
  ['a hand-edited version is caught', (s) => s.replace(/("rs": \{\n\s+"status": "\w+",\n\s+"version": ")([^"]+)"/, '$10.0.0-edited"')],
  ['a file the generator would not write is caught', (s) => `${JSON.stringify(JSON.parse(s))}\n`],
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
  const res = run(file)
  check(name, res.code === 1 && /out of date/.test(res.out), `exit ${res.code}: ${res.out.trim()}`)
  rmSync(dir, { recursive: true, force: true })
}

if (failures) {
  console.error(`\ngen-registry.negative: ${failures} case(s) did not behave as required.`)
  process.exit(1)
}
console.log('gen-registry.negative: the offline check can fail, and passes on the committed file')
