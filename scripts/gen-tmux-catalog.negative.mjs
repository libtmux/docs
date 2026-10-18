#!/usr/bin/env node
/*
 * Proof that `gen-tmux-catalog.mjs --check` fails on stale catalog data.
 *
 * The control is the committed catalog, because a check that always failed
 * would satisfy every other case. Each case is a different way to be stale:
 * a dropped entry, a manual snapshot that no longer matches, a missing
 * release, and (with a tmux checkout) a default that no longer matches the
 * source at the pinned commit.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, 'gen-tmux-catalog.mjs')
const committed = join(here, '..', 'site/src/data/tmux/catalog')
const source = process.env.LIBTMUX_TMUX_SOURCE ?? join(homedir(), 'study/c/tmux')

function run(catalog, ...args) {
  try {
    return { code: 0, out: execFileSync('node', [script, '--check', '--catalog', catalog, ...args], { encoding: 'utf8', stdio: 'pipe' }) }
  } catch (error) {
    return { code: error.status, out: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

function copy() {
  const dir = mkdtempSync(join(tmpdir(), 'gen-tmux-catalog-'))
  cpSync(committed, dir, { recursive: true })
  return dir
}

function edit(dir, version, change) {
  const file = join(dir, `${version}.json`)
  const model = JSON.parse(readFileSync(file, 'utf8'))
  change(model)
  writeFileSync(file, `${JSON.stringify(model, null, 2)}\n`)
}

let failures = 0
const check = (name, ok, detail) => {
  if (ok) console.log(`ok   ${name}`)
  else { console.error(`FAIL ${name} - ${detail}`); failures += 1 }
}

const dirs = []
const fixture = () => { const dir = copy(); dirs.push(dir); return dir }

const control = run(fixture())
check('the committed catalog passes', control.code === 0, control.out)

const dropped = fixture()
edit(dropped, '3.7c', (model) => { model.entries.splice(10, 1) })
const droppedRun = run(dropped)
check('a dropped entry fails', droppedRun.code !== 0 && /count is/.test(droppedRun.out), droppedRun.out)

const manual = fixture()
edit(manual, '3.2a', (model) => { model.manualSha256 = '0'.repeat(64) })
const manualRun = run(manual)
check('a manual snapshot from another tmux.1 fails', manualRun.code !== 0 && /manualSha256/.test(manualRun.out), manualRun.out)

const missing = fixture()
rmSync(join(missing, '3.2a.json'))
const missingRun = run(missing)
check('a missing release fails', missingRun.code !== 0 && /Missing tmux catalog: 3\.2a/.test(missingRun.out), missingRun.out)

if (existsSync(join(source, '.git'))) {
  const fresh = run(committed, '--source', source)
  check('the committed catalog matches the pinned source', fresh.code === 0, fresh.out)
  const stale = fixture()
  edit(stale, '3.7c', (model) => {
    const option = model.entries.find((entry) => entry.kind === 'option' && entry.name === 'escape-time')
    option.default = 500
  })
  const staleRun = run(stale, '--source', source)
  check('a default that differs from the pinned source fails', staleRun.code !== 0 && /Stale tmux catalog: 3\.7c/.test(staleRun.out), staleRun.out)
} else {
  console.log('skip the source comparison: no tmux checkout (set LIBTMUX_TMUX_SOURCE)')
}

for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
process.exit(failures ? 1 : 0)
