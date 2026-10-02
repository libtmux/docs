#!/usr/bin/env node
/*
 * Proof that the docs arena rejects every way an adapter can claim contact it
 * did not make, or reach a server it was not lent.
 *
 * The control is a fixture adapter that follows the contract, because a
 * supervisor that rejected everything would satisfy each defect on its own.
 * Each defect breaks one thing the supervisor checks: the evidence record's
 * count, artifact, challenge, and socket; the lent server's survival; the
 * exit status; the deadline; and whether any other server appears. Under an
 * incomplete contract the control fails closed, and the defects exit 0 or
 * fall back to a default server instead.
 */
import { fileURLToPath } from 'node:url'
import { ArenaFailure, resolveTmux, runFailClosed, runInArena } from './arena/supervisor.mjs'

const fixture = fileURLToPath(new URL('./arena/fixture-adapter.mjs', import.meta.url))
const tmuxBin = resolveTmux()
const target = (mode, deadlineMs = 10_000) => ({
  tmuxBin,
  artifact: 'docs-arena-fixture',
  command: [process.execPath, fixture],
  cwd: process.cwd(),
  env: { DOCS_ARENA_FIXTURE_MODE: mode },
  deadlineMs,
})

let failures = 0
async function expectPass(name, run) {
  try {
    await run
    console.log(`ok      ${name}`)
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

await expectPass('conforming adapter', runInArena(target('conform')))
await expectReject('no evidence', runInArena(target('silent')), 'evidence records')
await expectReject('two evidence records', runInArena(target('twice')), 'evidence records')
await expectReject('another artifact', runInArena(target('artifact')), 'names artifact')
await expectReject('a guessed challenge', runInArena(target('challenge')), 'challenge')
await expectReject('another socket', runInArena(target('socket')), 'lent socket')
await expectReject('adapter stops the lent server', runInArena(target('kill')), 'exited or changed')
await expectReject('nonzero exit after evidence', runInArena(target('exit')), 'exited with 3')
await expectReject('a missed deadline', runInArena(target('hang', 1_000)), 'deadline')
await expectReject('an extra server', runInArena(target('extra')), 'extra tmux server')
await expectPass('conforming adapter fails closed', runFailClosed(target('conform')))
await expectReject('success under an incomplete contract', runFailClosed(target('lenient')), 'exited 0')
await expectReject('a default-server fallback', runFailClosed(target('ambient')), 'default tmux server')

if (failures) {
  console.error(`docs arena (negative): ${failures} expectation(s) failed`)
  process.exit(1)
}
console.log('docs arena (negative): every defect rejected; the control passed')
