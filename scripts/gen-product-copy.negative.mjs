#!/usr/bin/env node
/** Exercise the product copy generator against claims and caches that must be refused. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { locateCheck, shapeOf } from './gen-product-copy.mjs'
import { MCP, VERBS, WORKSPACE } from './lib/product-copy-sources.mjs'

const here = dirname(fileURLToPath(import.meta.url))

// A string the file must carry, and one it must not: a missing command is shown by its absence.
const FILE = 'commands = ["load", "plan"]\nvalidate = true\n'
assert.deepEqual(locateCheck(FILE, { path: 'cli', find: ['"load"', 'validate'], absent: ['freeze'] }, 'demo'), {
  path: 'cli', find: [{ text: '"load"', line: 1 }, { text: 'validate', line: 2 }], absent: ['freeze'],
})
assert.throws(() => locateCheck(FILE, { path: 'cli', find: '"freeze"' }, 'demo'), /demo: "\\"freeze\\"" is not in cli/)
assert.throws(() => locateCheck(FILE, { path: 'cli', find: '"load"', absent: ['validate'] }, 'demo'), /"validate" is in cli, line 2/)
console.log('ok   a command is claimed only where its string is, and denied only where its string is not')

// What an entry is: the claims, the revision and the strings, but not the lines.
const entry = { repo: 'a/b', revision: 'c'.repeat(40), verbs: ['load'], formats: ['YAML'], checks: [{ path: 'x', find: [{ text: 't', line: 3 }], absent: [] }] }
assert.equal(shapeOf(entry), shapeOf({ ...entry, checks: [{ ...entry.checks[0], find: [{ text: 't', line: 9 }] }] }))
assert.notEqual(shapeOf(entry), shapeOf({ ...entry, verbs: ['load', 'freeze'] }))
assert.notEqual(shapeOf(entry), shapeOf({ ...entry, formats: ['YAML', 'JSON'] }))
assert.notEqual(shapeOf(entry), shapeOf({ ...entry, revision: 'd'.repeat(40) }))
assert.notEqual(shapeOf(entry), shapeOf({ ...entry, checks: [{ ...entry.checks[0], find: [{ text: 'u', line: 3 }] }] }))
console.log('ok   an entry differs by its claims, its revision and its strings, not by a moved line')

// The sources hold the page to what it can say: a claim is shown by a string, and a claim left out by the string's absence.
const strings = (spec) => spec.checks.flatMap((check) => [check.find ?? []].flat()).join('\n')
const absences = (spec) => spec.checks.flatMap((check) => [check.absent ?? []].flat())
const EVIDENCE = { load: /load|Invoke-TmuxWorkspace/i, freeze: /freeze/i, convert: /convert/i }
for (const [port, spec] of Object.entries(WORKSPACE)) {
  assert.ok(spec.verbs.includes('load'), `${port}: a workspace tool loads`)
  assert.ok(spec.verbs.every((verb) => VERBS.includes(verb)), `${port}: unknown verb`)
  for (const verb of spec.verbs) assert.match(strings(spec), EVIDENCE[verb], `${port}: ${verb} is claimed but no string names it`)
  // Always asserted, even for a port with no absence checks at all: a verb left out must be shown absent.
  for (const verb of VERBS.filter((candidate) => !spec.verbs.includes(candidate))) {
    assert.ok(absences(spec).includes(verb), `${port}: ${verb} is not claimed, so its absence must be checked`)
  }
  for (const format of spec.formats) assert.match(strings(spec), new RegExp(format, 'i'), `${port}: ${format} is claimed but no string names it`)
}
for (const [port, spec] of Object.entries(MCP)) assert.ok(Boolean(spec.sdk) !== Boolean(spec.protocol), `${port}: an SDK or its own protocol layer, not both and not neither`)
// The assertions above can fail: a port that leaves a verb out and checks nothing is caught.
assert.throws(() => assert.ok(absences({ checks: [{ path: 'x', find: 'load' }] }).includes('freeze'), 'x: freeze is not claimed, so its absence must be checked'), /absence must be checked/)
console.log('ok   every claim has a string that shows it, and every verb left out is checked absent')

// The generator itself, on copies of the committed data, with no checkout reachable: an empty HOME hides
// every `~/` checkout and the override variables are dropped, so `--check` has only the cache to trust.
const COMMITTED = join(here, '../site/src/data/product-copy.json')
const sandbox = mkdtempSync(join(tmpdir(), 'libtmux-product-copy-'))
try {
  const home = join(sandbox, 'home')
  mkdirSync(home)
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('LIBTMUX_DOCS_CHECKOUT_')))
  env.HOME = home
  const committed = JSON.parse(readFileSync(COMMITTED, 'utf8'))
  let copies = 0
  const checkCopy = (change) => {
    const data = structuredClone(committed)
    change(data)
    const file = join(sandbox, `data-${copies++}.json`)
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
    try {
      return { ok: true, output: execFileSync(process.execPath, [join(here, 'gen-product-copy.mjs'), '--check', '--data', file], { env, encoding: 'utf8', stdio: 'pipe' }) }
    } catch (error) {
      return { ok: false, output: `${error.stdout}${error.stderr}` }
    }
  }
  const untouched = checkCopy(() => {})
  assert.equal(untouched.ok, true, untouched.output)
  assert.match(untouched.output, /verified from the cache; checkouts unavailable/)
  console.log('ok   the unmodified data passes --check from the cache alone')

  // Each edit must be refused because the cache no longer describes the sources, not for any other reason.
  const refused = (product, port, change) => {
    const result = checkCopy(change)
    assert.equal(result.ok, false, `${product} ${port}: the edit was accepted`)
    assert.match(result.output, new RegExp(`${port} ${product}: no verified cache for `), result.output)
  }
  refused('workspace', 'ruby', (data) => { data.workspace.ruby.verbs = ['load', 'freeze'] })
  refused('workspace', 'julia', (data) => { data.workspace.julia.verbs = ['load', 'freeze', 'convert'] })
  refused('workspace', 'rs', (data) => { data.workspace.rs.verbs = ['load'] })
  console.log('ok   a verb added to or dropped from a port is refused')
  refused('workspace', 'swift', (data) => { delete data.workspace.swift.formatNote })
  refused('workspace', 'go', (data) => { data.workspace.go.formats = ['YAML'] })
  console.log('ok   a changed format or note is refused')
  refused('mcp', 'rs', (data) => { data.mcp.rs.sdk.href = 'https://example.invalid/rmcp' })
  refused('mcp', 'cxx', (data) => { data.mcp.cxx.sdk = { name: 'Invented SDK', href: 'https://example.invalid/sdk' } })
  console.log('ok   an SDK that was edited in, or a protocol layer given an SDK, is refused')
  refused('mcp', 'py', (data) => { data.mcp.py.revision = 'e'.repeat(40) })
  refused('workspace', 'ts', (data) => { data.workspace.ts.revision = 'e'.repeat(40) })
  console.log('ok   an entry read at another revision than the API model records is refused')
  refused('workspace', 'ruby', (data) => { data.workspace.ruby.checks[0].absent = [] })
  refused('workspace', 'powershell', (data) => { data.workspace.powershell.checks[0].absent = [] })
  refused('workspace', 'rs', (data) => { data.workspace.rs.checks.pop() })
  refused('mcp', 'swift', (data) => { data.mcp.swift.checks.pop() })
  console.log('ok   a check that was dropped is refused')
} finally {
  rmSync(sandbox, { recursive: true, force: true })
}
