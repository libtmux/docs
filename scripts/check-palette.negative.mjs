#!/usr/bin/env node
/*
 * Proof that check-palette fails when hard-coded greys come back.
 *
 * A ratchet that cannot detect an increase is a file that says a number. The
 * control holds the count exactly at the ceiling and must pass.
 */
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-palette.mjs')
const ceilingFile = join(dirname(fileURLToPath(import.meta.url)), 'palette-ceiling.json')
const { ceiling } = JSON.parse(
  execFileSync('cat', [ceilingFile], { encoding: 'utf8' }),
)

/** A source tree carrying exactly `n` hard-coded palette utilities. */
function tree(n) {
  const dir = mkdtempSync(join(tmpdir(), 'check-palette-'))
  const classes = Array.from({ length: n }, (_, i) => `border-slate-${(i % 8) + 1}00`).join(' ')
  writeFileSync(join(dir, 'Thing.astro'), `<div class="${classes}"></div>\n`)
  return dir
}

const CASES = [
  { name: 'greys came back', n: ceiling + 5, mustFail: true, names: 'ceiling is' },
  { name: 'held at ceiling', n: ceiling, mustFail: false },
  { name: 'a comment is free', n: ceiling, mustFail: false, comment: true },
]

let failures = 0
for (const c of CASES) {
  const dir = tree(c.n)
  if (c.comment) {
    // Prose naming the classes it replaced must not count against the budget.
    writeFileSync(join(dir, 'Note.astro'), '/* was border-slate-200 dark:border-slate-800 */\n')
  }
  try {
    let code = 0
    let out = ''
    try {
      out = execFileSync('node', [script, '--dir', dir], { encoding: 'utf8', stdio: 'pipe' })
    } catch (err) {
      code = err.status
      out = `${err.stdout ?? ''}${err.stderr ?? ''}`
    }
    if (c.mustFail && code === 0) {
      console.error(`FAIL ${c.name} — ${c.n} utilities against a ceiling of ${ceiling} passed`)
      failures++
    } else if (c.mustFail && !out.includes(c.names)) {
      console.error(`FAIL ${c.name} — exited ${code} without naming the ceiling:\n${out}`)
      failures++
    } else if (!c.mustFail && code !== 0) {
      console.error(`FAIL ${c.name} — a tree at the ceiling exited ${code}:\n${out}`)
      failures++
    } else {
      console.log(`ok   ${c.name.padEnd(18)} ${c.n} vs ceiling ${ceiling} -> exit ${code}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/*
 * The other half: `--update` must refuse to raise the ceiling to meet new
 * greys, and refusing has to leave the record alone. `--ceiling` points the
 * script at a fixture so these cases cannot rewrite the number this repo
 * ships.
 */
function update(dir, start, force) {
  const f = join(dir, 'ceiling.json')
  writeFileSync(f, `${JSON.stringify({ ceiling: start }, null, 2)}\n`)
  const argv = [script, '--dir', dir, '--ceiling', f, '--update', ...(force ? ['--force'] : [])]
  let code = 0
  let out = ''
  try {
    out = execFileSync('node', argv, { encoding: 'utf8', stdio: 'pipe' })
  } catch (err) {
    code = err.status
    out = `${err.stdout ?? ''}${err.stderr ?? ''}`
  }
  return { code, out, recorded: JSON.parse(readFileSync(f, 'utf8')).ceiling }
}

const GUARDS = [
  { name: 'raising refused', n: ceiling + 5, start: ceiling, wantCode: 1, wantCeiling: ceiling, says: 'refusing to raise' },
  { name: 'raising forced', n: ceiling + 5, start: ceiling, force: true, wantCode: 0, wantCeiling: ceiling + 5 },
  { name: 'lowering allowed', n: ceiling - 5, start: ceiling, wantCode: 0, wantCeiling: ceiling - 5 },
]

for (const c of GUARDS) {
  const dir = tree(c.n)
  try {
    const { code, out, recorded } = update(dir, c.start, c.force)
    if (code !== c.wantCode) {
      console.error(`FAIL ${c.name} — exited ${code}, wanted ${c.wantCode}:\n${out}`)
      failures++
    } else if (recorded !== c.wantCeiling) {
      console.error(`FAIL ${c.name} — ceiling left at ${recorded}, wanted ${c.wantCeiling}`)
      failures++
    } else if (c.says && !out.includes(c.says)) {
      console.error(`FAIL ${c.name} — exited ${code} without saying why:\n${out}`)
      failures++
    } else {
      const how = c.force ? ' --force' : ''
      console.log(`ok   ${c.name.padEnd(18)} ${c.n} vs ceiling ${c.start}${how} -> exit ${code}, ceiling now ${recorded}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (failures) {
  console.error(`\ncheck-palette cannot detect ${failures} of the situations it exists for.`)
  process.exit(1)
}
console.log('\ncheck-palette.negative: the ceiling catches an increase, passes a hold, and only moves down')
