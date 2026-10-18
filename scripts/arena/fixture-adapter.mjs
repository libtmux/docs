#!/usr/bin/env node
/*
 * A stand-in port adapter for `docs-arena.negative.mjs`. It follows the arena
 * contract through the tmux CLI, and `DOCS_ARENA_FIXTURE_MODE` breaks exactly
 * one part of it, so each supervisor check can be shown to fail.
 */
import { execFileSync, spawnSync } from 'node:child_process'

const ARTIFACT = 'docs-arena-fixture'
const env = process.env
const mode = env.DOCS_ARENA_FIXTURE_MODE ?? 'conform'

// Ordinary mode: without a descriptor there is nothing to borrow.
if (!env.LIBTMUX_ARENA_DESCRIPTOR) process.exit(0)

const artifact = env.LIBTMUX_ARENA_ARTIFACT
const socket = env.LIBTMUX_SOCKET_PATH
const bin = env.LIBTMUX_TMUX_BIN
if (mode === 'ambient') spawnSync(bin || 'tmux', ['new-session', '-d', '-s', 'ambient'], { stdio: 'ignore' })
if (!artifact || !socket || !bin || artifact !== ARTIFACT) {
  if (mode === 'lenient') process.exit(0)
  console.error('arena contract is incomplete or names another artifact')
  process.exit(2)
}

const tmux = (...args) => execFileSync(bin, ['-S', socket, ...args], { encoding: 'utf8' }).trim()
// The example body: real work on the borrowed server.
tmux('new-window', '-d', '-n', 'fixture')
if (mode === 'extra') spawnSync(bin, ['-L', 'extra', 'new-session', '-d'], { stdio: 'ignore' })

const [pid, reported] = tmux('display-message', '-p', '#{pid}\t#{socket_path}').split('\t')
const challenge = tmux('display-message', '-p', '#{@libtmux_arena_challenge}')
const base = { schema: 1, artifact, server_pid: Number(pid), socket_path: reported }
const record = JSON.stringify({
  ...base,
  artifact: mode === 'artifact' ? 'another-artifact' : artifact,
  challenge: mode === 'challenge' ? '0'.repeat(64) : challenge,
  socket_path: mode === 'socket' ? `${reported}.elsewhere` : reported,
})

// N-records-per-run modes: one evidence line per declared source, reached
// only when the harness sets DOCS_ARENA_FIXTURE_SOURCES. Every mode above
// stays the single-record adapter docs-arena.negative.mjs exercises.
const sources = (env.DOCS_ARENA_FIXTURE_SOURCES ?? '').split(',').filter(Boolean)
if (sources.length) {
  const print = (source) => console.log(`LIBTMUX_ARENA_EVIDENCE=${JSON.stringify({ ...base, challenge, source })}`)
  const emit = mode === 'multi-missing' ? sources.slice(0, -1) : sources
  for (const source of emit) {
    if (mode === 'multi-replaced' && source === sources[1]) {
      // What a documented block did to python's gate: stop the lent server,
      // and let the next call quietly start another on the same socket. The
      // records go on naming the pid and challenge the first server had.
      tmux('kill-server')
      spawnSync(bin, ['-S', socket, 'new-session', '-d'], { stdio: 'ignore' })
    }
    if (mode === 'multi-bad-challenge' && source === sources[sources.length - 1]) {
      console.log(`LIBTMUX_ARENA_EVIDENCE=${JSON.stringify({ ...base, challenge: '0'.repeat(64), source })}`)
    } else {
      print(source)
    }
  }
  if (mode === 'multi-duplicate') print(sources[0])
  if (mode === 'multi-no-source') console.log(`LIBTMUX_ARENA_EVIDENCE=${JSON.stringify({ ...base, challenge })}`)
  if (mode === 'multi-undeclared') print('an-undeclared-source')
} else if (mode === 'hang') {
  setInterval(() => {}, 1000)
} else {
  if (mode !== 'silent') console.log(`LIBTMUX_ARENA_EVIDENCE=${record}`)
  if (mode === 'twice') console.log(`LIBTMUX_ARENA_EVIDENCE=${record}`)
  if (mode === 'kill') tmux('kill-server')
  if (mode === 'exit') process.exit(3)
}
