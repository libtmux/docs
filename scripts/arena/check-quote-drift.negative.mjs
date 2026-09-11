#!/usr/bin/env node
/*
 * Proof that check-quote-drift.mjs's region-aware comparison actually
 * distinguishes "the file changed" from "the file changed but the quoted
 * region didn't," and fails closed when a region can't be found at all.
 *
 * Reads files and nothing else, so it runs wherever the rest of the suite does.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KNOWN_DRIFT, applyKnownDrift, compareOne } from './check-quote-drift.mjs'

const dir = mkdtempSync(join(tmpdir(), 'quote-drift-negative-'))
const run = (name, content) => {
  const path = join(dir, name)
  writeFileSync(path, content)
  return path
}

let failures = 0
function expect(name, result, wantStatus, fragment) {
  const ok = result.status === wantStatus && (!fragment || result.reason.includes(fragment))
  if (ok) console.log(`ok      ${name}`)
  else {
    failures += 1
    console.error(`FAILED  ${name}: got ${result.status} — ${result.reason}`)
  }
}

// Control: identical whole file.
expect(
  'conforming whole file',
  compareOne('k', 'line one\nline two\n', run('a.txt', 'line one\nline two\n')),
  'pass',
)

// Whole-file drift: no region declared, content differs.
expect(
  'whole file drift',
  compareOne('k', 'line one\nline two\n', run('b.txt', 'line one\nCHANGED\n')),
  'fail',
  'whole file content differs',
)

// The java/dotnet shape: arena plumbing added around the reader-facing body.
// The whole file differs, but the marked region is byte-identical — must pass.
const quotedWithRegion = ['before', '// region: body', 'shared line', '// endregion', 'after'].join('\n')
const runWithSamePlumbingAdded = [
  'before',
  'import extra.plumbing;',
  '// region: body',
  'shared line',
  '// endregion',
  'arena evidence printing',
  'after',
].join('\n')
expect(
  'region matches despite unrelated file drift',
  compareOne('k', quotedWithRegion, run('c.txt', runWithSamePlumbingAdded), new Set(['body'])),
  'pass',
)

// The swift Waiting.swift shape: the marker itself exists only on the quoted
// side; the arena's copy of the file never got it.
const runWithoutMarker = ['before', 'shared line', 'after'].join('\n')
expect(
  'region missing on the run side',
  compareOne('k', quotedWithRegion, run('d.txt', runWithoutMarker), new Set(['body'])),
  'fail',
  'but not in the file the arena runs',
)

// The swift MCPEmbedding.swift shape: both sides carry the marker, but the
// text between the markers itself changed (a real API drift, not plumbing).
const runWithChangedRegion = ['before', '// region: body', 'DIFFERENT line', '// endregion', 'after'].join('\n')
expect(
  'region content differs on both sides',
  compareOne('k', quotedWithRegion, run('e.txt', runWithChangedRegion), new Set(['body'])),
  'fail',
  'region "body" content differs',
)

// Declaring a region the quoted source itself doesn't have is a fixture bug,
// not drift — must still fail, but distinguishably.
expect(
  'region missing on the quoted side',
  compareOne('k', 'no markers here\n', run('f.txt', quotedWithRegion), new Set(['body'])),
  'fail',
  'not found in the quoted source itself',
)

// The arena worktree lacks the file outright.
expect(
  'run file absent',
  compareOne('k', 'anything', join(dir, 'does-not-exist.txt')),
  'fail',
  'has no file at',
)

// The record of drift this repository has not closed yet only shrinks: a
// listed key that still mismatches is reported rather than failed, and one
// that has been fixed fails until its entry goes.
const listed = [...KNOWN_DRIFT.keys()][0]
expect(
  'a listed mismatch is reported, not failed',
  applyKnownDrift({ key: listed, status: 'fail', reason: 'whole file content differs' }),
  'known',
)
expect(
  'a listed key that now matches fails until the entry goes',
  applyKnownDrift({ key: listed, status: 'pass', reason: 'whole file matches' }),
  'fail',
  'delete the entry',
)
expect(
  'an unlisted mismatch still fails',
  applyKnownDrift({ key: 'nobody:listed.txt', status: 'fail', reason: 'whole file content differs' }),
  'fail',
)

rmSync(dir, { recursive: true, force: true })

if (failures) {
  console.error(`check-quote-drift (negative): ${failures} expectation(s) failed`)
  process.exit(1)
}
console.log('check-quote-drift (negative): every defect caught; every control passed')
