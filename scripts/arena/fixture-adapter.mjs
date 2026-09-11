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
const record = JSON.stringify({
  schema: 1,
  artifact: mode === 'artifact' ? 'another-artifact' : artifact,
  challenge: mode === 'challenge' ? '0'.repeat(64) : challenge,
  server_pid: Number(pid),
  socket_path: mode === 'socket' ? `${reported}.elsewhere` : reported,
})

if (mode === 'hang') setInterval(() => {}, 1000)
else {
  if (mode !== 'silent') console.log(`LIBTMUX_ARENA_EVIDENCE=${record}`)
  if (mode === 'twice') console.log(`LIBTMUX_ARENA_EVIDENCE=${record}`)
  if (mode === 'kill') tmux('kill-server')
  if (mode === 'exit') process.exit(3)
}
