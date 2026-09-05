#!/usr/bin/env node
/*
 * Proof that check-xrefs fails when cross-reference resolution falls.
 *
 * Builds a miniature `_site` whose pages carry a known number of resolved
 * anchors, then runs the real script against it with a floor it cannot meet.
 * The control raises the same tree past its floor and must pass — without it,
 * a script that always failed would satisfy every case below.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-xrefs.mjs')
const PORTS = ['py', 'ts', 'rs', 'go', 'java', 'dotnet', 'cxx', 'swift']

/** A tree where every port has `n` resolved anchors. */
function site(n) {
  const dir = mkdtempSync(join(tmpdir(), 'check-xrefs-'))
  for (const p of PORTS) {
    const d = join(dir, 'reference', p, 'thing')
    mkdirSync(d, { recursive: true })
    const anchors = Array.from({ length: n }, () => '<a class="api-xref" href="/x/">x</a>').join('')
    writeFileSync(join(d, 'index.html'), `<html><body>${anchors}</body></html>`)
  }
  return dir
}

function run(dir, floor) {
  const f = join(dir, 'floor.json')
  writeFileSync(f, JSON.stringify(Object.fromEntries(PORTS.map((p) => [p, floor]))))
  try {
    return { code: 0, out: execFileSync('node', [script, dir, '--floor', f], { encoding: 'utf8', stdio: 'pipe' }) }
  } catch (err) {
    return { code: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

let failures = 0
const CASES = [
  { name: 'resolution fell', built: 2, floor: 10, mustFail: true },
  { name: 'resolution held', built: 10, floor: 10, mustFail: false },
]

for (const c of CASES) {
  const dir = site(c.built)
  try {
    const { code, out } = run(dir, c.floor)
    if (c.mustFail && code === 0) {
      console.error(`FAIL ${c.name} — ${c.built} resolved against a floor of ${c.floor} passed`)
      failures++
    } else if (c.mustFail && !out.includes('resolution fell on')) {
      console.error(`FAIL ${c.name} — exited ${code} without naming the drop:\n${out}`)
      failures++
    } else if (!c.mustFail && code !== 0) {
      console.error(`FAIL ${c.name} — a tree at its floor exited ${code}:\n${out}`)
      failures++
    } else {
      console.log(`ok   ${c.name.padEnd(16)} built ${c.built} vs floor ${c.floor} -> exit ${code}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/*
 * The ratchet's second job. Detecting a fall is only half of it: `--update`
 * must refuse to walk the floor down to meet a collapse, and a refusal has to
 * leave the record untouched — an exit code that still rewrote the file is the
 * failure this case exists to catch. `--force` then has to write the true
 * count, not hand back the inflated record it overrode.
 */
function update(dir, floor, force) {
  const f = join(dir, 'floor.json')
  writeFileSync(f, `${JSON.stringify(Object.fromEntries(PORTS.map((p) => [p, floor])), null, 2)}\n`)
  const argv = [script, dir, '--floor', f, '--update', ...(force ? ['--force'] : [])]
  let code = 0
  let out = ''
  try {
    out = execFileSync('node', argv, { encoding: 'utf8', stdio: 'pipe' })
  } catch (err) {
    code = err.status
    out = `${err.stdout ?? ''}${err.stderr ?? ''}`
  }
  return { code, out, recorded: JSON.parse(readFileSync(f, 'utf8')).go }
}

const GUARDS = [
  { name: 'lowering refused', built: 2, floor: 10, wantCode: 1, wantFloor: 10, says: 'refusing to lower' },
  { name: 'lowering forced', built: 2, floor: 10, force: true, wantCode: 0, wantFloor: 2 },
  { name: 'raising allowed', built: 10, floor: 2, wantCode: 0, wantFloor: 10 },
]

for (const c of GUARDS) {
  const dir = site(c.built)
  try {
    const { code, out, recorded } = update(dir, c.floor, c.force)
    if (code !== c.wantCode) {
      console.error(`FAIL ${c.name} — exited ${code}, wanted ${c.wantCode}:\n${out}`)
      failures++
    } else if (recorded !== c.wantFloor) {
      console.error(`FAIL ${c.name} — floor left at ${recorded}, wanted ${c.wantFloor}`)
      failures++
    } else if (c.says && !out.includes(c.says)) {
      console.error(`FAIL ${c.name} — exited ${code} without saying why:\n${out}`)
      failures++
    } else {
      const how = c.force ? ' --force' : ''
      console.log(`ok   ${c.name.padEnd(16)} built ${c.built} vs floor ${c.floor}${how} -> exit ${code}, floor now ${recorded}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (failures) {
  console.error(`\ncheck-xrefs cannot detect ${failures} of the situations it exists for.`)
  process.exit(1)
}
console.log('\ncheck-xrefs.negative: the floor catches a fall, passes a hold, and only moves up')
