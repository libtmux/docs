#!/usr/bin/env node
/*
 * Proof that verify-destinations can still fail.
 *
 * The hosts are answered by a local server, so no case touches the network.
 * The control is a destination that names what the host serves: a check that
 * failed everything would satisfy every other case. The cases are the ones the
 * real hosts produce: a 200 about a different package (PyPI names another
 * project), a 404, a javadoc.io landing on a version list, an offline
 * comparison with a record dropped or failed or orphaned, and a destination
 * kept out of the links that has started to answer.
 */
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), 'verify-destinations.mjs')
const run = promisify(execFile)

let flaky = 0
const html = (title) => `<!doctype html><html><head><title>${title}</title></head><body></body></html>`
const routes = {
  '/github/demo/demo': () => [200, 'text/html', html('GitHub - demo/demo: a demo · GitHub')],
  '/github/demo/elsewhere': () => [200, 'text/html', html('GitHub - demo/other: not this one · GitHub')],
  '/pypi/pypi/demo-good/json': () => [200, 'application/json', JSON.stringify({ info: { name: 'demo-good', version: '1.0.0' }, releases: { '1.0.0': [{}] } })],
  '/pypi/pypi/demo-wrong/json': () => [200, 'application/json', JSON.stringify({ info: { name: 'another-project', version: '2.0.0' }, releases: { '2.0.0': [{}] } })],
  '/pypi/project/demo-good/': () => [200, 'text/html', html('Client Challenge')],
  '/pypi/project/demo-wrong/': () => [200, 'text/html', html('Client Challenge')],
  '/rubygems/api/v1/gems/demo-gone.json': () => [404, 'text/html', html('Page not found')],
  '/rubygems/api/v1/gems/demo-back.json': () => [200, 'application/json', JSON.stringify({ name: 'demo-back', version: '1.0.0' })],
  '/rubygems/api/v1/versions/demo-back.json': () => [200, 'application/json', JSON.stringify([{ number: '1.0.0', yanked_at: null }])],
  '/javadoc/doc/demo.group/demo-docs': () => [200, 'text/html', html('demo-docs 1.0.0 javadoc (demo.group)')],
  // The first request finds documentation and the next lands on a version list, as javadoc.io has done between requests.
  '/javadoc/doc/demo.group/demo-flaky': (_, origin) => (flaky++ % 2 === 0
    ? [200, 'text/html', html('demo-flaky 1.0.0 javadoc (demo.group)')]
    : [302, '', '', { location: `${origin}/javadoc/versions/demo.group/demo-bom` }]),
  '/javadoc/doc/demo.group/demo-bom': (_, origin) => [302, '', '', { location: `${origin}/javadoc/versions/demo.group/demo-bom` }],
  '/javadoc/versions/demo.group/demo-bom': () => [200, 'text/html', html('demo.group:demo-bom versions')],
}

const server = createServer((request, response) => {
  const origin = `http://127.0.0.1:${server.address().port}`
  const route = routes[request.url]
  const [status, type, body, headers] = route ? route(request.url, origin) : [404, 'text/plain', 'not found']
  response.writeHead(status, { 'content-type': type, ...headers })
  response.end(body)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const rewrite = JSON.stringify({
  'https://github.com': `${base}/github`, 'https://pypi.org': `${base}/pypi`, 'https://rubygems.org': `${base}/rubygems`, 'https://javadoc.io': `${base}/javadoc`,
})

const entry = (id, fields) => ({ id, kind: 'library', product: 'core', label: id, coordinate: id, aliases: [], repo: 'demo/demo', ref: 'master', status: 'published', ...fields })
const pypi = (name) => ({ package: { host: 'pypi', url: `https://pypi.org/project/${name}/` } })
const gem = (name) => ({ package: { host: 'rubygems', url: `https://rubygems.org/gems/${name}` } })
const doc = (name) => ({ api: { host: 'javadoc-io', url: `https://javadoc.io/doc/demo.group/${name}` } })

const dir = mkdtempSync(join(tmpdir(), 'verify-destinations-'))
let cases = 0
async function verify(name, inventory, { args = [], expect: expected, evidence, registry }) {
  cases += 1
  const inventoryFile = join(dir, `inventory-${cases}.json`)
  const out = join(dir, `evidence-${cases}.json`)
  const registryFile = join(dir, `registry-${cases}.json`)
  writeFileSync(inventoryFile, JSON.stringify({ demo: inventory }))
  if (registry) writeFileSync(registryFile, JSON.stringify({ ports: { demo: registry } }))
  if (evidence) writeFileSync(out, JSON.stringify(evidence))
  let result
  try {
    const done = await run('node', [script, '--inventory', inventoryFile, '--out', out, '--date', '2026-01-01', '--registry', registryFile, ...args],
      { env: { ...process.env, LIBTMUX_DESTINATION_REWRITE: rewrite } })
    result = { code: 0, text: `${done.stdout}${done.stderr}` }
  } catch (error) {
    result = { code: error.code, text: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
  const ok = result.code === expected.code && expected.matches.every((pattern) => pattern.test(result.text))
  if (ok) console.log(`ok   ${name}`)
  else {
    console.error(`FAIL ${name} — exit ${result.code}, wanted ${expected.code} and ${expected.matches}:\n${result.text}`)
    failures += 1
  }
  return { ...result, out }
}
let failures = 0

// A published destination that names what the host serves.
const control = [entry('demo-good', { ...pypi('demo-good') })]
const clean = await verify('a destination that names what the host serves passes', control, { expect: { code: 0, matches: [/ok\s+200\s+package\s+https:\/\/pypi\.org\/project\/demo-good\//] } })
const record = JSON.parse(readFileSync(clean.out, 'utf8')).destinations.find((candidate) => candidate.url === 'https://pypi.org/project/demo-good/')
if (record?.ok === true && record.identity === 'demo-good' && record.status === 200 && record.checkedAt === '2026-01-01' && record.pageStatus === 200) console.log('ok   the evidence records the url, status, identity, page status and date')
else { console.error(`FAIL the evidence record is incomplete: ${JSON.stringify(record)}`); failures += 1 }

await verify('a 200 about another package fails on identity', [entry('demo-wrong', { ...pypi('demo-wrong') })], {
  expect: { code: 1, matches: [/FAIL\s+200\s+package/, /identity: PyPI names the project "another-project", expected "demo-wrong"/] },
})
await verify('a 404 fails on status', [entry('demo-gone', { ...gem('demo-gone') })], {
  expect: { code: 1, matches: [/FAIL\s+404\s+package/, /status: .*answered 404/] },
})
await verify('a repository page titled for another repository fails on identity', [entry('elsewhere', { repo: 'demo/elsewhere' })], {
  expect: { code: 1, matches: [/FAIL\s+200\s+source/, /identity: title is "GitHub - demo\/other/] },
})
await verify('javadoc.io landing on a version list fails on identity', [entry('demo-bom', { ...doc('demo-bom') })], {
  expect: { code: 1, matches: [/FAIL\s+200\s+api/, /identity: title is "demo\.group:demo-bom versions"/] },
})
// The registry snapshot's version must be one the host carries.
const library = [entry('demo-good', { ...pypi('demo-good') })]
await verify('a version the registry records and the host carries passes', library, {
  registry: { version: '1.0.0' }, expect: { code: 0, matches: [/ok\s+200\s+package\s+https:\/\/pypi\.org/] },
})
await verify('a version the registry records and the host lacks fails', library, {
  registry: { version: '2.0.0' }, expect: { code: 1, matches: [/does not carry 2\.0\.0, the registry snapshot's version/] },
})
await verify('javadoc.io answering differently across requests fails as unstable', [entry('demo-flaky', { ...doc('demo-flaky') })], {
  expect: { code: 1, matches: [/FAIL\s+200\s+api/, /unstable: 3 requests disagreed/] },
})
await verify('javadoc.io documentation for the artifact passes', [entry('demo-docs', { ...doc('demo-docs') })], {
  expect: { code: 0, matches: [/ok\s+200\s+api\s+https:\/\/javadoc\.io\/doc\/demo\.group\/demo-docs/] },
})

// A destination kept out of the links must keep failing, or the inventory is behind the host.
await verify('a configured entry whose destination 404s stays unlinked', [entry('demo-gone', { ...gem('demo-gone'), status: 'configured-unpublished', note: 'not uploaded' })], {
  expect: { code: 0, matches: [/none\s+404\s+package/, /wrote /] },
})
await verify('a configured entry whose destination now passes is reported', [entry('demo-back', { ...gem('demo-back'), status: 'configured-unpublished', note: 'not uploaded' })], {
  expect: { code: 1, matches: [/answers, so demo:demo-back can be published/] },
})
await verify('a rejected candidate that now serves the right page is reported', [entry('demo-back', { status: 'planned', note: 'development input', unavailable: [{ kind: 'package', host: 'rubygems', url: 'https://rubygems.org/gems/demo-back', reason: 'not uploaded' }] })], {
  expect: { code: 1, matches: [/answers, so demo:demo-back can be published/] },
})
await verify('a rejected candidate that 404s passes', [entry('demo-gone', { status: 'planned', note: 'development input', unavailable: [{ kind: 'package', host: 'rubygems', url: 'https://rubygems.org/gems/demo-gone', reason: 'not uploaded' }] })], {
  expect: { code: 0, matches: [/none\s+404\s+package/, /wrote /] },
})

// The offline comparison reads the evidence the run above wrote.
const good = JSON.parse(readFileSync(clean.out, 'utf8'))
const recordFor = (url) => good.destinations.find((candidate) => candidate.url === url)
const source = recordFor('https://github.com/demo/demo')
await verify('offline, evidence for every destination passes', control, { args: ['--check'], evidence: good, expect: { code: 0, matches: [/agrees with the inventory/] } })
await verify('offline, a destination with no record fails', control, {
  args: ['--check'], evidence: { ...good, destinations: [source] }, expect: { code: 1, matches: [/https:\/\/pypi\.org\/project\/demo-good\/ has no evidence/] },
})
await verify('offline, a published destination recorded as failing fails', control, {
  args: ['--check'], evidence: { ...good, destinations: good.destinations.map((item) => (item.host === 'pypi' ? { ...item, ok: false, failure: 'status', detail: '404' } : item)) },
  expect: { code: 1, matches: [/is linked by demo:demo-good but failed verification: status/] },
})
await verify('offline, a record no entry names fails', control, {
  args: ['--check'], evidence: { ...good, destinations: [...good.destinations, { ...source, url: 'https://github.com/demo/orphan' }] },
  expect: { code: 1, matches: [/https:\/\/github\.com\/demo\/orphan has evidence but no entry names it/] },
})
await verify('offline, a registry version the host lacks fails', control, {
  args: ['--check'], evidence: { ...good, destinations: good.destinations.map((item) => (item.host === 'pypi' ? { ...item, expectedVersion: '0.0.1', versionFound: false } : item)) },
  expect: { code: 1, matches: [/does not carry 0\.0\.1/] },
})

server.close()
rmSync(dir, { recursive: true, force: true })
if (failures > 0) {
  console.error(`${failures} case${failures === 1 ? '' : 's'} failed`)
  process.exit(1)
}
