#!/usr/bin/env node
/*
 * Proof that runInArenaMulti rejects every way N evidence records can
 * misreport which source produced which, and that a run whose server is
 * replaced partway through is caught whichever source replaced it.
 *
 * Uses the same fixture adapter docs-arena.negative.mjs exercises for the
 * one-record contract; DOCS_ARENA_FIXTURE_SOURCES switches it to N records.
 * Starts and talks to a real tmux server, like that negative does.
 */
import { fileURLToPath } from 'node:url'
import { ArenaFailure, resolveTmux, runInArenaMulti } from './arena/supervisor.mjs'

const fixture = fileURLToPath(new URL('./arena/fixture-adapter.mjs', import.meta.url))
const tmuxBin = resolveTmux()
const SOURCES = ['docs/one.md', 'docs/two.md', 'docs/three.md']
const target = (mode, sources = SOURCES, deadlineMs = 10_000) => ({
  tmuxBin,
  artifact: 'docs-arena-fixture',
  sources,
  command: [process.execPath, fixture],
  cwd: process.cwd(),
  env: { DOCS_ARENA_FIXTURE_MODE: mode, DOCS_ARENA_FIXTURE_SOURCES: sources.join(',') },
  deadlineMs,
})

let failures = 0
async function expectPass(name, run, wantCount) {
  try {
    const records = await run
    if (wantCount !== undefined && records.length !== wantCount) {
      failures += 1
      console.error(`FAILED  ${name}: expected ${wantCount} record(s), got ${records.length}`)
    } else {
      console.log(`ok      ${name} (${records.length} record(s))`)
    }
  } catch (error) {
    failures += 1
    console.error(`FAILED  ${name}: the control was rejected: ${error.message}`)
  }
}
async function expectReject(name, run, fragment) {
  try {
    await run
    failures += 1
    console.error(`FAILED  ${name}: accepted`)
  } catch (error) {
    if (error instanceof ArenaFailure && error.message.includes(fragment)) console.log(`ok      ${name} rejected`)
    else {
      failures += 1
      console.error(`FAILED  ${name}: rejected for the wrong reason: ${error.message}`)
    }
  }
}

await expectPass('conforming N-record adapter', runInArenaMulti(target('multi')), SOURCES.length)
await expectReject('duplicate source', runInArenaMulti(target('multi-duplicate')), 'more than once')
await expectReject('missing declared source', runInArenaMulti(target('multi-missing')), 'no evidence record named declared source')
await expectReject('a record missing its source field', runInArenaMulti(target('multi-no-source')), 'missing its source')
await expectReject('a mismatched challenge on one record', runInArenaMulti(target('multi-bad-challenge')), 'challenge is not the one')
await expectReject('a record for an undeclared source', runInArenaMulti(target('multi-undeclared')), 'not declared for this artifact')
await expectReject('the lent server replaced between sources', runInArenaMulti(target('multi-replaced')), 'exited or changed during the run')
await expectPass('a single declared source still works', runInArenaMulti(target('multi', ['docs/one.md'])), 1)

if (failures) {
  console.error(`docs arena (EV negative): ${failures} expectation(s) failed`)
  process.exit(1)
}
console.log('docs arena (EV negative): every defect rejected; the control(s) passed')
