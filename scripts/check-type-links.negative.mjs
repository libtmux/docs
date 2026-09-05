#!/usr/bin/env node
/*
 * Proof that check-type-links fails on the situations it exists for.
 *
 * The mangled-USR fixture reproduces the real markup, which nests one span per
 * fragment. That detail is the test: a first attempt at this detector matched
 * non-greedily to the first `</span>` and so read `s:s8CopyableP` as `s`,
 * reporting zero on a build carrying 527 of them. A fixture that wrote the USR
 * as flat text would have passed that broken detector.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-type-links.mjs')
const PORTS = ['py', 'ts', 'rs', 'go', 'java', 'dotnet', 'cxx', 'swift']

const linked = (n) => `<span class="api-type"><a href="/x/" class="api-type-link">${n}</a></span>`
const plain = (n) => `<span class="api-type"><span class="api-punct">${n}</span></span>`
/** As `ApiType` renders an unresolved USR: one span per fragment, nested. */
const usr = () =>
  '<span class="api-type"><span class="api-punct">s</span>' +
  '<span class="api-punct">:</span><span class="api-punct">s8CopyableP</span></span>'

/** A site where every port has `n` plain names, plus optional extras. */
function site({ n = 0, mangled = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'check-type-links-'))
  for (const p of PORTS) {
    const d = join(dir, 'reference', p, 'thing')
    mkdirSync(d, { recursive: true })
    const body =
      linked('Server') +
      Array.from({ length: n }, (_, i) => plain(`Plain${i}`)).join('') +
      (mangled ? usr() : '')
    writeFileSync(join(d, 'index.html'), `<html><body>${body}</body></html>`)
  }
  return dir
}

function run(dir, ceilings, extra = [], omit = []) {
  const f = join(dir, 'ceiling.json')
  const recordedPorts = PORTS.filter((p) => !omit.includes(p))
  writeFileSync(f, `${JSON.stringify(Object.fromEntries(recordedPorts.map((p) => [p, ceilings])), null, 2)}\n`)
  let code = 0
  let out = ''
  try {
    out = execFileSync('node', [script, dir, '--ceiling', f, ...extra], { encoding: 'utf8', stdio: 'pipe' })
  } catch (err) {
    code = err.status
    out = `${err.stdout ?? ''}${err.stderr ?? ''}`
  }
  return { code, out, recorded: JSON.parse(readFileSync(f, 'utf8')).go }
}

let failures = 0
const check = (name, ok, detail) => {
  if (ok) console.log(`ok   ${name}`)
  else {
    console.error(`FAIL ${name} — ${detail}`)
    failures++
  }
}

{
  // A mangled id is never acceptable, ceiling or no ceiling.
  const dir = site({ n: 0, mangled: true })
  const { code, out } = run(dir, 99)
  check(
    'a mangled id fails on sight',
    code !== 0 && out.includes('s:s8CopyableP'),
    `exited ${code} without naming the id:\n${out}`,
  )
  rmSync(dir, { recursive: true, force: true })
}

{
  // The control. Without it, a script that always failed would pass every
  // case above.
  const dir = site({ n: 5 })
  const { code, out } = run(dir, 5)
  check('a site at its ceiling passes', code === 0, `exited ${code}:\n${out}`)
  rmSync(dir, { recursive: true, force: true })
}

{
  const dir = site({ n: 9 })
  const { code, out } = run(dir, 5)
  check(
    'more plain names than the ceiling fails',
    code !== 0 && out.includes('ceiling allows'),
    `exited ${code}:\n${out}`,
  )
  rmSync(dir, { recursive: true, force: true })
}

{
  // The --update path, where a missing entry used to default to infinity and
  // so could never be judged a rise. Recording a first baseline and a renamed
  // slug arriving with no history look identical here, and only one of them
  // is intended.
  const dir = site({ n: 9 })
  const { code, out, recorded } = run(dir, 5, ['--update'], ['go'])
  check(
    'rebaselining an unrecorded port needs --force',
    code !== 0 && out.includes('refusing to raise') && out.includes('go') && recorded === undefined,
    `exited ${code}, go now ${recorded}:\n${out}`,
  )
  rmSync(dir, { recursive: true, force: true })
}

{
  const dir = site({ n: 9 })
  const { code, recorded } = run(dir, 5, ['--update', '--force'], ['go'])
  check('--force records the new port', code === 0 && recorded === 9, `exited ${code}, go now ${recorded}`)
  rmSync(dir, { recursive: true, force: true })
}

{
  /*
   * A port the record does not mention. Defaulting it happens to fail closed
   * in this direction, but it reports an unrecorded port as a resolution
   * regression, sending the reader after a defect that is not there.
   */
  const dir = site({ n: 5 })
  const { code, out } = run(dir, 5, [], ['go'])
  check(
    'an unrecorded port is named as such',
    code !== 0 && out.includes('no ceiling recorded for go'),
    `exited ${code}:\n${out}`,
  )
  rmSync(dir, { recursive: true, force: true })
}

{
  // The ratchet guard: refusing must leave the record untouched, which an
  // exit code alone cannot show.
  const dir = site({ n: 9 })
  const { code, out, recorded } = run(dir, 5, ['--update'])
  check(
    'raising the ceiling is refused',
    code !== 0 && out.includes('refusing to raise') && recorded === 5,
    `exited ${code}, ceiling now ${recorded}:\n${out}`,
  )
  rmSync(dir, { recursive: true, force: true })
}

{
  const dir = site({ n: 9 })
  const { code, recorded } = run(dir, 5, ['--update', '--force'])
  check(
    '--force writes the true count',
    code === 0 && recorded === 9,
    `exited ${code}, ceiling now ${recorded} (wanted 9)`,
  )
  rmSync(dir, { recursive: true, force: true })
}

{
  const dir = site({ n: 2 })
  const { code, recorded } = run(dir, 5, ['--update'])
  check('lowering the ceiling is allowed', code === 0 && recorded === 2, `exited ${code}, ceiling now ${recorded}`)
  rmSync(dir, { recursive: true, force: true })
}

if (failures) {
  console.error(`\ncheck-type-links cannot detect ${failures} of the situations it exists for.`)
  process.exit(1)
}
console.log('\ncheck-type-links.negative: mangled ids fail, the ceiling holds, and it only moves down')
