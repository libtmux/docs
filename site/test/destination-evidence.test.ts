import { describe, expect, it } from 'vitest'
import {
  EVIDENCE_MAX_AGE_DAYS, REPOSITORY_HOSTS, VERSION_SUPPORT, checkEvidence, collectDestinations, dateProblem, futureRecords, repoOf, staleRecords, staleWarnings,
} from '../../scripts/lib/destination-verification.mjs'
import evidence from '../src/data/destination-evidence.json'
import manifests from '../src/data/manifest-packages.json'
import { INVENTORY, entryDestinations, type InventoryEntry } from '../src/lib/port-inventory'

type Evidence = (typeof evidence.destinations)[number]
const records = new Map<string, Evidence>(evidence.destinations.map((record) => [record.url, record]))
const everyEntry = Object.entries(INVENTORY).flatMap(([port, list]) => list.map((entry) => ({ port, entry })))
const withEvidence = (destinations: object[]) => ({ ...evidence, destinations })
const wanted = collectDestinations(INVENTORY, manifests)
const demo = (fields: Partial<InventoryEntry>): Record<string, InventoryEntry[]> => ({
  demo: [{ id: 'demo', kind: 'library', product: 'core', label: 'demo', coordinate: 'demo', aliases: [], repo: 'libtmux/libtmux-rs', ref: 'master', status: 'published', ...fields }],
})
const DAY = 24 * 60 * 60 * 1000
type Check = { version?: string, source?: string, ports?: string[], check: string, note?: string }
/** What a record says about the versions it was asked for; a failing record was never asked. */
const checksOf = (url: string): Check[] => (records.get(url) as { versionChecks?: Check[] } | undefined)?.versionChecks ?? []
const versionsOf = (url: string) => checksOf(url).flatMap(({ version }) => (version ? [version] : []))

describe('destination evidence', () => {
  it('holds a passing record for every destination the inventory links', () => {
    expect(checkEvidence(INVENTORY, evidence, { manifests })).toEqual([])
    for (const { port, entry } of everyEntry.filter(({ entry }) => entry.status === 'published')) {
      for (const { url } of entryDestinations(entry)) {
        const record = records.get(url)
        expect(record?.ok, `${port}:${entry.id} ${url}`).toBe(true)
        expect(record?.status, url).toBe(200)
      }
    }
  })

  it('records the url, status, matched identity and date of each request', () => {
    expect(evidence.schema).toBe(1)
    for (const record of evidence.destinations) {
      expect(record.url, 'https url').toMatch(/^https:\/\//)
      expect(typeof record.ok).toBe('boolean')
      expect(record.kinds.length, record.url).toBeGreaterThan(0)
      expect(record.checkedAt, record.url).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(record.entries.length, record.url).toBeGreaterThan(0)
      if (record.ok) {
        expect(record.status, record.url).toBe(200)
        expect(record.identity, record.url).toBeTruthy()
      } else {
        expect(record.failure, record.url).toMatch(/^(?:status|identity|repository|unstable|unverifiable)$/)
        expect(record.detail, record.url).toBeTruthy()
      }
    }
    expect([...records.keys()]).toEqual([...records.keys()].sort((a, b) => a.localeCompare(b)))
  })

  it('shows each host naming the package in the URL, not a neighbour', () => {
    const identity = (url: string) => records.get(url)?.identity
    expect(identity('https://pypi.org/project/libtmux-mcp/')).toBe('libtmux-mcp')
    expect(identity('https://www.npmjs.com/package/@libtmux/workspace-cli')).toBe('@libtmux/workspace-cli')
    expect(identity('https://crates.io/crates/libtmux-macros')).toBe('libtmux-macros')
    expect(identity('https://central.sonatype.com/artifact/io.github.libtmux/libtmux-scala_3')).toBe('io.github.libtmux:libtmux-scala_3')
    expect(identity('https://www.nuget.org/packages/LibTmux.Workspace.Cli')).toBe('LibTmux.Workspace.Cli')
    expect(identity('https://pkg.go.dev/github.com/libtmux/libtmux-go/mcp/cmd/libtmux-mcp')).toBe('github.com/libtmux/libtmux-go/mcp/cmd/libtmux-mcp')
    expect(identity('https://github.com/libtmux/libtmux-java/tree/master/libtmux-kotlin')).toBe('libtmux/libtmux-java/libtmux-kotlin')
  })

  it('names the repository a registry reports, and it is one the owning entries live in', () => {
    for (const [url, destination] of wanted) {
      const record = records.get(url)!
      if (!record.ok || !REPOSITORY_HOSTS.has(destination.host)) continue
      expect(record.repository, url).toBeTruthy()
      expect(destination.repos.map((repo: string) => repo.toLowerCase()), url).toContain(record.repository)
    }
    // Registries that report a repository, one of each, with what they said.
    const repository = (url: string) => (records.get(url) as { repository?: string }).repository
    expect(repository('https://pypi.org/project/tmuxp/')).toBe('tmux-python/tmuxp')
    expect(repository('https://crates.io/crates/libtmux-macros')).toBe('libtmux/libtmux-rs')
    expect(repository('https://rubygems.org/gems/libtmux-async')).toBe('libtmux/libtmux-ruby')
    expect(repository('https://www.nuget.org/packages/LibTmux.Mcp')).toBe('libtmux/libtmux-dotnet')
    expect(repository('https://www.powershellgallery.com/packages/LibTmux.Workspace')).toBe('libtmux/libtmux-powershell')
    expect(repository('https://luarocks.org/modules/tony/libtmux')).toBe('libtmux/libtmux-lua')
    expect(repository('https://central.sonatype.com/artifact/io.github.libtmux/libtmux-workspace-cli')).toBe('libtmux/libtmux-java')
    expect(repository('https://www.npmjs.com/package/@libtmux/workspace-cli')).toBe('libtmux/libtmux-ts')
    expect(records.get('https://www.npmjs.com/package/@libtmux/workspace-cli')).toMatchObject({ directory: 'packages/workspace-cli' })
  })

  it('reads a repository from the forms registries write', () => {
    expect(repoOf('git+https://github.com/libtmux/libtmux-ts.git')).toBe('libtmux/libtmux-ts')
    expect(repoOf('scm:git:https://github.com/libtmux/libtmux-java.git')).toBe('libtmux/libtmux-java')
    expect(repoOf('https://github.com/tmux-python/tmuxp/issues')).toBe('tmux-python/tmuxp')
    expect(repoOf('https://github.com/libtmux/libtmux-ts/tree/master/packages/libtmux#readme')).toBe('libtmux/libtmux-ts')
    expect(repoOf('git@github.com:Libtmux/Libtmux-Go.git')).toBe('libtmux/libtmux-go')
    expect(repoOf('https://libtmux.git-pull.com')).toBeUndefined()
  })

  it('checks the manifest version on every host that lists versions, and says why where one cannot', () => {
    const counts = { confirmed: 0, unsupported: 0 }
    for (const [url, destination] of wanted) {
      const record = records.get(url)!
      if (!record.ok || !destination.entries.some(({ status }: { status: string }) => status === 'published')) continue
      expect(checksOf(url).length, url).toBeGreaterThan(0)
      if (destination.kinds.every((kind: string) => kind === 'source')) {
        // Only a branch link may decline: every registry and reference host here can say whether a version exists.
        expect(VERSION_SUPPORT[destination.host as keyof typeof VERSION_SUPPORT], url).toBe(false)
        for (const check of checksOf(url)) {
          expect(check.check, url).toBe('unsupported')
          expect(check.note, `${url} says why`).toBeTruthy()
        }
        counts.unsupported += 1
      } else {
        expect(versionsOf(url), url).toEqual(destination.expected.map(({ version }: { version: string }) => version))
        for (const check of checksOf(url)) expect(check.check, url).toBe('confirmed')
        counts.confirmed += 1
      }
    }
    // Every package and reference page is confirmed; every source link names a branch.
    const nonSource = [...wanted.values()].filter((destination) => !destination.kinds.every((kind: string) => kind === 'source') && destination.entries.some(({ status }: { status: string }) => status === 'published'))
    expect(counts.confirmed).toBe(nonSource.length)
    expect(counts.unsupported).toBeGreaterThan(0)
  })

  it('checks a Go module against its own tag series and a package against the module that holds it', () => {
    const manifest = (name: string) => manifests.ports.go.distributions.find((entry) => entry.name === name)!.version
    expect(versionsOf('https://pkg.go.dev/github.com/libtmux/libtmux-go/mcp')).toEqual([manifest('github.com/libtmux/libtmux-go/mcp')])
    expect(versionsOf('https://pkg.go.dev/github.com/libtmux/libtmux-go/mcp/cmd/libtmux-mcp')).toEqual([manifest('github.com/libtmux/libtmux-go/mcp')])
    expect(versionsOf('https://pkg.go.dev/github.com/libtmux/libtmux-go/tmuxq')).toEqual([manifest('github.com/libtmux/libtmux-go')])
    // The series differ, so a package of one module is not checked against another's.
    expect(manifest('github.com/libtmux/libtmux-go/mcp')).not.toBe(manifest('github.com/libtmux/libtmux-go'))
  })

  it('takes each version from the manifests, not the registry snapshot that trails the hosts', () => {
    expect(versionsOf('https://crates.io/crates/tmux-mcp')).toEqual([manifests.ports.rs.distributions.find((entry) => entry.name === 'tmux-mcp')!.version])
    expect(versionsOf('https://central.sonatype.com/artifact/io.github.libtmux/libtmux')).toEqual(['0.0.1-alpha.17'])
    // Every one is a version the host carries, though not necessarily the newest.
    for (const record of evidence.destinations) {
      if (checksOf(record.url).some(({ check }) => check === 'confirmed')) expect(record.ok, record.url).toBe(true)
    }
  })

  it('checks the version each owning port pins on a package page that several ports share', () => {
    const pin = (port: 'csharp' | 'fsharp', name: string) => manifests.ports[port].distributions.find((entry) => entry.name === name)!.version
    // C# and F# release LibTmux and LibTmux.FSharp separately, so one page answers for two pins.
    expect(pin('csharp', 'LibTmux')).not.toBe(pin('fsharp', 'LibTmux'))
    const shared = checksOf('https://www.nuget.org/packages/LibTmux')
    expect(shared.map(({ version, ports, check }) => ({ version, ports, check }))).toEqual([
      { version: pin('fsharp', 'LibTmux'), ports: ['fsharp'], check: 'confirmed' },
      { version: pin('csharp', 'LibTmux'), ports: ['csharp'], check: 'confirmed' },
    ].sort((a, b) => a.version.localeCompare(b.version)))
    // Wherever two ports pin the same release, one check names them both.
    const central = checksOf('https://central.sonatype.com/artifact/io.github.libtmux/libtmux')
    expect(central).toHaveLength(1)
    expect(central[0]!.ports).toEqual(['java', 'kotlin', 'scala'])
  })

  it('keeps a destination that a host does not serve on record as failing', () => {
    for (const url of ['https://luarocks.org/modules/tony/libtmux-mcp', 'https://javadoc.io/doc/io.github.libtmux/libtmux-bom',
      'https://javadoc.io/doc/io.github.libtmux/libtmux-workspace-cli', 'https://vcpkg.io/en/package/libtmux', 'https://conan.io/center/recipes/libtmux']) {
      expect(records.get(url)?.ok, url).toBe(false)
    }
    // javadoc.io answers 200 with a version list, which is why status alone proves nothing.
    expect(records.get('https://javadoc.io/doc/io.github.libtmux/libtmux-bom')).toMatchObject({ status: 200, failure: 'identity' })
    expect(records.get('https://luarocks.org/modules/tony/libtmux-mcp')).toMatchObject({ status: 404, failure: 'status' })
  })

  it('takes several requests of javadoc.io before calling it stable', () => {
    const javadoc = evidence.destinations.filter((record) => record.host === 'javadoc-io' && record.ok)
    expect(javadoc.length).toBeGreaterThan(0)
    for (const record of javadoc) expect(record.samples, record.url).toBeGreaterThanOrEqual(3)
  })

  describe('age', () => {
    const checked = new Date(`${evidence.checkedAt}T12:00:00Z`)
    const later = (days: number) => new Date(checked.getTime() + days * DAY)

    it('is measured, never judged, by the agreement check, so a change that touches none of this cannot fail for the passage of time', () => {
      const ancient = withEvidence(evidence.destinations.map((record) => ({ ...record, checkedAt: '2001-01-01' })))
      expect(checkEvidence(INVENTORY, ancient, { manifests })).toEqual([])
      // Control: the same evidence is stale by the measure that exists for it.
      expect(staleRecords(ancient, { today: checked })).toHaveLength(evidence.destinations.length)
    })

    it('reports a record as stale only after the bound, oldest first, with its date', () => {
      expect(staleRecords(evidence, { today: later(EVIDENCE_MAX_AGE_DAYS) })).toEqual([])
      const stale = staleRecords(evidence, { today: later(EVIDENCE_MAX_AGE_DAYS + 2) })
      expect(stale).toHaveLength(evidence.destinations.length)
      expect(stale[0]).toMatchObject({ checkedAt: evidence.checkedAt, days: EVIDENCE_MAX_AGE_DAYS + 2 })
      const old = new Date(checked.getTime() - (EVIDENCE_MAX_AGE_DAYS + 5) * DAY).toISOString().slice(0, 10)
      const [first, ...rest] = evidence.destinations
      expect(staleRecords(withEvidence([{ ...first, checkedAt: old }, ...rest]), { today: checked }))
        .toEqual([{ url: first!.url, checkedAt: old, days: EVIDENCE_MAX_AGE_DAYS + 5 }])
    })

    it('words a warning with the date and the command that clears it', () => {
      const stale = staleRecords(evidence, { today: later(EVIDENCE_MAX_AGE_DAYS + 2) })
      expect(staleWarnings(stale)).toEqual([`${evidence.destinations.length} destination records were last checked ${evidence.checkedAt}, more than ${EVIDENCE_MAX_AGE_DAYS} days ago: run node scripts/verify-destinations.mjs`])
      expect(staleWarnings(stale.slice(0, 1))[0]).toMatch(/^1 destination record was last checked/)
    })

    it('requires a check date on every record, whatever its age', () => {
      const [first, ...rest] = evidence.destinations
      expect(checkEvidence(INVENTORY, withEvidence([{ ...first, checkedAt: undefined }, ...rest]), { manifests }))
        .toEqual([`${first!.url} has no valid check date (none)`])
    })

    it('warns when the committed evidence is old, one line for each date, and does not fail', () => {
      const stale = staleRecords(evidence)
      const lines = staleWarnings(stale)
      for (const line of lines) console.warn(`warning: ${line}`)
      expect(lines).toHaveLength(new Set(stale.map(({ checkedAt }: { checkedAt: string }) => checkedAt)).size)
      for (const { checkedAt } of stale as { checkedAt: string }[]) expect(lines.join('\n'), checkedAt).toContain(checkedAt)
      expect(checkEvidence(INVENTORY, evidence, { manifests })).toEqual([])
    })

    describe('in the future', () => {
      it('is not where any committed record is dated', () => {
        expect(futureRecords(evidence)).toEqual([])
        expect(dateProblem(evidence.checkedAt, new Date())).toBeUndefined()
      })

      it('names every record dated beyond a day ahead of today, and fails the agreement check on it', () => {
        expect(futureRecords(evidence, { today: new Date(checked.getTime() - DAY) })).toEqual([])
        const early = futureRecords(evidence, { today: new Date(checked.getTime() - 3 * DAY) })
        expect(early).toHaveLength(evidence.destinations.length)
        expect(early[0]).toMatchObject({ checkedAt: evidence.checkedAt })
        expect(checkEvidence(INVENTORY, evidence, { manifests, today: checked })).toEqual([])
        expect(checkEvidence(INVENTORY, evidence, { manifests, today: new Date(checked.getTime() - 3 * DAY) }))
          .toContain(`${evidence.destinations[0]!.url} was checked ${evidence.checkedAt}, which is in the future`)
      })

      it('refuses a date that is not a day or has not happened, and leaves one that has', () => {
        const today = new Date('2026-02-01T12:00:00Z')
        expect(dateProblem('2026-02-01', today)).toBeUndefined()
        expect(dateProblem('2026-02-02', today), 'a day ahead is tolerated').toBeUndefined()
        expect(dateProblem('2026-02-03', today)).toBe('2026-02-03 is in the future')
        expect(dateProblem('2026-02-03'), 'with nothing to measure from').toBeUndefined()
        for (const date of ['2026-13-45', '2026-02-30', 'yesterday', '2026-2-1', '']) expect(dateProblem(date), date).toBe(`${date} is not a date (YYYY-MM-DD)`)
      })
    })
  })

  describe('against the inventory', () => {
    const clean = demo({})
    const url = 'https://github.com/libtmux/libtmux-rs'
    const record = {
      url, kinds: ['source'], host: 'github', ok: true, status: 200, identity: 'libtmux/libtmux-rs', checkedAt: '2026-01-15',
      versionChecks: [{ check: 'unsupported', note: 'a branch link names no release' }], entries: ['demo:demo'],
    }
    const good = withEvidence([record])
    const check = (data: ReturnType<typeof withEvidence>, inventory = clean) => checkEvidence(inventory, data, { manifests })
    const crates: Partial<InventoryEntry> = { package: { host: 'crates', url: 'https://crates.io/crates/demo' }, coordinate: 'demo' }
    const distribution = (version: string, name = 'demo') => ({ distributions: [{ name, version, repo: 'libtmux/libtmux-rs', manifest: 'Cargo.toml' }] })
    const pin = (version: string, ports: string[]) => ({ version, source: 'libtmux/libtmux-rs:Cargo.toml', ports, check: 'confirmed' })
    /** A clean evidence set for an inventory, each destination answering as its host should; `overrides` plants one fault by url. */
    function passing(inventory: Record<string, InventoryEntry[]>, manifestData: object, overrides: Record<string, object> = {}) {
      return withEvidence([...collectDestinations(inventory, manifestData).values()].map((destination) => ({
        url: destination.url, kinds: destination.kinds, host: destination.host, ok: true, status: 200, identity: 'demo', checkedAt: '2026-01-15',
        entries: destination.entries.map(({ port, id }: { port: string, id: string }) => `${port}:${id}`),
        ...(REPOSITORY_HOSTS.has(destination.host) && { repository: destination.repos[0]!.toLowerCase() }),
        versionChecks: destination.expected.length > 0
          ? destination.expected.map((expected: object) => ({ ...expected, check: 'confirmed' }))
          : [{ check: 'unsupported', note: 'a branch link names no release' }],
        ...overrides[destination.url],
      })))
    }

    it('passes when every linked destination has a passing record', () => {
      expect(check(good)).toEqual([])
    })

    it('fails when a linked destination has no record, a failing record or no word about its version', () => {
      expect(check(withEvidence([]))).toEqual([`${url} has no evidence (demo:demo)`])
      expect(check(withEvidence([{ ...record, ok: false, failure: 'status', detail: '404' }])))
        .toEqual([`${url} is linked by demo:demo but failed verification: status, 404`])
      const { versionChecks: _checks, ...silent } = record
      expect(check(withEvidence([silent]))).toEqual([`${url} says nothing of its version; record why a host cannot confirm one`])
    })

    it('fails when the host lacks the version the manifest declares', () => {
      const absent = { version: '9.9.9', source: 'x:Cargo.toml', ports: ['demo'], check: 'absent' }
      expect(check(withEvidence([{ ...record, versionChecks: [absent] }])).join('\n'))
        .toMatch(/does not carry 9\.9\.9, the version x:Cargo\.toml declares for demo/)
    })

    it('fails when a host that lists versions declines to confirm one', () => {
      const registry = demo(crates)
      const manifest = { ports: { demo: distribution('1.0.0') } }
      const page = { url: 'https://crates.io/crates/demo', kinds: ['package'], host: 'crates', ok: true, status: 200, identity: 'demo', repository: 'libtmux/libtmux-rs', checkedAt: '2026-01-15', entries: ['demo:demo'] }
      const confirmed = { ...page, versionChecks: [pin('1.0.0', ['demo'])] }
      const declined = { ...page, versionChecks: [{ ...pin('1.0.0', ['demo']), check: 'unsupported', note: 'skipped' }] }
      const run = (records: object[], manifestData = manifest) => checkEvidence(registry, withEvidence([record, ...records]), { manifests: manifestData })
      expect(run([confirmed])).toEqual([])
      expect(run([declined]).join('\n')).toMatch(/could not confirm 1\.0\.0 on crates, which lists versions/)
      // The version checked must be the one the manifests declare now.
      expect(run([confirmed], { ports: { demo: distribution('2.0.0') } }).join('\n'))
        .toMatch(/was checked for 1\.0\.0 but the manifests now declare 2\.0\.0/)
      // A registry must name the repository it holds the package for.
      const { repository: _repository, ...anonymous } = confirmed
      expect(run([anonymous]).join('\n')).toMatch(/names no owning repository/)
    })

    describe('where ports share a package page', () => {
      const inventory = { a: demo(crates).demo!, b: demo(crates).demo! }
      const manifest = { ports: { a: distribution('1.0.0'), b: distribution('2.0.0') } }
      const page = 'https://crates.io/crates/demo'
      const run = (overrides: Record<string, object> = {}) => checkEvidence(inventory, passing(inventory, manifest, overrides), { manifests: manifest })

      it('asks for a check of the release each port pins', () => {
        expect(collectDestinations(inventory, manifest).get(page)!.expected.map(({ version, ports }: { version: string, ports: string[] }) => ({ version, ports })))
          .toEqual([{ version: '1.0.0', ports: ['a'] }, { version: '2.0.0', ports: ['b'] }])
        expect(run(), 'a check of each').toEqual([])
      })

      it('fails when only one of the pins was checked', () => {
        expect(run({ [page]: { versionChecks: [pin('1.0.0', ['a'])] } }).join('\n'))
          .toMatch(/was checked for 1\.0\.0 but the manifests now declare 1\.0\.0, 2\.0\.0/)
        expect(run({ [page]: { versionChecks: [pin('2.0.0', ['b'])] } }).join('\n'))
          .toMatch(/was checked for 2\.0\.0 but the manifests now declare 1\.0\.0, 2\.0\.0/)
      })

      it('fails when the host lacks the release one port pins, naming that port', () => {
        expect(run({ [page]: { versionChecks: [pin('1.0.0', ['a']), { ...pin('2.0.0', ['b']), check: 'absent' }] } }))
          .toEqual([`${page} does not carry 2.0.0, the version libtmux/libtmux-rs:Cargo.toml declares for b`])
      })

      it('checks one release once when both ports pin it', () => {
        const same = { ports: { a: distribution('1.0.0'), b: distribution('1.0.0') } }
        expect(collectDestinations(inventory, same).get(page)!.expected).toHaveLength(1)
        expect(collectDestinations(inventory, same).get(page)!.expected[0]!.ports).toEqual(['a', 'b'])
      })
    })

    describe('where a registry names a repository or directory', () => {
      const manifest = { ports: { demo: distribution('1.0.0') } }
      const page = 'https://crates.io/crates/demo'
      const npm = demo({ package: { host: 'npm', url: 'https://www.npmjs.com/package/demo' }, coordinate: 'demo', path: 'packages/demo' })
      const npmPage = 'https://www.npmjs.com/package/demo'

      it('fails a repository none of the owning entries live in, and passes the one they do', () => {
        const inventory = demo(crates)
        expect(checkEvidence(inventory, passing(inventory, manifest), { manifests: manifest })).toEqual([])
        expect(checkEvidence(inventory, passing(inventory, manifest, { [page]: { repository: 'someone/else' } }), { manifests: manifest }))
          .toEqual([`${page} was verified against someone/else, but demo:demo live in libtmux/libtmux-rs`])
        expect(checkEvidence(inventory, passing(inventory, manifest, { [page]: { repository: undefined } }), { manifests: manifest }))
          .toEqual([`${page} names no owning repository`])
      })

      it('fails a package directory none of the owning entries live in, and passes the one they do', () => {
        const run = (overrides: object) => checkEvidence(npm, passing(npm, manifest, { [npmPage]: overrides }), { manifests: manifest })
        expect(run({ directory: 'packages/demo' })).toEqual([])
        expect(run({ directory: 'packages/other' })).toEqual([`${npmPage} reports the directory packages/other, but demo:demo live in packages/demo`])
        expect(run({}), 'a package that names no directory').toEqual([])
      })
    })

    describe('where an entry sits within another', () => {
      const entry = (id: string, within?: string): InventoryEntry => ({ ...demo({}).demo![0]!, id, coordinate: `demo-${id}`, package: { host: 'crates', url: `https://crates.io/crates/demo-${id}` }, ...(within && { within }) })
      const manifest = { ports: { demo: distribution('1.0.0', 'demo-b') } }

      it('takes the version of the distribution it ships in', () => {
        const found = collectDestinations({ demo: [entry('a', 'b'), entry('b')] }, manifest)
        expect(found.get('https://crates.io/crates/demo-a')!.expected).toEqual([{ version: '1.0.0', source: 'libtmux/libtmux-rs:Cargo.toml', ports: ['demo'] }])
        expect(found.get('https://crates.io/crates/demo-b')!.expected).toEqual([{ version: '1.0.0', source: 'libtmux/libtmux-rs:Cargo.toml', ports: ['demo'] }])
      })

      it('throws with the chain, and does not hang, when a within loops or names no entry', () => {
        expect(() => collectDestinations({ demo: [entry('a', 'b'), entry('b', 'a')] }, manifest)).toThrow('a -> b -> a: within leads back to a')
        expect(() => collectDestinations({ demo: [entry('a', 'a')] }, manifest)).toThrow('a -> a: within leads back to a')
        expect(() => collectDestinations({ demo: [entry('a', 'b'), entry('b', 'c'), entry('c', 'b')] }, manifest)).toThrow('a -> b -> c -> b: within leads back to b')
        expect(() => collectDestinations({ demo: [entry('a', 'missing')] }, manifest)).toThrow('a: within names missing, which is not an entry')
      })
    })

    it('fails on a record no entry names', () => {
      expect(check(withEvidence([record, { ...record, url: 'https://github.com/libtmux/orphan' }])))
        .toEqual(['https://github.com/libtmux/orphan has evidence but no entry names it'])
    })

    it('fails a record dated in the future, and passes the same record dated today', () => {
      const today = new Date('2026-02-01T12:00:00Z')
      const dated = (checkedAt: string) => checkEvidence(clean, withEvidence([{ ...record, checkedAt }]), { manifests, today })
      expect(dated('2026-02-01')).toEqual([])
      expect(dated('2026-02-02'), 'a day ahead is tolerated').toEqual([])
      expect(dated('2026-02-03')).toEqual([`${url} was checked 2026-02-03, which is in the future`])
    })

    it('expects an unpublished entry’s package page to fail, and says when it starts to pass', () => {
      const unpublished = demo({ status: 'configured-unpublished', note: 'not uploaded', package: { host: 'crates', url: 'https://crates.io/crates/demo' } })
      const absent = { url: 'https://crates.io/crates/demo', kinds: ['package'], host: 'crates', ok: false, status: 404, failure: 'status', detail: '404', checkedAt: '2026-01-15', entries: ['demo:demo'] }
      expect([...collectDestinations(unpublished, manifests).keys()], 'its unlinked source directory is not asked about').toEqual(['https://crates.io/crates/demo'])
      expect(check(withEvidence([absent]), unpublished)).toEqual([])
      expect(check(withEvidence([{ ...absent, ok: true, status: 200, identity: 'demo' }]), unpublished))
        .toEqual(['https://crates.io/crates/demo answers, so demo:demo can be published'])
    })
  })
})
