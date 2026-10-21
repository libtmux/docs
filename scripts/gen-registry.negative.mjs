#!/usr/bin/env node
/*
 * Proof that `gen-registry.mjs --check --offline` can still fail.
 *
 * Offline, the check re-emits the committed entries and compares the file with
 * that. A check that compared a file with itself would pass anything, so the
 * control is a copy of the committed file and each case edits its own copy:
 * a dropped port, a version edited by hand, and a file that is not what the
 * generator writes byte for byte. None of them touches the network, which is
 * the point of running the gate offline.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { PORTS, productAvailable, productStatus, releaseMaturity } from '../site/src/lib/ports.ts'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, 'gen-registry.mjs')
const real = join(here, '..', 'site/src/data/registry.json')

function run(file) {
  try {
    const out = execFileSync('node', [script, '--check', '--offline', '--out', file], { encoding: 'utf8', stdio: 'pipe' })
    return { code: 0, out }
  } catch (err) {
    return { code: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

/** A copy of the committed registry in a directory of its own. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'gen-registry-'))
  const file = join(dir, 'registry.json')
  copyFileSync(real, file)
  return { dir, file }
}

let failures = 0
const check = (name, ok, detail) => {
  if (ok) console.log(`ok   ${name}`)
  else {
    console.error(`FAIL ${name} — ${detail}`)
    failures += 1
  }
}

{
  const { dir, file } = fixture()
  const res = run(file)
  check('the committed registry passes', res.code === 0, `exit ${res.code}: ${res.out.trim()}`)
  rmSync(dir, { recursive: true, force: true })
}

const mutations = [
  ['a dropped port is caught', (s) => {
    const data = JSON.parse(s)
    delete data.ports.rs
    return `${JSON.stringify(data, null, 2)}\n`
  }],
  ['a hand-edited version is caught', (s) => s.replace(/("rs": \{\n\s+"status": "\w+",\n\s+"version": ")([^"]+)"/, '$10.0.0-edited"')],
  ['a file the generator would not write is caught', (s) => `${JSON.stringify(JSON.parse(s))}\n`],
]

for (const [name, mutate] of mutations) {
  const { dir, file } = fixture()
  const before = readFileSync(file, 'utf8')
  const after = mutate(before)
  if (after === before) {
    check(name, false, 'the mutation changed nothing — the fixture no longer has what it targets')
    rmSync(dir, { recursive: true, force: true })
    continue
  }
  writeFileSync(file, after)
  const res = run(file)
  check(name, res.code === 1 && /out of date/.test(res.out), `exit ${res.code}: ${res.out.trim()}`)
  rmSync(dir, { recursive: true, force: true })
}

// Run the real generator without local port checkouts or live network access.
// The published baseline predates the two ports added by the current source.
{
  const dir = mkdtempSync(join(tmpdir(), 'gen-registry-online-'))
  try {
    for (const path of ['scripts', 'site/src/lib', 'site/src/data']) mkdirSync(join(dir, path), { recursive: true })
    copyFileSync(script, join(dir, 'scripts/gen-registry.mjs'))
    copyFileSync(join(here, '../site/src/lib/versions.ts'), join(dir, 'site/src/lib/versions.ts'))
    copyFileSync(real, join(dir, 'site/src/data/registry.json'))
    const ports = PORTS.map(({ slug, repo, packageName, tagGrammar, tagPrefix }) => ({
      slug, repo, packageName, tagGrammar, tagPrefix, checkout: join(dir, 'absent', slug),
    }))
    writeFileSync(join(dir, 'site/src/lib/ports.ts'), `export const PORTS = ${JSON.stringify(ports)}\n`)
    const seed = JSON.parse(readFileSync(real, 'utf8'))
    const baseline = structuredClone(seed)
    delete baseline.ports.powershell
    delete baseline.ports.julia
    baseline.ports.csharp = { status: 'stable', version: '1.2.3', stable: '1.2.3', tag: 'v1.2.3' }
    writeFileSync(join(dir, 'published.json'), JSON.stringify(baseline))
    writeFileSync(join(dir, 'fetch.mjs'), `
      import { readFileSync } from 'node:fs'
      const responses = JSON.parse(readFileSync(new URL('./responses.json', import.meta.url)))
      globalThis.fetch = async (url) => {
        const reply = responses[String(url)]
        if (!reply) throw new Error('offline fixture: ' + url)
        return new Response(reply.body, { status: reply.status ?? 200 })
      }
    `)
    const gallery = (name) => `https://www.powershellgallery.com/api/v2/FindPackagesById()?id=%27${name}%27`
    const general = 'https://raw.githubusercontent.com/JuliaRegistries/General/master/L/LibTmux/Versions.toml'
    const core = gallery('LibTmux')
    const workspace = gallery('LibTmux.Workspace')
    const next = `${core}&$skip=1`
    const entry = (name, version, published = '2026-10-10T17:02:47.193') =>
      `<entry><m:properties><d:Id>${name}</d:Id><d:Version>${version}</d:Version><d:Published m:type="Edm.DateTime">${published}</d:Published></m:properties></entry>`
    const feed = (entries, more = '') => `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">${entries}${more}</feed>`
    const replies = {
      'https://api.github.com/repos/libtmux/libtmux-powershell/tags?per_page=100': {
        body: JSON.stringify(['v0.1.0-alpha2', 'v0.1.0-alpha3', 'v0.1.0-alpha4', 'v1.0.0'].map((name) => ({ name }))),
      },
      'https://api.github.com/repos/libtmux/libtmux-julia/tags?per_page=100': {
        body: JSON.stringify(['v0.1.0-alpha.1', 'v0.1.0', 'v0.2.0'].map((name) => ({ name }))),
      },
      [core]: { body: feed(entry('LibTmux', '0.1.0-alpha2'), `<link href="${next.replaceAll('&', '&amp;')}" rel="next" />`) },
      [next]: { body: feed(entry('LibTmux', '0.1.0-alpha3') + entry('LibTmux', '1.0.0', '1900-01-01T00:00:00')) },
      [workspace]: { body: feed(entry('LibTmux.Workspace', '0.1.0-alpha4')) },
      [general]: { body: `["0.1.0"]\ngit-tree-sha1 = "${'a'.repeat(40)}"\n\n["0.2.0"]\ngit-tree-sha1 = "${'b'.repeat(40)}"\nyanked = true # unavailable for new installs\n` },
    }
    const invoke = (responses, offline = false) => {
      writeFileSync(join(dir, 'responses.json'), JSON.stringify(responses))
      const out = join(dir, 'resolved.json')
      rmSync(out, { force: true })
      try {
        execFileSync(process.execPath, ['--import', join(dir, 'fetch.mjs'), join(dir, 'scripts/gen-registry.mjs'),
          '--baseline', join(dir, 'published.json'), '--out', out, ...(offline ? ['--offline'] : [])], { stdio: 'pipe' })
        return { ports: JSON.parse(readFileSync(out, 'utf8')).ports, error: '' }
      } catch (err) {
        return { ports: {}, error: `${err.stdout ?? ''}${err.stderr ?? ''}` }
      }
    }
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
    let result = invoke(replies)
    check('an older published registry gains both ports', Object.keys(result.ports).length === PORTS.length, result.error)
    check('Gallery pages refresh the core and workspace prereleases, excluding unlisted versions',
      result.ports.powershell?.version === '0.1.0-alpha3' && result.ports.powershell?.tag === 'v0.1.0-alpha3'
      && result.ports.powershell?.packages?.['LibTmux.Workspace']?.version === '0.1.0-alpha4', result.error)
    check('General excludes yanked versions and their tags',
      result.ports.julia?.version === '0.1.0' && result.ports.julia?.tag === 'v0.1.0', result.error)
    check('an unavailable existing port retains its newer published entry', same(result.ports.csharp, baseline.ports.csharp), result.error)

    // The baseline names a tag the repository never published. Tags the
    // repository still carries keep their recorded entry; tags it lacks do not.
    const staleJulia = { status: 'unpublished', version: null, stable: null, tag: 'v0.1.0-alpha.1' }
    writeFileSync(join(dir, 'published.json'), JSON.stringify({ ...baseline, ports: { ...baseline.ports, julia: staleJulia } }))
    const julia = 'https://api.github.com/repos/libtmux/libtmux-julia/tags?per_page=100'
    result = invoke({ ...replies, [julia]: { body: '[]' }, [general]: { status: 404, body: '404: Not Found' } })
    check('a recorded tag the repository lacks is dropped', result.ports.julia?.tag === null, `${JSON.stringify(result.ports.julia)} ${result.error}`)
    result = invoke({
      ...replies,
      [julia]: { body: JSON.stringify([{ name: 'v0.1.0-alpha.1' }, { name: 'v0.2.0' }]) },
      [general]: { body: `["0.1.0"]\ngit-tree-sha1 = "${'a'.repeat(40)}"\n` },
    })
    check('a recorded tag the repository carries survives until its package lands',
      result.ports.julia?.tag === 'v0.1.0-alpha.1', `${JSON.stringify(result.ports.julia)} ${result.error}`)
    writeFileSync(join(dir, 'published.json'), JSON.stringify(baseline))

    // The deploy builds from what the resolver wrote, and a badge that cannot read an entry fails that
    // build after the registry job has passed. Resolve each state Julia can be in, then read every
    // port's badges and packages from the result. An incomplete result is not a clean read.
    const unread = (resolved) => {
      const count = Object.keys(resolved.ports).length
      if (count !== PORTS.length) return [`the resolver wrote ${count} of ${PORTS.length} ports: ${resolved.error}`]
      const registry = { schema: 1, ports: resolved.ports }
      return PORTS.flatMap((port) => [
        ...['core', 'mcp', 'workspace'].filter((product) => product === 'core' || productAvailable(port, product))
          .map((product) => [`${port.slug} ${product}`, () => productStatus(port, product, registry)]),
        ...Object.entries(registry.ports[port.slug].packages ?? {})
          .map(([name, item]) => [`${port.slug} ${name}`, () => releaseMaturity(item)]),
      ].flatMap(([label, read]) => {
        try {
          read()
          return []
        } catch (err) {
          return [`${label}: ${err.message}`]
        }
      }))
    }
    const juliaPort = PORTS.find(({ slug }) => slug === 'julia')
    const tagged = (...names) => ({ body: JSON.stringify(names.map((name) => ({ name }))) })
    const notInGeneral = { status: 404, body: '404: Not Found' }
    const prereleaseOnly = { body: `["0.1.0-alpha.2"]\ngit-tree-sha1 = "${'c'.repeat(40)}"\n` }
    for (const [state, repository, registry, stage] of [
      ['a final tag General does not carry yet', ['v0.1.0'], notInGeneral, 'stable'],
      ['a prerelease tag General does not carry yet', ['v0.1.0-alpha.1'], notInGeneral, 'alpha'],
      ['a prerelease General carries', ['v0.1.0-alpha.2'], prereleaseOnly, 'alpha'],
      ['a prerelease General carries beside a final tag it lacks', ['v0.1.0-alpha.2', 'v0.1.0'], prereleaseOnly, 'alpha'],
      ['no tag and no General package', [], notInGeneral, 'unreleased'],
    ]) {
      result = invoke({ ...replies, [julia]: tagged(...repository), [general]: registry })
      const failures = unread(result)
      const read = failures.length === 0 ? productStatus(juliaPort, 'core', { schema: 1, ports: result.ports }) : undefined
      check(`every badge reads ${state} as ${stage}`, read === stage, `${read} ${JSON.stringify(failures)}`)
    }
    result = invoke({ ...replies, [julia]: tagged('v0.1.0'), [general]: notInGeneral })
    check('a final tag General does not carry yet is recorded as the live registry recorded it',
      same(result.ports.julia, { status: 'unpublished', version: null, stable: null, tag: 'v0.1.0' }), `${JSON.stringify(result.ports.julia)} ${result.error}`)
    // Once the registry lists a release, a newer tag it lacks is not recorded; the support page says so.
    result = invoke({ ...replies, [julia]: tagged('v0.1.0-alpha.2', 'v0.1.0'), [general]: prereleaseOnly })
    check('a final tag beside a registry that lists only a prerelease is not recorded',
      same(result.ports.julia, { status: 'prerelease', version: '0.1.0-alpha.2', stable: null, tag: 'v0.1.0-alpha.2' }), `${JSON.stringify(result.ports.julia)} ${result.error}`)

    // The reads above pass only if the read can fail, so name the port and the tag it could not place.
    result = invoke({ ...replies, [julia]: tagged('v0.1.0-dev.3'), [general]: notInGeneral })
    check('a tag whose marker no stage names is reported with its port and name',
      same(unread(result), ['julia core: releaseMaturity: no release stage in "v0.1.0-dev.3"']), `${JSON.stringify(unread(result))} ${result.error}`)
    check('an incomplete result is not read as clean', unread({ ports: { go: seed.ports.go }, error: '' }).length === 1, 'a one-port registry read as clean')

    result = invoke({ ...replies, [core]: { body: feed('') }, [workspace]: { body: feed('') }, [general]: { status: 404, body: '404: Not Found' } })
    check('empty Gallery feeds and a missing General package are unpublished',
      result.ports.powershell?.status === 'unpublished' && result.ports.julia?.status === 'unpublished', result.error)

    for (const status of [403, 429, 500]) {
      result = invoke({ ...replies, [core]: { status, body: 'unavailable' }, [general]: { status, body: 'unavailable' } })
      check(`HTTP ${status} preserves committed entries for ports absent from the published baseline`,
        same(result.ports.powershell, seed.ports.powershell) && same(result.ports.julia, seed.ports.julia), result.error)
    }
    result = invoke({ ...replies, [core]: { body: '<html>temporary outage</html>' }, [general]: { body: 'temporary outage' } })
    check('malformed registry responses preserve the committed entries',
      same(result.ports.powershell, seed.ports.powershell) && same(result.ports.julia, seed.ports.julia), result.error)
    result = invoke({ ...replies, [core]: { body: feed('<entry>incomplete') } })
    check('an incomplete Gallery entry is not an empty package feed', same(result.ports.powershell, seed.ports.powershell), result.error)
    result = invoke({ ...replies, [workspace]: { status: 500, body: 'unavailable' } })
    check('a failed sibling package probe does not publish a partial PowerShell entry', same(result.ports.powershell, seed.ports.powershell), result.error)
    result = invoke({}, true)
    check('offline refresh fills missing ports and preserves published entries',
      Object.keys(result.ports).length === PORTS.length && same(result.ports.powershell, seed.ports.powershell)
      && same(result.ports.julia, seed.ports.julia) && same(result.ports.csharp, baseline.ports.csharp), result.error)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (failures) {
  console.error(`\ngen-registry.negative: ${failures} case(s) did not behave as required.`)
  process.exit(1)
}
console.log('gen-registry.negative: offline freshness and registry refresh controls pass')
