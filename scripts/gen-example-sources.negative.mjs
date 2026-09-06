#!/usr/bin/env node
/*
 * Proof that `gen-example-sources.mjs --check` fails on a stale cache.
 *
 * The control is a freshly generated fixture, because a check that always
 * failed would satisfy the drift case on its own.
 *
 * Two ways to be stale are tested, because they are different failures. An
 * edited source is the everyday one: a port changes the example it tests and
 * the committed copy still shows the old code, which is the drift the cache
 * exists to make visible rather than to hide. A dropped entry is the one that
 * would break a build rather than mislead a reader — `readFence` throws when
 * a source is in neither the checkout nor the cache.
 */
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), 'gen-example-sources.mjs')

function run(args) {
  try {
    return { code: 0, out: execFileSync('node', [script, ...args], { encoding: 'utf8', stdio: 'pipe' }) }
  } catch (err) {
    return { code: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

const dir = mkdtempSync(join(tmpdir(), 'gen-example-sources-'))
const fixture = join(dir, 'cache.json')

let failures = 0
const check = (name, ok, detail) => {
  if (ok) console.log(`ok   ${name}`)
  else {
    console.error(`FAIL ${name} — ${detail}`)
    failures += 1
  }
}

const generated = run(['--out', fixture])
if (generated.code !== 0) {
  console.error(`FAIL could not generate a control fixture — ${generated.out}`)
  process.exit(1)
}
const pristine = readFileSync(fixture, 'utf8')

{
  const res = run(['--check', '--out', fixture])
  check('a freshly generated cache passes', res.code === 0 && /matches/.test(res.out), `exit ${res.code}: ${res.out.trim()}`)
}

const mutations = [
  [
    'an edited source is caught',
    (d) => {
      const k = Object.keys(d).sort()[0]
      return { ...d, [k]: `${d[k]}\n// drifted\n` }
    },
  ],
  [
    'a dropped entry is caught',
    (d) => {
      const { [Object.keys(d).sort()[0]]: _gone, ...rest } = d
      return rest
    },
  ],
]

for (const [name, mutate] of mutations) {
  const before = JSON.parse(pristine)
  const after = mutate(before)
  writeFileSync(fixture, `${JSON.stringify(after, null, 2)}\n`)
  const res = run(['--check', '--out', fixture])
  check(name, res.code === 1 && /stale/.test(res.out), `exit ${res.code}: ${res.out.trim()}`)
}

rmSync(dir, { recursive: true, force: true })

if (failures) {
  console.error(`\ngen-example-sources.negative: ${failures} case(s) did not behave as required.`)
  process.exit(1)
}
console.log('gen-example-sources.negative: the staleness check can fail, and passes when current')
