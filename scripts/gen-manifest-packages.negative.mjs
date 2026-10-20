#!/usr/bin/env node
/*
 * Proof that `gen-manifest-packages.mjs --check` can still fail.
 *
 * The check compares the committed file with what the pinned manifests say, so
 * it needs the port checkouts; with any absent it reports that and passes, and
 * this proof then has nothing to prove and says so. The control is a copy of
 * the committed file. Each case edits its own copy the way a hand edit would:
 * a version bumped, a package dropped, a package invented.
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, 'gen-manifest-packages.mjs')
const real = join(here, '..', 'site/src/data/manifest-packages.json')

function run(file) {
  try {
    return { code: 0, out: execFileSync('node', [script, '--check', '--out', file], { encoding: 'utf8', stdio: 'pipe' }) }
  } catch (error) {
    return { code: error.status, out: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

const dir = mkdtempSync(join(tmpdir(), 'gen-manifest-packages-'))
const control = run(real)
if (/not checked/.test(control.out)) {
  console.log('skip the proof: a port checkout or revision is absent, so the check itself is skipped')
  rmSync(dir, { recursive: true, force: true })
  process.exit(0)
}

let failures = 0
const check = (name, ok, detail) => {
  if (ok) console.log(`ok   ${name}`)
  else {
    console.error(`FAIL ${name} — ${detail}`)
    failures += 1
  }
}
check('the committed file passes', control.code === 0, `exit ${control.code}: ${control.out.trim()}`)

const mutations = [
  ['a hand-edited version is caught', (data) => { data.ports.rs.distributions[0].version = '9.9.9' }],
  ['a dropped package is caught', (data) => { data.ports.ts.distributions.pop() }],
  ['an invented package is caught', (data) => { data.ports.py.distributions.push({ name: 'invented', version: '1.0.0', manifest: 'pyproject.toml', repo: 'x/y', revision: 'abc' }) }],
  ['a dropped unit is caught', (data) => { data.ports.go.units.pop() }],
]
for (const [name, mutate] of mutations) {
  const file = join(dir, 'manifest-packages.json')
  copyFileSync(real, file)
  const data = JSON.parse(readFileSync(file, 'utf8'))
  mutate(data)
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
  const result = run(file)
  check(name, result.code === 1 && /out of date/.test(result.out), `exit ${result.code}: ${result.out.trim()}`)
}
rmSync(dir, { recursive: true, force: true })
if (failures > 0) process.exit(1)
