#!/usr/bin/env node
/*
 * Proof that check-canonicals fails when a reference page points elsewhere.
 *
 * The control is the same tree with the port segment restored, because a
 * check that always failed would satisfy the first case on its own. The
 * collision case is the one that mattered in practice: two ports sharing a
 * symbol slug declared the identical canonical, so "distinct per port" and
 * "equal to its own URL" are not the same assertion and only the second
 * catches it.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-canonicals.mjs')
const ORIGIN = 'https://libtmux.org'

/** A reference tree whose canonical for each page is `canonicalFor(path)`. */
function site(canonicalFor) {
  const dir = mkdtempSync(join(tmpdir(), 'check-canonicals-'))
  const pages = ['reference', 'reference/py', 'reference/ts', 'reference/py/pane', 'reference/ts/pane']
  for (const page of pages) {
    mkdirSync(join(dir, page), { recursive: true })
    const href = `${ORIGIN}${canonicalFor(`/${page}/`)}`
    writeFileSync(join(dir, page, 'index.html'), `<html><head><link rel="canonical" href="${href}"></head></html>`)
  }
  return dir
}

function run(dir) {
  try {
    return { code: 0, out: execFileSync('node', [script, dir], { encoding: 'utf8', stdio: 'pipe' }) }
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
  const dir = site((p) => p)
  const { code, out } = run(dir)
  check('a tree canonical to itself passes', code === 0, `exited ${code}:\n${out}`)
  rmSync(dir, { recursive: true, force: true })
}

{
  // The real defect: the port segment dropped, so /reference/py/pane/ claims
  // /reference/pane/ — which does not exist, and which /reference/ts/pane/
  // claims too.
  const dir = site((p) => p.replace(/^\/reference\/(py|ts)\//, '/reference/'))
  const { code, out } = run(dir)
  check(
    'a dropped port segment fails',
    code !== 0 && out.includes('canonicalise somewhere other than themselves'),
    `exited ${code}:\n${out}`,
  )
  rmSync(dir, { recursive: true, force: true })
}

{
  const dir = site(() => '/reference/')
  const { code } = run(dir)
  check('every page pointing at one URL fails', code !== 0, 'a tree with one shared canonical passed')
  rmSync(dir, { recursive: true, force: true })
}

{
  const dir = mkdtempSync(join(tmpdir(), 'check-canonicals-bare-'))
  mkdirSync(join(dir, 'reference'), { recursive: true })
  writeFileSync(join(dir, 'reference', 'index.html'), '<html><head></head></html>')
  const { code, out } = run(dir)
  check('a page with no canonical at all fails', code !== 0 && out.includes('none'), `exited ${code}:\n${out}`)
  rmSync(dir, { recursive: true, force: true })
}

if (failures) {
  console.error(`\ncheck-canonicals cannot detect ${failures} of the situations it exists for.`)
  process.exit(1)
}
console.log('\ncheck-canonicals.negative: a self-canonical tree passes, a dropped segment fails')
