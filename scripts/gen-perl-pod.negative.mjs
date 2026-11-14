#!/usr/bin/env node
/*
 * Proof that `gen-perl-pod.mjs --check --offline` can still fail.
 *
 * Offline, the check reads the committed record and reports what a link could
 * not be built from. A check that passed any file would pass the control too,
 * so the control is a copy of the committed record and each case edits its own
 * copy: a distribution dropped, a digest that is not one, a package that names
 * a document the record lacks, a fragment listed twice, a release written in
 * another grammar, and a file that is not what the generator writes byte for
 * byte. None of them reaches the network.
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, 'gen-perl-pod.mjs')
const real = join(here, '..', 'site/src/data/perl-pod.json')

function run(file) {
  try {
    return { code: 0, out: execFileSync('node', [script, '--check', '--offline', '--out', file], { encoding: 'utf8', stdio: 'pipe' }) }
  } catch (err) {
    return { code: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

let failures = 0
const check = (name, ok, detail) => {
  if (ok) console.log(`ok   ${name}`)
  else {
    console.error(`FAIL ${name} - ${detail}`)
    failures += 1
  }
}
const edited = (change) => `${JSON.stringify(change(JSON.parse(readFileSync(real, 'utf8'))), null, 2)}\n`

{
  const dir = mkdtempSync(join(tmpdir(), 'gen-perl-pod-'))
  const file = join(dir, 'perl-pod.json')
  copyFileSync(real, file)
  const res = run(file)
  check('the committed record passes', res.code === 0 && /is well formed/.test(res.out), `exit ${res.code}: ${res.out.trim()}`)
  rmSync(dir, { recursive: true, force: true })
}

const mutations = [
  ['a dropped distribution is caught', edited((data) => { delete data.distributions['LibTmux-Async']; return data }), /LibTmux-Async has no recorded release/],
  ['a record for a distribution the port lacks is caught', edited((data) => { data.distributions['LibTmux-Mcp'] = data.distributions.LibTmux; return data }), /LibTmux-Mcp is recorded but not a package of the port/],
  ['a digest that is not a SHA-256 is caught', edited((data) => { data.distributions.LibTmux.documents['LibTmux::Server'].sha256 = 'abc'; return data }), /LibTmux::Server has no SHA-256/],
  ['a package that names a document the record lacks is caught', edited((data) => { data.distributions.LibTmux.packages['LibTmux::Server'] = 'LibTmux::Missing'; return data }), /documented by LibTmux::Missing, which the record lacks/],
  ['a fragment listed twice is caught', edited((data) => { data.distributions.LibTmux.documents['LibTmux::Server'].anchors.push('new'); return data }), /lists its fragments wrongly/],
  ['a release in another grammar is caught', edited((data) => { data.distributions.LibTmux.release = '0.0.3'; return data }), /release "0\.0\.3" is not a decimal version/],
  ['another schema is caught', edited((data) => ({ ...data, schema: 2 })), /schema is 2, expected 1/],
  ['a file the generator would not write is caught', `${JSON.stringify(JSON.parse(readFileSync(real, 'utf8')))}\n`, /not what the generator writes byte for byte/],
]

for (const [name, text, pattern] of mutations) {
  const dir = mkdtempSync(join(tmpdir(), 'gen-perl-pod-'))
  const file = join(dir, 'perl-pod.json')
  writeFileSync(file, text)
  const res = run(file)
  check(name, res.code === 1 && pattern.test(res.out), `exit ${res.code}: ${res.out.trim()}`)
  rmSync(dir, { recursive: true, force: true })
}

if (failures) {
  console.error(`\ngen-perl-pod.negative: ${failures} case(s) did not behave as required.`)
  process.exit(1)
}
console.log('gen-perl-pod.negative: the offline record check can fail')
