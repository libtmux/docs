#!/usr/bin/env node
/*
 * Proof that verify-destinations can still fail.
 *
 * The hosts are answered by a local server, so no case touches the network.
 * The control is a destination that names what the host serves: a check that
 * failed everything would satisfy every other case.
 *
 * Single cases are the ones the real hosts produce: a 200 about a different
 * package (PyPI names another project), a 404, a javadoc.io landing on a
 * version list or answering differently across requests, a repository that was
 * renamed or whose title only begins with the right name, and a destination
 * kept out of the links that has started to answer. Others are the
 * inventory's: two ports that pin different releases of one package, a
 * `within` that dangles or loops, and a Go package in a nested module whose
 * parent has the tag. The offline comparison is shown a record dropped,
 * failed, orphaned, edited to another repository or directory, left without a
 * version it should have confirmed, checked for a version the manifests no
 * longer declare, and dated in the future. A date a caller names is refused
 * when it is not a day or has not happened.
 *
 * Age is the exception to failing: evidence past the bound is a warning offline
 * (an annotation under GitHub Actions) and a failure only under --fresh or at
 * the end of a live run.
 *
 * Host families are then run through a fixed set of cases, named per family in
 * FAMILIES below. Every family gets the right package, a different package
 * under the same URL, and a version the manifest declares that the host lacks.
 * The families whose host reports a repository (PyPI, npm, crates.io,
 * RubyGems, the PowerShell Gallery, NuGet, LuaRocks, Maven Central, Hex and
 * javadoc.io) also get the right package filed under another repository and
 * one whose host reports no repository at all, and npm a directory that
 * differs. pkg.go.dev, docs.rs, HexDocs and the Swift Package Index name their
 * repository only in the URL, so they get none of those; pkg.go.dev instead
 * gets three nested-module cases.
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
  // Two releases, for ports that pin different ones of one package.
  '/pypi.org/pypi/demo-twin/json': () => text({ info: { name: 'demo-twin', version: '2.0.0', project_urls: { Repository: 'https://github.com/demo/demo' } }, releases: { '1.0.0': [{}], '2.0.0': [{}] } }),
  '/pypi.org/project/demo-twin/': () => [200, 'text/html', html('Client Challenge')],
  // A project whose home page is another repository and whose source is this one: the host lists the other first.
  '/pypi.org/pypi/demo-multi/json': () => text({ info: { name: 'demo-multi', version: '1.0.0', home_page: 'https://github.com/other/docs', project_urls: { Source: 'https://github.com/demo/demo' } }, releases: { '1.0.0': [{}] } }),
  '/pypi.org/project/demo-multi/': () => [200, 'text/html', html('Client Challenge')],
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
 * The variants a family may be run through. `reported` is what the host calls
 * the package, `repo` the repository it files it under ('' for none),
 * `manifest` the version the pinned manifest declares (the host carries 1.0.0),
 * and `directory` the subdirectory npm reports.
 */
const VARIANTS = {
  good: { reported: (name) => name, repo: 'demo/demo', manifest: '1.0.0', failure: undefined },
  name: { reported: () => 'someone-elses', repo: 'demo/demo', manifest: '1.0.0', failure: 'identity' },
  repo: { reported: (name) => name, repo: 'someone/else', manifest: '1.0.0', failure: 'repository', detail: /reports someone\/else/ },
  bare: { reported: (name) => name, repo: '', manifest: '1.0.0', failure: 'repository', detail: /names no repository/ },
  old: { reported: (name) => name, repo: 'demo/demo', manifest: '2.0.0', failure: 'version' },
  directory: { reported: (name) => name, repo: 'demo/demo', manifest: '1.0.0', directory: 'packages/other', failure: 'repository', detail: /reports the directory packages\/other/ },
}
const REPORTS_REPOSITORY = ['good', 'name', 'repo', 'bare', 'old']
const NAMED_BY_URL = ['good', 'name', 'old']

/**
 * One host family: how its package is named in the inventory, how the host
 * answers for a package that reports `shown` under `repo`, and which variants
 * it is run through.
 */
const FAMILIES = [
  {
    host: 'pypi', variants: REPORTS_REPOSITORY, coordinate: (id) => id, destination: (id) => ({ package: { host: 'pypi', url: `https://pypi.org/project/${id}/` } }),
    serve: (id, { shown, repo }) => {
      routes[`/pypi.org/pypi/${id}/json`] = () => text({ info: { name: shown, version: '1.0.0', project_urls: { Repository: `https://github.com/${repo}` } }, releases: { '1.0.0': [{}] } })
      routes[`/pypi.org/project/${id}/`] = () => [200, 'text/html', html('Client Challenge')]
    },
  },
  {
    host: 'npm', variants: [...REPORTS_REPOSITORY, 'directory'], coordinate: (id) => `@demo/${id}`, path: 'packages/x',
    destination: (id) => ({ package: { host: 'npm', url: `https://www.npmjs.com/package/@demo/${id}` } }),
    serve: (id, { shown, repo, directory = 'packages/x' }) => {
      routes[`/registry.npmjs.org/@demo%2f${id}`] = () => text({ name: shown === id ? `@demo/${id}` : shown, 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': {} }, repository: { url: `git+https://github.com/${repo}.git`, directory } })
      routes[`/www.npmjs.com/package/@demo/${id}`] = () => [403, 'text/html', html('Just a moment...')]
    },
  },
  {
    host: 'crates', variants: REPORTS_REPOSITORY, coordinate: (id) => id, destination: (id) => ({ package: { host: 'crates', url: `https://crates.io/crates/${id}` } }),
    serve: (id, { shown, repo }) => {
      routes[`/crates.io/api/v1/crates/${id}`] = () => text({ crate: { name: shown, max_version: '1.0.0', repository: `https://github.com/${repo}` }, versions: [{ num: '1.0.0', yanked: false }] })
      routes[`/crates.io/crates/${id}`] = () => [200, 'text/html', html('crates.io: Rust Package Registry')]
    },
  },
  {
    host: 'rubygems', variants: REPORTS_REPOSITORY, coordinate: (id) => id, destination: (id) => ({ package: { host: 'rubygems', url: `https://rubygems.org/gems/${id}` } }),
    serve: (id, { shown, repo }) => {
      routes[`/rubygems.org/api/v1/gems/${id}.json`] = () => text({ name: shown, version: '1.0.0', source_code_uri: `https://github.com/${repo}` })
      routes[`/rubygems.org/api/v1/versions/${id}.json`] = () => text([{ number: '1.0.0', yanked_at: null }])
    },
  },
  {
    host: 'powershell-gallery', variants: REPORTS_REPOSITORY, coordinate: (id) => id, destination: (id) => ({ package: { host: 'powershell-gallery', url: `https://www.powershellgallery.com/packages/${id}` } }),
    serve: (id, { shown, repo }) => {
      routes[`/www.powershellgallery.com/packages/${id}`] = () => [200, 'text/html', html(`PowerShell Gallery | ${shown} 1.0.0`)]
      routes[`/www.powershellgallery.com/api/v2/Packages(Id='${id}',Version='1.0.0')`] = () => text(`<entry xmlns:d="d"><d:Id>${id}</d:Id><d:ProjectUrl>https://github.com/${repo}</d:ProjectUrl></entry>`, 'application/xml')
    },
  },
  {
    host: 'nuget', variants: REPORTS_REPOSITORY, coordinate: (id) => id, destination: (id) => ({ package: { host: 'nuget', url: `https://www.nuget.org/packages/${id}` } }),
    serve: (id, { shown, repo }) => {
      const lower = id.toLowerCase()
      routes[`/www.nuget.org/packages/${id}`] = () => [200, 'text/html', html(`NuGet Gallery | ${shown} 1.0.0`)]
      routes[`/api.nuget.org/v3-flatcontainer/${lower}/index.json`] = () => text({ versions: ['1.0.0'] })
      routes[`/api.nuget.org/v3-flatcontainer/${lower}/1.0.0/${lower}.nuspec`] = () => text(`<package><metadata><repository type="git" url="https://github.com/${repo}"/></metadata></package>`, 'application/xml')
    },
  },
  {
    host: 'luarocks', variants: REPORTS_REPOSITORY, coordinate: (id) => id, destination: (id) => ({ package: { host: 'luarocks', url: `https://luarocks.org/modules/demo/${id}` } }),
    serve: (id, { shown, repo }) => {
      routes[`/luarocks.org/modules/demo/${id}`] = () => [200, 'text/html', html(`${shown} - LuaRocks`, `<h3>Homepage</h3><a class="external_url" href="https://github.com/${repo}">x</a><a href="/modules/demo/${id}/1.0.0">1.0.0</a>`)]
    },
  },
  {
    host: 'maven-central', variants: REPORTS_REPOSITORY, coordinate: (id) => `demo.group:${id}`, destination: (id) => ({ package: { host: 'maven-central', url: `https://central.sonatype.com/artifact/demo.group/${id}` } }),
    serve: (id, { shown, repo }) => {
      routes[`/repo1.maven.org/maven2/demo/group/${id}/maven-metadata.xml`] = () => text(`<metadata><groupId>demo.group</groupId><artifactId>${shown}</artifactId><versioning><release>1.0.0</release><versions><version>1.0.0</version></versions></versioning></metadata>`, 'application/xml')
      routes[`/repo1.maven.org/maven2/demo/group/${id}/1.0.0/${id}-1.0.0.pom`] = () => text(`<project><url>https://github.com/${repo}</url><scm><url>https://github.com/${repo}</url></scm></project>`, 'application/xml')
      routes[`/central.sonatype.com/artifact/demo.group/${id}`] = () => [200, 'text/html', html(`Maven Central: demo.group:${id}`)]
    },
  },
  {
    host: 'javadoc-io', variants: REPORTS_REPOSITORY, coordinate: (id) => `demo.group:${id}`, destination: (id) => ({ api: { host: 'javadoc-io', url: `https://javadoc.io/doc/demo.group/${id}` } }),
    serve: (id, { shown, repo }) => {
      routes[`/javadoc.io/doc/demo.group/${id}`] = () => [200, 'text/html', html(`${shown} 1.0.0 javadoc (demo.group)`)]
      routes[`/javadoc.io/doc/demo.group/${id}/1.0.0`] = () => [200, 'text/html', html(`${id} 1.0.0 javadoc (demo.group)`)]
      // The documentation names no repository; Central's POM for the artifact does.
      routes[`/repo1.maven.org/maven2/demo/group/${id}/1.0.0/${id}-1.0.0.pom`] = () => text(`<project><url>https://github.com/${repo}</url><scm><url>https://github.com/${repo}</url></scm></project>`, 'application/xml')
    },
  },
  {
    host: 'hex', variants: REPORTS_REPOSITORY, coordinate: (id) => id, destination: (id) => ({ package: { host: 'hex', url: `https://hex.pm/packages/${id}` } }),
    serve: (id, { shown, repo }) => {
      routes[`/hex.pm/packages/${id}`] = () => [200, 'text/html', html(`${shown} | Hex`)]
      routes[`/hex.pm/api/packages/${id}`] = () => text({ name: shown, latest_version: '1.0.0', releases: [{ version: '1.0.0' }], meta: { links: repo ? { GitHub: `https://github.com/${repo}` } : {} } })
    },
  },
  {
    host: 'hexdocs', variants: NAMED_BY_URL, coordinate: (id) => id, destination: (id) => ({ api: { host: 'hexdocs', url: `https://${id}.hexdocs.pm/` } }),
    serve: (id, { shown }) => {
      // The reported name leads the title of the package's root page and of the page for its release.
      routes[`/${id}.hexdocs.pm/`] = () => [200, 'text/html', html(`${shown} v1.0.0 \u2014 Documentation`)]
      routes[`/${id}.hexdocs.pm/1.0.0/`] = () => [200, 'text/html', html(`${shown} v1.0.0 \u2014 Documentation`)]
    },
  },
  {
    host: 'pkg-go-dev', variants: NAMED_BY_URL, coordinate: (id) => `example.com/o/lib/${id}`, destination: (id) => ({ package: { host: 'pkg-go-dev', url: `https://pkg.go.dev/example.com/o/lib/${id}` } }),
    serve: (id, { shown }) => {
      routes[`/pkg.go.dev/example.com/o/lib/${id}`] = () => [200, 'text/html', html(`${id} package - example.com/o/lib/${shown} - Go Packages`)]
      goModule('example.com/o/lib', ['v1.0.0'], '')
    },
  },
  {
    host: 'docs-rs', variants: NAMED_BY_URL, coordinate: (id) => id, destination: (id) => ({ api: { host: 'docs-rs', url: `https://docs.rs/${id}` } }),
    serve: (id, { shown }) => {
      routes[`/docs.rs/${id}`] = (_, origin) => [302, '', '', { location: `${origin}/docs.rs/${id}/1.0.0/${id}/` }]
      routes[`/docs.rs/${id}/1.0.0/${id}/`] = () => [200, 'text/html', html(`${shown.replaceAll('-', '_')} - Rust`)]
      routes[`/docs.rs/${id}/1.0.0/`] = () => [200, 'text/html', html(`${id} - Rust`)]
    },
  },
  {
    host: 'swift-package-index', variants: NAMED_BY_URL, repoFor: (id) => `demo/${id}`, coordinate: (id) => id, destination: (id) => ({ package: { host: 'swift-package-index', url: `https://swiftpackageindex.com/demo/${id}` } }),
    serve: (id, { shown }) => {
      routes[`/swiftpackageindex.com/demo/${id}`] = () => [200, 'text/html', html(`${id} &ndash; Swift Package Index`, `<a href="https://github.com/${shown === id ? `demo/${id}` : 'demo/other'}">source</a> Version 1.0.0`)]
    },
  },
  {
    host: 'swift-docs', variants: NAMED_BY_URL, repoFor: (id) => `demo/${id}`, coordinate: (id) => id, destination: (id) => ({ api: { host: 'swift-package-index', url: `https://swiftpackageindex.com/demo/${id}/documentation/lib` } }),
    serve: (id, { shown }) => {
      routes[`/swiftpackageindex.com/demo/${id}/documentation/lib`] = (_, origin) => [302, '', '', { location: `${origin}/swiftpackageindex.com/demo/${shown === id ? id : 'other'}/1.0.0/documentation/lib` }]
      routes[`/swiftpackageindex.com/demo/${id}/1.0.0/documentation/lib`] = () => [200, 'text/html', html('lib Documentation &ndash; Swift Package Index')]
      routes[`/swiftpackageindex.com/demo/other/1.0.0/documentation/lib`] = () => [200, 'text/html', html('lib Documentation &ndash; Swift Package Index')]
    },
  },
]

/** A Go module on the proxy: the versions it lists, and where in its repository the proxy says it lives. */
function goModule(path, versions, subdir) {
  routes[`/proxy.golang.org/${path}/@v/list`] = () => text(`${versions.join('\n')}\n`, 'text/plain')
  for (const version of versions) routes[`/proxy.golang.org/${path}/@v/${version}.info`] = () => text({ Version: version, Origin: { VCS: 'git', ...(subdir && { Subdir: subdir }) } })
}

/** Any other repository under demo/ is a page titled for itself, and a directory of one is titled as GitHub titles it. */
function github(path) {
  const tree = /^\/github\.com\/demo\/([^/]+)\/(?:tree|blob)\/([^/]+)\/(.+)$/.exec(path)
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
  'www.nuget.org', 'api.nuget.org', 'www.powershellgallery.com', 'luarocks.org', 'pkg.go.dev', 'proxy.golang.org', 'docs.rs', 'swiftpackageindex.com', 'hex.pm',
  // HexDocs gives each package a host of its own, so each package a case serves is an origin.
  ...NAMED_BY_URL.map((variant) => `hexdocs-${variant}.hexdocs.pm`)]
const rewrite = JSON.stringify(Object.fromEntries(ORIGINS.map((host) => [`https://${host}`, `${base}/${host}`])))

const entry = (id, fields) => ({ id, kind: 'library', product: 'core', label: id, coordinate: id, aliases: [], repo: 'demo/demo', ref: 'master', status: 'published', ...fields })
const pypi = (name) => ({ package: { host: 'pypi', url: `https://pypi.org/project/${name}/` } })
const gem = (name) => ({ package: { host: 'rubygems', url: `https://rubygems.org/gems/${name}` } })
const doc = (name) => ({ api: { host: 'javadoc-io', url: `https://javadoc.io/doc/demo.group/${name}` } })
const manifestFor = (distributions) => ({ ports: { demo: { distributions: distributions.map(([name, version]) => ({ name, version, repo: 'demo/demo', manifest: 'm' })) } } })

const dir = mkdtempSync(join(tmpdir(), 'verify-destinations-'))
let cases = 0
let failures = 0

/** Run the command on an inventory: an array is the port `demo`, an object is several ports. */
async function verify(name, inventory, { args = [], expect: expected, evidence, manifests = { ports: {} }, env = {}, timeout = 60_000 }) {
  cases += 1
  const inventoryFile = join(dir, `inventory-${cases}.json`)
  const out = join(dir, `evidence-${cases}.json`)
  const manifestFile = join(dir, `manifests-${cases}.json`)
  writeFileSync(inventoryFile, JSON.stringify(Array.isArray(inventory) ? { demo: inventory } : inventory))
  writeFileSync(manifestFile, JSON.stringify(manifests))
  if (evidence) writeFileSync(out, JSON.stringify(evidence))
  let result
  try {
    const done = await run('node', [script, '--inventory', inventoryFile, '--out', out, '--date', '2026-01-01', '--today', '2026-01-02', '--manifests', manifestFile, ...args],
      { timeout, env: { ...process.env, GITHUB_ACTIONS: '', LIBTMUX_DESTINATION_REWRITE: rewrite, ...env } })
    result = { code: 0, text: `${done.stdout}${done.stderr}` }
  } catch (error) {
    result = { code: error.killed ? 'timeout' : error.code, text: `${error.stdout ?? ''}${error.stderr ?? ''}` }
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

// The repository recorded is the one that matched an owner, not the first the host lists, or the run's own
// closing comparison would fail a destination it had just passed.
const multi = await verify('a registry that lists another repository first passes on the one that matches', [entry('demo-multi', { ...pypi('demo-multi') })], {
  manifests: manifestFor([['demo-multi', '1.0.0']]), expect: { code: 0, matches: [/ok\s+200\s+package\s+https:\/\/pypi\.org\/project\/demo-multi\//], excludes: [/problem/] },
})
const multiRecord = JSON.parse(readFileSync(multi.out, 'utf8')).destinations.find((candidate) => candidate.url === 'https://pypi.org/project/demo-multi/')
if (multiRecord?.repository === 'demo/demo') console.log('ok   the evidence names the repository that matched an owner, not the first listed')
else { console.error(`FAIL the evidence named ${multiRecord?.repository}, not demo/demo`); failures += 1 }
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
await verify('a file of a repository is read as a file, not a directory', [entry('a-file', { repo: 'demo/files', path: 'ext/x.jl', file: true })], {
  expect: { code: 0, matches: [/ok\s+200\s+source\s+https:\/\/github\.com\/demo\/files\/blob\/master\/ext\/x\.jl/] },
})
await verify('javadoc.io landing on a version list fails on identity', [entry('demo-bom', { ...doc('demo-bom') })], {
  expect: { code: 1, matches: [/FAIL\s+200\s+api/, /identity: title is "demo\.group:demo-bom versions"/] },
})
await verify('javadoc.io answering differently across requests fails as unstable', [entry('demo-flaky', { ...doc('demo-flaky') })], {
  expect: { code: 1, matches: [/FAIL\s+200\s+api/, /unstable: 3 requests disagreed/] },
})

// The manifest's version must be one the host carries, for every port that pins one.
const library = [entry('demo-good', { ...pypi('demo-good') })]
await verify('a version the manifest declares and the host carries is confirmed', library, {
  manifests: manifestFor([['demo-good', '1.0.0']]), expect: { code: 0, matches: [/ok\s+200\s+package\s+https:\/\/pypi\.org/] },
})
await verify('a version the manifest declares and the host lacks fails', library, {
  manifests: manifestFor([['demo-good', '2.0.0']]), expect: { code: 1, matches: [/does not carry 2\.0\.0, the version demo\/demo:m declares for demo/] },
})
const pins = (demo, other) => ({ ports: {
  demo: { distributions: [{ name: 'demo-twin', version: demo, repo: 'demo/demo', manifest: 'm' }] },
  other: { distributions: [{ name: 'demo-twin', version: other, repo: 'demo/demo', manifest: 'n' }] },
} })
const twin = { demo: [entry('demo-twin', { ...pypi('demo-twin') })], other: [entry('demo-twin', { ...pypi('demo-twin') })] }
const shared = await verify('two ports pinning one release of a package are checked once, for both', twin, {
  manifests: pins('1.0.0', '1.0.0'), expect: { code: 0, matches: [/ok\s+200\s+package\s+https:\/\/pypi\.org\/project\/demo-twin\//] },
})
const sharedChecks = JSON.parse(readFileSync(shared.out, 'utf8')).destinations.find((item) => item.host === 'pypi').versionChecks
if (sharedChecks.length === 1 && sharedChecks[0].ports.join() === 'demo,other') console.log('ok   the record names both ports under the one release')
else { console.error(`FAIL the record should name both ports: ${JSON.stringify(sharedChecks)}`); failures += 1 }
await verify('a port pinning a release the host lacks fails even when another port pins one it has', twin, {
  manifests: pins('1.0.0', '3.0.0'), expect: { code: 1, matches: [/does not carry 3\.0\.0, the version demo\/demo:n declares for other/], excludes: [/does not carry 1\.0\.0/] },
})
const both = await verify('ports pinning different releases the host carries are each confirmed', twin, {
  manifests: pins('1.0.0', '2.0.0'), expect: { code: 0, matches: [/ok\s+200\s+package\s+https:\/\/pypi\.org\/project\/demo-twin\//] },
})
const bothChecks = JSON.parse(readFileSync(both.out, 'utf8')).destinations.find((item) => item.host === 'pypi').versionChecks
if (bothChecks.map((item) => `${item.version}:${item.ports}:${item.check}`).join(' ') === '1.0.0:demo:confirmed 2.0.0:other:confirmed') console.log('ok   each port’s release has a check of its own')
else { console.error(`FAIL each port needs its own check: ${JSON.stringify(bothChecks)}`); failures += 1 }

// An inventory whose within dangles or loops is refused with its chain, not looped on.
const loop = (within) => ['a', 'b'].map((id, index) => entry(id, { ...pypi(`demo-${id}`), coordinate: `demo-${id}`, within: within(index) }))
await verify('a within that leads back to where it began is refused', loop((index) => (index === 0 ? 'b' : 'a')), {
  manifests: manifestFor([['demo-a', '1.0.0']]), timeout: 30_000, expect: { code: 1, matches: [/a -> b -> a: within leads back to a/] },
})
await verify('a within that names no entry is refused', loop((index) => (index === 0 ? 'missing' : undefined)), {
  manifests: manifestFor([['demo-a', '1.0.0']]), timeout: 30_000, expect: { code: 1, matches: [/a: within names missing, which is not an entry/] },
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

// Go: a package belongs to the module that lists versions, so a parent's tag cannot confirm a nested module.
const GO_ROOT = 'example.com/o/lib'
goModule(GO_ROOT, ['v1.0.0'], '')
goModule(`${GO_ROOT}/nestok`, ['v1.0.0'], 'nestok')
goModule(`${GO_ROOT}/nestfall`, ['v0.5.0'], 'nestfall')
goModule(`${GO_ROOT}/nestdir`, ['v1.0.0'], '')
const nested = ['nestok', 'nestfall', 'nestdir'].map((name) => {
  const path = `${GO_ROOT}/${name}/cmd/tool`
  routes[`/pkg.go.dev/${path}`] = () => [200, 'text/html', html(`tool command - ${path} - Go Packages`)]
  return { name, path }
})
const goRun = await verify('a Go package is confirmed by its own module and by no other', nested.map(({ name, path }) => entry(name, { coordinate: path, package: { host: 'pkg-go-dev', url: `https://pkg.go.dev/${path}` } })), {
  manifests: manifestFor(nested.map(({ path }) => [path, '1.0.0'])), expect: { code: 1, matches: [/problems? in /] },
})
const goProblems = goRun.text.split('\n').filter((line) => /^ {2}https:/.test(line))
const flagged = (name) => goProblems.some((line) => line.includes(`/${name}/cmd/tool`) && /does not carry 1\.0\.0/.test(line))
for (const [name, expectation, why] of [['nestok', false, 'the nested module lists the version at its own directory'], ['nestfall', true, 'the parent has v1.0.0 but the nested module lists only v0.5.0'], ['nestdir', true, 'the proxy reports the wrong subdirectory']]) {
  const ok = flagged(name) === expectation
  console.log(`${ok ? 'ok  ' : 'FAIL'} go: ${why}: ${expectation ? 'absent' : 'confirmed'}`)
  if (!ok) { console.error(goRun.text); failures += 1 }
}

// Every host family, once with each of its variants. One run answers them all, and each URL is read on its own line.
const inventory = []
const distributions = []
const expectations = []
for (const family of FAMILIES) {
  for (const variant of family.variants) {
    const spec = VARIANTS[variant]
    const id = `${family.host.replace('swift-docs', 'swiftdocs')}-${variant}`
    const coordinate = family.coordinate(id)
    family.serve(id, { shown: spec.reported(id), repo: spec.repo, directory: spec.directory })
    const destination = family.destination(id)
    inventory.push(entry(id, { coordinate, repo: family.repoFor?.(id) ?? 'demo/demo', ...(family.path && { path: family.path }), ...destination }))
    distributions.push([coordinate, spec.manifest])
    const url = (destination.package ?? destination.api).url
    expectations.push({ family: family.host, variant, url, failure: spec.failure, detail: spec.detail })
  }
}
const families = await verify('every host family reports a different package, repository or version as a failure', inventory, {
  manifests: manifestFor(distributions), expect: { code: 1, matches: [/problems? in /] },
})
const lines = new Map([...families.text.matchAll(/^(ok  |FAIL|none) (\d+)\s+(\S+)\s+(\S+)\n?(?:\s+(\w+): (.*))?$/gm)].map((match) => [match[4], { status: match[1].trim(), failure: match[5], detail: match[6] }]))
const problems = families.text.split('\n').filter((line) => /^ {2}https:/.test(line))
const WORDS = { name: 'a different package', repo: 'a different repository', bare: 'no repository at all', old: 'a version the host lacks', directory: 'a different directory' }
for (const { family, variant, url, failure, detail } of expectations) {
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
    : found?.status === 'FAIL' && found.failure === failure && mentioned && (!detail || detail.test(found.detail))
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${family}: ${WORDS[variant]} fails on ${failure}`)
  if (!ok) { console.error(`     ${JSON.stringify(found)} ${mentioned}`); failures += 1 }
}

// The offline comparison reads the evidence the run above wrote.
const good = JSON.parse(readFileSync(clean.out, 'utf8'))
const recordFor = (url) => good.destinations.find((candidate) => candidate.url === url)
const source = recordFor('https://github.com/demo/demo')
const withPypi = (change) => ({ ...good, destinations: good.destinations.map((item) => (item.host === 'pypi' ? { ...item, ...change } : item)) })
const check1 = (version, check, extra = {}) => [{ version, source: 'demo/demo:m', ports: ['demo'], check, ...extra }]
await verify('offline, evidence for every destination passes', control, { args: ['--check'], evidence: good, expect: { code: 0, matches: [/agrees with the inventory/] } })
await verify('offline, a destination with no record fails', control, {
  args: ['--check'], evidence: { ...good, destinations: [source] }, expect: { code: 1, matches: [/https:\/\/pypi\.org\/project\/demo-good\/ has no evidence/] },
})
await verify('offline, a published destination recorded as failing fails', control, {
  args: ['--check'], evidence: withPypi({ ok: false, failure: 'status', detail: '404' }),
  expect: { code: 1, matches: [/is linked by demo:demo-good but failed verification: status/] },
})
await verify('offline, a record no entry names fails', control, {
  args: ['--check'], evidence: { ...good, destinations: [...good.destinations, { ...source, url: 'https://github.com/demo/orphan' }] },
  expect: { code: 1, matches: [/https:\/\/github\.com\/demo\/orphan has evidence but no entry names it/] },
})
await verify('offline, a record edited to another repository fails', control, {
  args: ['--check'], evidence: withPypi({ repository: 'someone/else' }), expect: { code: 1, matches: [/was verified against someone\/else, but demo:demo-good live in demo\/demo/] },
})
await verify('offline, a record stripped of its repository fails', control, {
  args: ['--check'], evidence: withPypi({ repository: undefined }), expect: { code: 1, matches: [/names no owning repository/] },
})
const pypiRecord = (change) => ({ ...recordFor('https://pypi.org/project/demo-good/'), ...change })
const inDirectory = [entry('demo-good', { ...pypi('demo-good'), path: 'pkg' })]
const treeRecord = { ...source, url: 'https://github.com/demo/demo/tree/master/pkg' }
await verify('offline, a record edited to another directory fails', inDirectory, {
  args: ['--check'], evidence: { ...good, destinations: [pypiRecord({ directory: 'other' }), treeRecord] },
  expect: { code: 1, matches: [/reports the directory other, but demo:demo-good live in pkg/] },
})
await verify('offline, a record in the directory the entry names passes', inDirectory, {
  args: ['--check'], evidence: { ...good, destinations: [pypiRecord({ directory: 'pkg' }), treeRecord] },
  expect: { code: 0, matches: [/agrees with the inventory/] },
})
await verify('offline, a version the host lacks fails', control, {
  args: ['--check'], evidence: withPypi({ versionChecks: check1('0.0.1', 'absent') }), expect: { code: 1, matches: [/does not carry 0\.0\.1, the version demo\/demo:m declares for demo/] },
})
await verify('offline, a host that lists versions declining to confirm one fails', library, {
  args: ['--check'], manifests: manifestFor([['demo-good', '1.0.0']]), evidence: withPypi({ versionChecks: check1('1.0.0', 'unsupported', { note: 'skipped' }) }),
  expect: { code: 1, matches: [/could not confirm 1\.0\.0 on pypi, which lists versions/] },
})
await verify('offline, evidence checked for another version than the manifest declares fails', library, {
  args: ['--check'], manifests: manifestFor([['demo-good', '3.0.0']]), evidence: withPypi({ versionChecks: check1('1.0.0', 'confirmed') }),
  expect: { code: 1, matches: [/was checked for 1\.0\.0 but the manifests now declare 3\.0\.0/] },
})
await verify('offline, evidence that checked one port’s release but not the other’s fails', twin, {
  args: ['--check'], manifests: pins('1.0.0', '2.0.0'), evidence: { ...good, destinations: [source, { ...recordFor('https://pypi.org/project/demo-good/'), url: 'https://pypi.org/project/demo-twin/', versionChecks: check1('1.0.0', 'confirmed') }] },
  expect: { code: 1, matches: [/was checked for 1\.0\.0 but the manifests now declare 1\.0\.0, 2\.0\.0/] },
})

// Age is a warning wherever a change that touches none of this might run it, and a failure only where a live run is the remedy.
await verify('offline, fresh evidence passes without a warning', control, {
  args: ['--check', '--today', '2026-03-01'], evidence: good, expect: { code: 0, matches: [/agrees with the inventory/], excludes: [/warning/] },
})
await verify('offline, evidence older than the bound prints a warning with its date and still passes', control, {
  args: ['--check', '--today', '2026-06-01'], evidence: good,
  expect: { code: 0, matches: [/warning: \d+ destination records? (?:was|were) last checked 2026-01-01, more than 60 days ago: run node scripts\/verify-destinations\.mjs/, /agrees with the inventory/] },
})
await verify('offline, under GitHub Actions the warning is an annotation', control, {
  args: ['--check', '--today', '2026-06-01'], evidence: good, env: { GITHUB_ACTIONS: 'true' },
  expect: { code: 0, matches: [/^::warning title=Stale destination evidence::\d+ destination records? (?:was|were) last checked 2026-01-01/m], excludes: [/^warning:/m] },
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

// A date in the future was not a day that had happened, and a day's tolerance covers a clock a little behind.
const dated = (date) => ({ ...good, destinations: good.destinations.map((item) => ({ ...item, checkedAt: date })) })
for (const flags of [[], ['--fresh']]) {
  await verify(`offline${flags.length ? ' with --fresh' : ''}, evidence dated further ahead than the tolerance fails`, control, {
    args: ['--check', ...flags], evidence: dated('2026-01-05'), expect: { code: 1, matches: [/was checked 2026-01-05, which is in the future/] },
  })
  await verify(`offline${flags.length ? ' with --fresh' : ''}, evidence dated a day ahead is tolerated`, control, {
    args: ['--check', ...flags], evidence: dated('2026-01-03'), expect: { code: 0, matches: [/agrees with the inventory/] },
  })
}
await verify('a live run refuses a date in the future', control, {
  args: ['--date', '2026-01-09'], expect: { code: 1, matches: [/--date: 2026-01-09 is in the future/], excludes: [/wrote /] },
})
await verify('a live run refuses a date that is not a day', control, {
  args: ['--date', '2026-13-45'], expect: { code: 1, matches: [/--date: 2026-13-45 is not a date/] },
})
await verify('a day that is not a date is refused as the day to measure from', control, {
  args: ['--check', '--today', 'yesterday'], evidence: good, expect: { code: 1, matches: [/--today: yesterday is not a date/] },
})

server.close()
rmSync(dir, { recursive: true, force: true })
if (failures > 0) {
  console.error(`${failures} case${failures === 1 ? '' : 's'} failed`)
  process.exit(1)
}
