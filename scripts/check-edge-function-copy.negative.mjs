#!/usr/bin/env node
/*
 * Proof that check-edge-function-copy fails on a drifted copy.
 *
 * The control is two identical files, because a check that always failed
 * would satisfy the drift case on its own. The skip case is tested too: the
 * check is only useful if a fresh clone with no infrastructure checkout still
 * passes, and "exits 0" alone cannot tell a skip from a real comparison.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-edge-function-copy.mjs')

function run(args) {
  try {
    return { code: 0, out: execFileSync('node', [script, ...args], { encoding: 'utf8', stdio: 'pipe' }) }
  } catch (err) {
    return { code: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

const dir = mkdtempSync(join(tmpdir(), 'edge-function-copy-'))
const ours = join(dir, 'ours.js')
const theirs = join(dir, 'theirs.js')
const BODY = "function handler(event) {\n    var uri = event.request.uri\n    return event.request\n}\n"

let failures = 0
const check = (name, ok, detail) => {
  if (ok) console.log(`ok   ${name}`)
  else {
    console.error(`FAIL ${name} — ${detail}`)
    failures += 1
  }
}

writeFileSync(ours, BODY)
writeFileSync(theirs, BODY)
{
  const res = run(['--ours', ours, '--theirs', theirs])
  check('identical copies pass', res.code === 0 && /matches/.test(res.out), `exit ${res.code}: ${res.out.trim()}`)
}

// A one-line edit, of the kind that would actually happen: an extension
// dropped from the allowlist changes one line deep inside the file.
writeFileSync(theirs, BODY.replace('var uri = event.request.uri', 'var uri = event.request.uri // stale'))
{
  const res = run(['--ours', ours, '--theirs', theirs])
  check(
    'a drifted copy is caught',
    res.code === 1 && /drifted/.test(res.out),
    `exit ${res.code}: ${res.out.trim()}`,
  )
  check(
    'the report names the first differing line',
    /first difference at line 2/.test(res.out),
    `did not name line 2: ${res.out.trim()}`,
  )
}

// A fresh clone with no infrastructure checkout must still pass, and say so.
{
  const res = run(['--ours', ours, '--theirs', join(dir, 'absent.js')])
  check(
    'an absent infrastructure checkout skips rather than fails',
    res.code === 0 && /skipped/.test(res.out),
    `exit ${res.code}: ${res.out.trim()}`,
  )
}

rmSync(dir, { recursive: true, force: true })

if (failures) {
  console.error(`\ncheck-edge-function-copy.negative: ${failures} case(s) did not behave as required.`)
  process.exit(1)
}
console.log('check-edge-function-copy.negative: the drift check can fail, and passes when in sync')
