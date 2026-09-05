#!/usr/bin/env node
/*
 * Proof that check-edge-extensions fails when the allowlist misses a file the
 * build emits.
 *
 * Builds a miniature tree and a miniature function file, so the case runs
 * without an assembly and without touching the real allowlist. The control
 * uses the same tree with the extension present, because a check that always
 * failed would satisfy the first case on its own.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-edge-extensions.mjs')

/**
 * A tree holding one page, one `objects.inv` — the real failure — and one
 * dotfile, because Sphinx emits `.buildinfo` and the function reads a leading
 * dot as an extension separator like any other.
 */
function site() {
  const dir = mkdtempSync(join(tmpdir(), 'check-edge-ext-'))
  mkdirSync(join(dir, 'reference', 'py'), { recursive: true })
  writeFileSync(join(dir, 'reference', 'py', 'index.html'), '<html></html>')
  writeFileSync(join(dir, 'reference', 'py', 'objects.inv'), 'x')
  writeFileSync(join(dir, 'reference', 'py', '.buildinfo'), 'x')
  return dir
}

/**
 * A function file whose allowlist holds exactly `exts`.
 *
 * Written outside the tree under test on purpose: the first draft put it
 * inside, the walker found its own `.js`, and the control failed. A fixture
 * that is also an input is not a fixture.
 */
function fnFile(exts) {
  const dir = mkdtempSync(join(tmpdir(), 'check-edge-ext-fn-'))
  const f = join(dir, 'fn.js')
  writeFileSync(f, `const ASSET_EXTENSIONS = {\n${exts.map((e) => `    ${e}: 1,`).join('\n')}\n}\n`)
  return f
}

function run(dir, fn) {
  try {
    return { code: 0, out: execFileSync('node', [script, dir, '--function', fn], { encoding: 'utf8', stdio: 'pipe' }) }
  } catch (err) {
    return { code: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

let failures = 0
const check = (name, ok, detail) => {
  if (ok) console.log(`ok   ${name}`)
  else {
    console.error(`FAIL ${name} — ${detail}`)
    failures++
  }
}

{
  const dir = site()
  const { code, out } = run(dir, fnFile(['html']))
  check(
    'an emitted extension missing from the allowlist fails',
    code !== 0 && out.includes('.inv') && out.includes('objects.inv'),
    `exited ${code}:\n${out}`,
  )
  rmSync(dir, { recursive: true, force: true })
}

{
  const dir = site()
  const { code, out } = run(dir, fnFile(['html', 'inv', 'buildinfo']))
  check('the same tree passes once it is allowlisted', code === 0, `exited ${code}:\n${out}`)
  rmSync(dir, { recursive: true, force: true })
}

{
  // A dotfile is not an extensionless file. Skipping it here made the check
  // blind to the class the function is most likely to redirect away.
  const dir = site()
  const { code, out } = run(dir, fnFile(['html', 'inv']))
  check(
    'a dotfile extension is checked, not skipped',
    code !== 0 && out.includes('.buildinfo'),
    `exited ${code}:\n${out}`,
  )
  rmSync(dir, { recursive: true, force: true })
}

{
  // The parser is load-bearing: a table it cannot find would read as an empty
  // allowlist, which fails everything, or as a pass, depending on the shape.
  // Neither is acceptable silently.
  const dir = site()
  const fnDir = mkdtempSync(join(tmpdir(), 'check-edge-ext-fn-'))
  const f = join(fnDir, 'nofn.js')
  writeFileSync(f, 'export default 1\n')
  const { code, out } = run(dir, f)
  check('a function file with no table fails loudly', code !== 0 && out.includes('no ASSET_EXTENSIONS'), `exited ${code}:\n${out}`)
  rmSync(dir, { recursive: true, force: true })
}

{
  const dir = mkdtempSync(join(tmpdir(), 'check-edge-ext-absent-'))
  rmSync(dir, { recursive: true, force: true })
  const { code, out } = run(dir, script)
  check('an absent site directory fails rather than passing empty', code !== 0 && out.includes('no site at'), `exited ${code}:\n${out}`)
}

if (failures) {
  console.error(`\ncheck-edge-extensions cannot detect ${failures} of the situations it exists for.`)
  process.exit(1)
}
console.log('\ncheck-edge-extensions.negative: a missing extension fails, an allowlisted one passes')
