#!/usr/bin/env node
/*
 * Proof that verify-destinations can still fail.
 *
 * The hosts are answered by a local server, so no case touches the network.
 * The control is a destination that names what the host serves: a check that
 * failed everything would satisfy every other case. The cases are the ones the
 * real hosts produce: a 200 about a different package (PyPI names another
 * project), a 404, a javadoc.io landing on a version list, a repository that
 * was renamed, an offline comparison with a record dropped or failed or
 * orphaned, and a destination kept out of the links that has started to answer.
 * Age is the exception to failing: evidence past the bound is a warning offline
 * and a failure only under --fresh or at the end of a live run.
 *
 * Each host family then has the same four cases: the right package, a
 * different package under the same URL, the right package filed under a
 * different repository, and a version the manifest declares that the host lacks.
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
const html = (title, body = '') => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`
const text = (body, type = 'application/json') => [200, type, typeof body === 'string' ? body : JSON.stringify(body)]
/** Routes by `/<hostname><path>`: the rewritten origin keeps the host's name as the first segment. */
const routes = {
  '/github.com/demo/demo': () => [200, 'text/html', html('GitHub - demo/demo: a demo · GitHub')],
  '/github.com/demo/elsewhere': () => [200, 'text/html', html('GitHub - demo/other: not this one · GitHub')],
  // A repository renamed: the old name redirects, and the title names the new one.
  '/github.com/demo/renamed': (_, origin) => [301, '', '', { location: `${origin}/github.com/demo/renamed-new` }],
  '/github.com/demo/renamed-new': () => [200, 'text/html', html('GitHub - demo/renamed-new: a demo · GitHub')],
  // A title that begins with the expected name but names a longer one.
  '/github.com/demo/lib-go': () => [200, 'text/html', html('GitHub - demo/lib-golang: a demo · GitHub')],
  '/pypi.org/pypi/demo-good/json': () => text({ info: { name: 'demo-good', version: '1.0.0', project_urls: { Repository: 'https://github.com/demo/demo' } }, releases: { '1.0.0': [{}] } }),
  '/pypi.org/pypi/demo-wrong/json': () => text({ info: { name: 'another-project', version: '2.0.0', project_urls: {} }, releases: { '2.0.0': [{}] } }),
  '/pypi.org/project/demo-good/': () => [200, 'text/html', html('Client Challenge')],
  '/pypi.org/project/demo-wrong/': () => [200, 'text/html', html('Client Challenge')],
  '/rubygems.org/api/v1/gems/demo-gone.json': () => [404, 'text/html', html('Page not found')],
  '/rubygems.org/api/v1/gems/demo-back.json': () => text({ name: 'demo-back', version: '1.0.0', source_code_uri: 'https://github.com/demo/demo' }),
  '/rubygems.org/api/v1/versions/demo-back.json': () => text([{ number: '1.0.0', yanked_at: null }]),
  '/javadoc.io/doc/demo.group/demo-docs': () => [200, 'text/html', html('demo-docs 1.0.0 javadoc (demo.group)')],
  '/repo1.maven.org/maven2/demo/group/demo-docs/1.0.0/demo-docs-1.0.0.pom': () => text('<project><scm><url>https://github.com/demo/demo</url></scm></project>', 'application/xml'),
  // The first request finds documentation and the next lands on a version list, as javadoc.io has done between requests.
  '/javadoc.io/doc/demo.group/demo-flaky': (_, origin) => (flaky++ % 2 === 0
    ? [200, 'text/html', html('demo-flaky 1.0.0 javadoc (demo.group)')]
    : [302, '', '', { location: `${origin}/javadoc.io/versions/demo.group/demo-bom` }]),
  '/javadoc.io/doc/demo.group/demo-bom': (_, origin) => [302, '', '', { location: `${origin}/javadoc.io/versions/demo.group/demo-bom` }],
  '/javadoc.io/versions/demo.group/demo-bom': () => [200, 'text/html', html('demo.group:demo-bom versions')],
}

/**
 * The four variants of every host family. `reported` is what the host calls
 * the package, `repo` the repository it files it under, and `manifest` the
 * version the pinned manifest declares; the host carries 1.0.0.
 */
const VARIANTS = {
  good: { reported: (name) => name, repo: 'demo/demo', manifest: '1.0.0', failure: undefined },
  name: { reported: () => 'someone-elses', repo: 'demo/demo', manifest: '1.0.0', failure: 'identity' },
  repo: { reported: (name) => name, repo: 'someone/else', manifest: '1.0.0', failure: 'repository' },
  old: { reported: (name) => name, repo: 'demo/demo', manifest: '2.0.0', failure: 'version' },
}

/**
 * One host family: how its package is named in the inventory, and how the
 * host answers for a package that reports `shown` under `repo`.
 */
const FAMILIES = [
  {
    host: 'pypi', coordinate: (id) => id, destination: (id) => ({ package: { host: 'pypi', url: `https://pypi.org/project/${id}/` } }),
    serve: (id, { shown, repo }) => {
      routes[`/pypi.org/pypi/${id}/json`] = () => text({ info: { name: shown, version: '1.0.0', project_urls: { Repository: `https://github.com/${repo}` } }, releases: { '1.0.0': [{}] } })
      routes[`/pypi.org/project/${id}/`] = () => [200, 'text/html', html('Client Challenge')]
    },
  },
  {
    host: 'npm', coordinate: (id) => `@demo/${id}`, path: 'packages/x',
    destination: (id) => ({ package: { host: 'npm', url: `https://www.npmjs.com/package/@demo/${id}` } }),
    serve: (id, { shown, repo }) => {
      routes[`/registry.npmjs.org/@demo%2f${id}`] = () => text({ name: shown === id ? `@demo/${id}` : shown, 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': {} }, repository: { url: `git+https://github.com/${repo}.git`, directory: 'packages/x' } })
      routes[`/www.npmjs.com/package/@demo/${id}`] = () => [403, 'text/html', html('Just a moment...')]
    },
  },
  {
    host: 'crates', coordinate: (id) => id, destination: (id) => ({ package: { host: 'crates', url: `https://crates.io/crates/${id}` } }),
    serve: (id, { shown, repo }) => {
      routes[`/crates.io/api/v1/crates/${id}`] = () => text({ crate: { name: shown, max_version: '1.0.0', repository: `https://github.com/${repo}` }, versions: [{ num: '1.0.0', yanked: false }] })
      routes[`/crates.io/crates/${id}`] = () => [200, 'text/html', html('crates.io: Rust Package Registry')]
    },
  },
  {
    host: 'rubygems', coordinate: (id) => id, destination: (id) => ({ package: { host: 'rubygems', url: `https://rubygems.org/gems/${id}` } }),
    serve: (id, { shown, repo }) => {
      routes[`/rubygems.org/api/v1/gems/${id}.json`] = () => text({ name: shown, version: '1.0.0', source_code_uri: `https://github.com/${repo}` })
      routes[`/rubygems.org/api/v1/versions/${id}.json`] = () => text([{ number: '1.0.0', yanked_at: null }])
    },
  },
  {
    host: 'powershell-gallery', coordinate: (id) => id, destination: (id) => ({ package: { host: 'powershell-gallery', url: `https://www.powershellgallery.com/packages/${id}` } }),
    serve: (id, { shown, repo }) => {
      routes[`/www.powershellgallery.com/packages/${id}`] = () => [200, 'text/html', html(`PowerShell Gallery | ${shown} 1.0.0`)]
      routes[`/www.powershellgallery.com/api/v2/Packages(Id='${id}',Version='1.0.0')`] = () => text(`<entry xmlns:d="d"><d:Id>${id}</d:Id><d:ProjectUrl>https://github.com/${repo}</d:ProjectUrl></entry>`, 'application/xml')
    },
  },
  {
    host: 'nuget', coordinate: (id) => id, destination: (id) => ({ package: { host: 'nuget', url: `https://www.nuget.org/packages/${id}` } }),
    serve: (id, { shown, repo }) => {
      const lower = id.toLowerCase()
      routes[`/www.nuget.org/packages/${id}`] = () => [200, 'text/html', html(`NuGet Gallery | ${shown} 1.0.0`)]
      routes[`/api.nuget.org/v3-flatcontainer/${lower}/index.json`] = () => text({ versions: ['1.0.0'] })
      routes[`/api.nuget.org/v3-flatcontainer/${lower}/1.0.0/${lower}.nuspec`] = () => text(`<package><metadata><repository type="git" url="https://github.com/${repo}"/></metadata></package>`, 'application/xml')
    },
  },
  {
    host: 'luarocks', coordinate: (id) => id, destination: (id) => ({ package: { host: 'luarocks', url: `https://luarocks.org/modules/demo/${id}` } }),
    serve: (id, { shown, repo }) => {
      routes[`/luarocks.org/modules/demo/${id}`] = () => [200, 'text/html', html(`${shown} - LuaRocks`, `<h3>Homepage</h3><a class="external_url" href="https://github.com/${repo}">x</a><a href="/modules/demo/${id}/1.0.0">1.0.0</a>`)]
    },
  },
  {
    host: 'maven-central', coordinate: (id) => `demo.group:${id}`, destination: (id) => ({ package: { host: 'maven-central', url: `https://central.sonatype.com/artifact/demo.group/${id}` } }),
    serve: (id, { shown, repo }) => {
      routes[`/repo1.maven.org/maven2/demo/group/${id}/maven-metadata.xml`] = () => text(`<metadata><groupId>demo.group</groupId><artifactId>${shown}</artifactId><versioning><release>1.0.0</release><versions><version>1.0.0</version></versions></versioning></metadata>`, 'application/xml')
      routes[`/repo1.maven.org/maven2/demo/group/${id}/1.0.0/${id}-1.0.0.pom`] = () => text(`<project><url>https://github.com/${repo}</url><scm><url>https://github.com/${repo}</url></scm></project>`, 'application/xml')
      routes[`/central.sonatype.com/artifact/demo.group/${id}`] = () => [200, 'text/html', html(`Maven Central: demo.group:${id}`)]
    },
  },
  {
    host: 'pkg-go-dev', coordinate: (id) => `example.com/o/lib/${id}`, destination: (id) => ({ package: { host: 'pkg-go-dev', url: `https://pkg.go.dev/example.com/o/lib/${id}` } }),
    serve: (id, { shown }) => {
      routes[`/pkg.go.dev/example.com/o/lib/${id}`] = () => [200, 'text/html', html(`${id} package - example.com/o/lib/${shown} - Go Packages`)]
      routes['/proxy.golang.org/example.com/o/lib/@v/v1.0.0.info'] = () => text({ Version: 'v1.0.0' })
    },
  },
  {
    host: 'docs-rs', coordinate: (id) => id, destination: (id) => ({ api: { host: 'docs-rs', url: `https://docs.rs/${id}` } }),
    serve: (id, { shown }) => {
      routes[`/docs.rs/${id}`] = (_, origin) => [302, '', '', { location: `${origin}/docs.rs/${id}/1.0.0/${id}/` }]
      routes[`/docs.rs/${id}/1.0.0/${id}/`] = () => [200, 'text/html', html(`${shown.replaceAll('-', '_')} - Rust`)]
      routes[`/docs.rs/${id}/1.0.0/`] = () => [200, 'text/html', html(`${id} - Rust`)]
    },
  },
  {
    host: 'swift-package-index', repoFor: (id) => `demo/${id}`, coordinate: (id) => id, destination: (id) => ({ package: { host: 'swift-package-index', url: `https://swiftpackageindex.com/demo/${id}` } }),
    serve: (id, { shown }) => {
      routes[`/swiftpackageindex.com/demo/${id}`] = () => [200, 'text/html', html(`${id} &ndash; Swift Package Index`, `<a href="https://github.com/${shown === id ? `demo/${id}` : 'demo/other'}">source</a> Version 1.0.0`)]
    },
  },
  {
    host: 'swift-docs', repoFor: (id) => `demo/${id}`, coordinate: (id) => id, destination: (id) => ({ api: { host: 'swift-package-index', url: `https://swiftpackageindex.com/demo/${id}/documentation/lib` } }),
    serve: (id, { shown }) => {
      routes[`/swiftpackageindex.com/demo/${id}/documentation/lib`] = (_, origin) => [302, '', '', { location: `${origin}/swiftpackageindex.com/demo/${shown === id ? id : 'other'}/1.0.0/documentation/lib` }]
      routes[`/swiftpackageindex.com/demo/${id}/1.0.0/documentation/lib`] = () => [200, 'text/html', html('lib Documentation &ndash; Swift Package Index')]
      routes[`/swiftpackageindex.com/demo/other/1.0.0/documentation/lib`] = () => [200, 'text/html', html('lib Documentation &ndash; Swift Package Index')]
    },
  },
]
/** The families whose hosts name no repository apart from the one in the URL, so a repository variant has nothing to contradict. */
const NO_REPOSITORY = new Set(['pkg-go-dev', 'docs-rs', 'swift-package-index', 'swift-docs'])

/** Any other repository under demo/ is a page titled for itself, and a directory of one is titled as GitHub titles it. */
function github(path) {
  const tree = /^\/github\.com\/demo\/([^/]+)\/tree\/([^/]+)\/(.+)$/.exec(path)
  if (tree) return () => [200, 'text/html', html(`${tree[1]}/${tree[3]} at ${tree[2]} · demo/${tree[1]} · GitHub`)]
  const root = /^\/github\.com\/demo\/([^/]+)$/.exec(path)
  return root ? () => [200, 'text/html', html(`GitHub - demo/${root[1]}: a demo · GitHub`)] : undefined
}

const server = createServer((request, response) => {
  const origin = `http://127.0.0.1:${server.address().port}`
  const route = routes[decodeURI(request.url)] ?? routes[request.url] ?? github(request.url)
  const [status, type, body, headers] = route ? route(request.url, origin) : [404, 'text/plain', 'not found']
  response.writeHead(status, { 'content-type': type, ...headers })
  response.end(body)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const ORIGINS = ['github.com', 'pypi.org', 'rubygems.org', 'javadoc.io', 'registry.npmjs.org', 'www.npmjs.com', 'crates.io', 'repo1.maven.org', 'central.sonatype.com',
  'www.nuget.org', 'api.nuget.org', 'www.powershellgallery.com', 'luarocks.org', 'pkg.go.dev', 'proxy.golang.org', 'docs.rs', 'swiftpackageindex.com']
const rewrite = JSON.stringify(Object.fromEntries(ORIGINS.map((host) => [`https://${host}`, `${base}/${host}`])))

const entry = (id, fields) => ({ id, kind: 'library', product: 'core', label: id, coordinate: id, aliases: [], repo: 'demo/demo', ref: 'master', status: 'published', ...fields })
const pypi = (name) => ({ package: { host: 'pypi', url: `https://pypi.org/project/${name}/` } })
const gem = (name) => ({ package: { host: 'rubygems', url: `https://rubygems.org/gems/${name}` } })
const doc = (name) => ({ api: { host: 'javadoc-io', url: `https://javadoc.io/doc/demo.group/${name}` } })
const manifestFor = (distributions) => ({ ports: { demo: { distributions: distributions.map(([name, version]) => ({ name, version, repo: 'demo/demo', manifest: 'm' })) } } })

const dir = mkdtempSync(join(tmpdir(), 'verify-destinations-'))
let cases = 0
let failures = 0

async function verify(name, inventory, { args = [], expect: expected, evidence, manifests = { ports: {} } }) {
  cases += 1
  const inventoryFile = join(dir, `inventory-${cases}.json`)
  const out = join(dir, `evidence-${cases}.json`)
  const manifestFile = join(dir, `manifests-${cases}.json`)
  writeFileSync(inventoryFile, JSON.stringify({ demo: inventory }))
  writeFileSync(manifestFile, JSON.stringify(manifests))
  if (evidence) writeFileSync(out, JSON.stringify(evidence))
  let result
  try {
    const done = await run('node', [script, '--inventory', inventoryFile, '--out', out, '--date', '2026-01-01', '--today', '2026-01-02', '--manifests', manifestFile, ...args],
      { env: { ...process.env, LIBTMUX_DESTINATION_REWRITE: rewrite } })
    result = { code: 0, text: `${done.stdout}${done.stderr}` }
  } catch (error) {
    result = { code: error.code, text: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
  const ok = result.code === expected.code && expected.matches.every((pattern) => pattern.test(result.text))
    && (expected.excludes ?? []).every((pattern) => !pattern.test(result.text))
  if (ok) console.log(`ok   ${name}`)
  else {
    console.error(`FAIL ${name} — exit ${result.code}, wanted ${expected.code}, ${expected.matches}, not ${expected.excludes ?? []}:\n${result.text}`)
    failures += 1
  }
  return { ...result, out }
}

// A published destination that names what the host serves.
const control = [entry('demo-good', { ...pypi('demo-good') })]
const clean = await verify('a destination that names what the host serves passes', control, { expect: { code: 0, matches: [/ok\s+200\s+package\s+https:\/\/pypi\.org\/project\/demo-good\//] } })
const record = JSON.parse(readFileSync(clean.out, 'utf8')).destinations.find((candidate) => candidate.url === 'https://pypi.org/project/demo-good/')
if (record?.ok === true && record.identity === 'demo-good' && record.status === 200 && record.checkedAt === '2026-01-01' && record.pageStatus === 200 && record.repository === 'demo/demo') console.log('ok   the evidence records the url, status, identity, repository, page status and date')
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
await verify('a renamed repository fails on identity, though its old URL still answers', [entry('renamed', { repo: 'demo/renamed' })], {
  expect: { code: 1, matches: [/FAIL\s+200\s+source/, /identity: .* the repository was renamed or moved/] },
})
await verify('a title that begins with the repository name but names a longer one fails', [entry('lib-go', { repo: 'demo/lib-go' })], {
  expect: { code: 1, matches: [/FAIL\s+200\s+source/, /identity: title is "GitHub - demo\/lib-golang/] },
})
await verify('javadoc.io landing on a version list fails on identity', [entry('demo-bom', { ...doc('demo-bom') })], {
  expect: { code: 1, matches: [/FAIL\s+200\s+api/, /identity: title is "demo\.group:demo-bom versions"/] },
})
await verify('javadoc.io answering differently across requests fails as unstable', [entry('demo-flaky', { ...doc('demo-flaky') })], {
  expect: { code: 1, matches: [/FAIL\s+200\s+api/, /unstable: 3 requests disagreed/] },
})

// The manifest's version must be one the host carries.
const library = [entry('demo-good', { ...pypi('demo-good') })]
await verify('a version the manifest declares and the host carries is confirmed', library, {
  manifests: manifestFor([['demo-good', '1.0.0']]), expect: { code: 0, matches: [/ok\s+200\s+package\s+https:\/\/pypi\.org/] },
})
await verify('a version the manifest declares and the host lacks fails', library, {
  manifests: manifestFor([['demo-good', '2.0.0']]), expect: { code: 1, matches: [/does not carry 2\.0\.0, the version demo\/demo:m declares/] },
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

// Every host family, once with each variant. One run answers them all, and each URL is read on its own line.
const inventory = []
const distributions = []
const expectations = []
for (const family of FAMILIES) {
  for (const [variant, spec] of Object.entries(VARIANTS)) {
    if (variant === 'repo' && NO_REPOSITORY.has(family.host)) continue
    const id = `${family.host.replace('swift-docs', 'swiftdocs')}-${variant}`
    const coordinate = family.coordinate(id)
    family.serve(id, { shown: spec.reported(id), repo: spec.repo })
    const destination = family.destination(id)
    inventory.push(entry(id, { coordinate, repo: family.repoFor?.(id) ?? 'demo/demo', ...(family.path && { path: family.path }), ...destination }))
    distributions.push([coordinate, spec.manifest])
    const url = (destination.package ?? destination.api).url
    expectations.push({ family: family.host, variant, url, failure: spec.failure })
  }
}
const families = await verify('every host family reports a different package, repository or version as a failure', inventory, {
  manifests: manifestFor(distributions), expect: { code: 1, matches: [/problems? in /] },
})
const lines = new Map([...families.text.matchAll(/^(ok  |FAIL|none) (\d+)\s+(\S+)\s+(\S+)\n?(?:\s+(\w+): (.*))?$/gm)].map((match) => [match[4], { status: match[1].trim(), failure: match[5], detail: match[6] }]))
const problems = families.text.split('\n').filter((line) => /^ {2}https:/.test(line))
for (const { family, variant, url, failure } of expectations) {
  const found = lines.get(url)
  const mentioned = problems.some((line) => line.includes(url))
  if (!failure) {
    const ok = found?.status === 'ok' && !mentioned
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${family}: the right package under the right repository passes`)
    if (!ok) { console.error(`     ${JSON.stringify(found)}\n${problems.filter((line) => line.includes(url)).join('\n')}`); failures += 1 }
    continue
  }
  // A version the host lacks is a record that passes and a problem the comparison reports; the rest fail on the record.
  const ok = failure === 'version' ? found?.status === 'ok' && problems.some((line) => line.includes(url) && /does not carry 2\.0\.0/.test(line))
    : found?.status === 'FAIL' && found.failure === failure && mentioned
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${family}: ${variant === 'name' ? 'a different package' : variant === 'repo' ? 'a different repository' : 'a version the host lacks'} fails on ${failure}`)
  if (!ok) { console.error(`     ${JSON.stringify(found)} ${mentioned}`); failures += 1 }
}

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
await verify('offline, a version the host lacks fails', control, {
  args: ['--check'], evidence: { ...good, destinations: good.destinations.map((item) => (item.host === 'pypi' ? { ...item, expectedVersion: '0.0.1', versionSource: 'demo/demo:m', versionCheck: 'absent' } : item)) },
  expect: { code: 1, matches: [/does not carry 0\.0\.1/] },
})
await verify('offline, a host that lists versions declining to confirm one fails', library, {
  args: ['--check'], manifests: manifestFor([['demo-good', '1.0.0']]),
  evidence: { ...good, destinations: good.destinations.map((item) => (item.host === 'pypi' ? { ...item, expectedVersion: '1.0.0', versionSource: 'demo/demo:m', versionCheck: 'unsupported', versionNote: 'skipped' } : item)) },
  expect: { code: 1, matches: [/could not confirm 1\.0\.0 on pypi, which lists versions/] },
})
await verify('offline, evidence checked for another version than the manifest declares fails', library, {
  args: ['--check'], manifests: manifestFor([['demo-good', '3.0.0']]), evidence: { ...good, destinations: good.destinations.map((item) => (item.host === 'pypi' ? { ...item, expectedVersion: '1.0.0', versionSource: 'demo/demo:m', versionCheck: 'confirmed' } : item)) },
  expect: { code: 1, matches: [/was checked for 1\.0\.0 but the manifests now declare 3\.0\.0/] },
})
// Age is a warning wherever a change that touches none of this might run it, and a failure only where a live run is the remedy.
await verify('offline, fresh evidence passes without a warning', control, {
  args: ['--check', '--today', '2026-03-01'], evidence: good, expect: { code: 0, matches: [/agrees with the inventory/], excludes: [/warning/] },
})
await verify('offline, evidence older than the bound prints a warning with its date and still passes', control, {
  args: ['--check', '--today', '2026-06-01'], evidence: good,
  expect: { code: 0, matches: [/warning: \d+ destination records? (?:was|were) last checked 2026-01-01, more than 60 days ago: run node scripts\/verify-destinations\.mjs/, /agrees with the inventory/] },
})
await verify('offline, --fresh passes fresh evidence', control, {
  args: ['--check', '--fresh', '--today', '2026-03-01'], evidence: good, expect: { code: 0, matches: [/agrees with the inventory/], excludes: [/warning/] },
})
await verify('offline, --fresh fails evidence older than the bound', control, {
  args: ['--check', '--fresh', '--today', '2026-06-01'], evidence: good, expect: { code: 1, matches: [/last checked 2026-01-01, more than 60 days ago/] },
})
await verify('a live run cannot record a check older than the bound', control, {
  args: ['--date', '2026-01-01', '--today', '2026-06-01'], expect: { code: 1, matches: [/last checked 2026-01-01, more than 60 days ago/] },
})
await verify('a live run that records today passes', control, {
  args: ['--date', '2026-06-01', '--today', '2026-06-01'], expect: { code: 0, matches: [/wrote /] },
})
await verify('offline, a record without a check date fails whatever the age', control, {
  args: ['--check'], evidence: { ...good, destinations: good.destinations.map((item, index) => (index === 0 ? { ...item, checkedAt: undefined } : item)) },
  expect: { code: 1, matches: [/has no valid check date/] },
})

server.close()
rmSync(dir, { recursive: true, force: true })
if (failures > 0) {
  console.error(`${failures} case${failures === 1 ? '' : 's'} failed`)
  process.exit(1)
}
