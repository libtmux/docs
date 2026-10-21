#!/usr/bin/env node
/*
 * Proof that check-production-render fails when the production roots and the
 * assembly disagree, and passes when they do not.
 *
 * The control is a render whose defaults match in a different key order and
 * whose inputs digests are equal: a check that always failed would satisfy
 * every other case on its own.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-production-render.mjs')
const scratch = mkdtempSync(join(tmpdir(), 'libtmux-production-render-'))
const versions = join(scratch, 'versions.json')
writeFileSync(versions, JSON.stringify({ schema: 1, ports: {}, defaultVersion: { py: 'stable', go: 'latest' } }))

const clean = {
  LIBTMUX_DOCS_PRODUCTION_DEFAULTS: '{"go":"latest","py":"stable"}',
  LIBTMUX_DOCS_PRODUCTION_INPUTS: '0123456789abcdef',
  LIBTMUX_DOCS_BUILD_INPUTS: '0123456789abcdef',
}
const run = (env) => spawnSync(process.execPath, [script, versions], {
  encoding: 'utf8',
  env: { PATH: process.env.PATH, ...env },
})

const cases = [
  { name: 'a default the assembly moved', env: { ...clean, LIBTMUX_DOCS_PRODUCTION_DEFAULTS: '{"go":"latest","py":"latest"}' }, trips: /other default versions/ },
  { name: 'a port the assembly dropped', env: { ...clean, LIBTMUX_DOCS_PRODUCTION_DEFAULTS: '{"py":"stable"}' }, trips: /other default versions/ },
  { name: 'defaults that are not JSON', env: { ...clean, LIBTMUX_DOCS_PRODUCTION_DEFAULTS: 'stable' }, trips: /not the JSON object/ },
  { name: 'inputs that differ', env: { ...clean, LIBTMUX_DOCS_BUILD_INPUTS: 'fedcba9876543210' }, trips: /different build inputs/ },
  { name: 'a build digest that was never passed', env: { ...clean, LIBTMUX_DOCS_BUILD_INPUTS: '' }, trips: /must both name/ },
  { name: 'a render digest that was never passed', env: { ...clean, LIBTMUX_DOCS_PRODUCTION_INPUTS: '' }, trips: /must both name/ },
]

try {
  const control = run(clean)
  assert.equal(control.status, 0, `the matching render must pass:\n${control.stderr}`)
  console.log('ok   matching defaults and inputs pass')

  for (const { name, env, trips } of cases) {
    const result = run(env)
    assert.equal(result.status, 1, `${name}: expected a failure, got ${result.status}\n${result.stdout}`)
    assert.match(result.stderr, trips, `${name}: wrong reason\n${result.stderr}`)
    console.log(`ok   fails on ${name}`)
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
