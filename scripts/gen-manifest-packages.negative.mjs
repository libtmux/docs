#!/usr/bin/env node
/*
 * Proof that `gen-manifest-packages.mjs --check` can still fail.
 *
 * The check compares the committed file with what the pinned manifests say, so
 * it needs the port checkouts. A port whose checkout is absent is named and
 * left unchecked while every other port is compared, so a case that edits an
 * unchecked port has nothing to prove and says so. The control is a copy of
 * the committed file. Each case edits its own copy the way a hand edit would:
 * a version bumped, a package dropped or invented, a unit dropped, a port
 * missing from the file, a port that is not registered. Two more hide a
 * checkout and require that the rest is still compared and the hidden port named.
 * Python is read from three repositories, so hiding either companion must leave
 * py named and uncompared, not reported as drift from the core alone.
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, 'gen-manifest-packages.mjs')
const real = join(here, '..', 'site/src/data/manifest-packages.json')

function run(file, env = {}) {
  try {
    return { code: 0, out: execFileSync('node', [script, '--check', '--out', file], { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, ...env } }) }
  } catch (error) {
    return { code: error.status, out: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

const dir = mkdtempSync(join(tmpdir(), 'gen-manifest-packages-'))
const control = run(real)
/** The ports a run named as not checked: the line lists every one, so a lone name is not what to look for. */
const namedUnchecked = (out) => new Set((/not checked: (.*)$/m.exec(out)?.[1] ?? '').split(', ').filter(Boolean))
const notChecked = namedUnchecked(control.out)

let failures = 0
const check = (name, ok, detail) => {
  if (ok) console.log(`ok   ${name}`)
  else {
    console.error(`FAIL ${name} — ${detail}`)
    failures += 1
  }
}
check('the committed file passes', control.code === 0 && /is current for/.test(control.out), `exit ${control.code}: ${control.out.trim()}`)

const mutations = [
  ['rs', 'a hand-edited version is caught', (data) => { data.ports.rs.distributions[0].version = '9.9.9' }],
  ['ts', 'a dropped package is caught', (data) => { data.ports.ts.distributions.pop() }],
  ['py', 'an invented package is caught', (data) => { data.ports.py.distributions.push({ name: 'invented', version: '1.0.0', manifest: 'pyproject.toml', repo: 'x/y', revision: 'abc' }) }],
  ['go', 'a dropped unit is caught', (data) => { data.ports.go.units.pop() }],
  ['swift', 'a port missing from the file is caught', (data) => { delete data.ports.swift }],
  [undefined, 'a port that is not registered is caught', (data) => { data.ports.nope = data.ports.rs }],
]
for (const [slug, name, mutate] of mutations) {
  if (slug && notChecked.has(slug)) {
    console.log(`skip ${name}: the ${slug} checkout is absent here, so that port is not compared`)
    continue
  }
  const file = join(dir, 'manifest-packages.json')
  copyFileSync(real, file)
  const data = JSON.parse(readFileSync(file, 'utf8'))
  mutate(data)
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
  const result = run(file)
  check(name, result.code === 1 && /out of date/.test(result.out), `exit ${result.code}: ${result.out.trim()}`)
}

// A checkout that is absent leaves one port unchecked and the rest compared.
const hidden = ['rs', 'go'].find((slug) => !notChecked.has(slug))
const other = ['ts', 'py', 'swift'].find((slug) => !notChecked.has(slug))
if (hidden && other) {
  const file = join(dir, 'partial.json')
  copyFileSync(real, file)
  const data = JSON.parse(readFileSync(file, 'utf8'))
  data.ports[hidden].distributions[0].version = '9.9.9'
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
  const env = { [`LIBTMUX_DOCS_CHECKOUT_${hidden.toUpperCase()}`]: '/nonexistent' }
  const named = run(file, env)
  check('with a checkout absent, the port is named and not compared', named.code === 0 && new RegExp(`not checked: .*${hidden}`).test(named.out), `exit ${named.code}: ${named.out.trim()}`)
  data.ports[other].distributions[0].version = '9.9.9'
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
  const partial = run(file, env)
  check('with a checkout absent, the other ports are still compared', partial.code === 1 && new RegExp(`${other}: differs from its manifests`).test(partial.out), `exit ${partial.code}: ${partial.out.trim()}`)
} else {
  console.log('skip the absent-checkout cases: too few checkouts are present here')
}

// Python is read from three repositories. With a companion absent the core alone is not the port, so it is
// named and left unchecked rather than compared and reported as drift; with every source present a change to
// a companion's package is still caught.
if (!notChecked.has('py')) {
  const file = join(dir, 'py.json')
  copyFileSync(real, file)
  const data = JSON.parse(readFileSync(file, 'utf8'))
  const companion = data.ports.py.distributions.find((entry) => entry.repo !== data.ports.py.repo)
  companion.version = '9.9.9'
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
  const present = run(file)
  check('a changed companion package is caught when every source is read', present.code === 1 && /py: differs from its manifests/.test(present.out), `exit ${present.code}: ${present.out.trim()}`)
  for (const variable of ['LIBTMUX_DOCS_WORKSPACE_PY', 'LIBTMUX_DOCS_MCP_PY']) {
    const env = { [variable]: '/nonexistent' }
    const untouched = run(real, env)
    check(`with ${variable} absent, py is named and the committed file passes`, untouched.code === 0 && namedUnchecked(untouched.out).has('py') && !/differs/.test(untouched.out), `exit ${untouched.code}: ${untouched.out.trim()}`)
    const partial = run(file, env)
    check(`with ${variable} absent, py is not compared from the core alone`, partial.code === 0 && namedUnchecked(partial.out).has('py'), `exit ${partial.code}: ${partial.out.trim()}`)
  }
  const other = ['rs', 'ts', 'go', 'swift'].find((slug) => !notChecked.has(slug))
  if (other) {
    data.ports[other].distributions[0].version = '9.9.9'
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
    const rest = run(file, { LIBTMUX_DOCS_WORKSPACE_PY: '/nonexistent' })
    check('with a companion absent, the other ports are still compared', rest.code === 1 && new RegExp(`${other}: differs from its manifests`).test(rest.out) && !/py: differs/.test(rest.out), `exit ${rest.code}: ${rest.out.trim()}`)
  }
} else {
  console.log('skip the companion cases: the py checkouts are absent here')
}
rmSync(dir, { recursive: true, force: true })
if (failures > 0) process.exit(1)
