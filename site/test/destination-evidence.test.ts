import { describe, expect, it } from 'vitest'
import {
  EVIDENCE_MAX_AGE_DAYS, REPOSITORY_HOSTS, VERSION_SUPPORT, checkEvidence, collectDestinations, repoOf,
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
      const record = records.get(url) as Evidence & { versionCheck?: string; versionNote?: string; expectedVersion?: string }
      if (!record.ok || !destination.entries.some(({ status }: { status: string }) => status === 'published')) continue
      expect(record.versionCheck, url).toMatch(/^(?:confirmed|unsupported)$/)
      if (record.versionCheck === 'confirmed') {
        counts.confirmed += 1
        expect(record.expectedVersion, url).toBe(destination.expectedVersion)
      } else {
        counts.unsupported += 1
        expect(record.versionNote, `${url} says why`).toBeTruthy()
        // Only a branch link may decline: every registry and reference host here can say whether a version exists.
        expect(VERSION_SUPPORT[destination.host as keyof typeof VERSION_SUPPORT], url).toBe(false)
        expect(destination.kinds).toEqual(['source'])
      }
    }
    // Every package and reference page is confirmed; every source link names a branch.
    const nonSource = [...wanted.values()].filter((destination) => !destination.kinds.every((kind: string) => kind === 'source') && destination.entries.some(({ status }: { status: string }) => status === 'published'))
    expect(counts.confirmed).toBe(nonSource.length)
    expect(counts.unsupported).toBeGreaterThan(0)
  })

  it('checks a Go module against its own tag series and a package against the module that holds it', () => {
    const version = (url: string) => (records.get(url) as { expectedVersion?: string }).expectedVersion
    const manifest = (name: string) => manifests.ports.go.distributions.find((entry) => entry.name === name)!.version
    expect(version('https://pkg.go.dev/github.com/libtmux/libtmux-go/mcp')).toBe(manifest('github.com/libtmux/libtmux-go/mcp'))
    expect(version('https://pkg.go.dev/github.com/libtmux/libtmux-go/mcp/cmd/libtmux-mcp')).toBe(manifest('github.com/libtmux/libtmux-go/mcp'))
    expect(version('https://pkg.go.dev/github.com/libtmux/libtmux-go/tmuxq')).toBe(manifest('github.com/libtmux/libtmux-go'))
    // The series differ, so a package of one module is not checked against another's.
    expect(manifest('github.com/libtmux/libtmux-go/mcp')).not.toBe(manifest('github.com/libtmux/libtmux-go'))
  })

  it('takes each version from the manifests, not the registry snapshot that trails the hosts', () => {
    const version = (url: string) => (records.get(url) as { expectedVersion?: string; version?: string }).expectedVersion
    expect(version('https://crates.io/crates/tmux-mcp')).toBe(manifests.ports.rs.distributions.find((entry) => entry.name === 'tmux-mcp')!.version)
    expect(version('https://www.nuget.org/packages/LibTmux')).toBe(manifests.ports.csharp.distributions.find((entry) => entry.name === 'LibTmux')!.version)
    expect(version('https://central.sonatype.com/artifact/io.github.libtmux/libtmux')).toBe('0.0.1-alpha.17')
    // Every one is a version the host carries, though not necessarily the newest.
    for (const record of evidence.destinations) {
      if ((record as { versionCheck?: string }).versionCheck === 'confirmed') expect(record.ok, record.url).toBe(true)
    }
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

  describe('recency', () => {
    const checked = new Date(`${evidence.checkedAt}T12:00:00Z`)
    it('is fresh when checked within the bound and stale after it', () => {
      expect(checkEvidence(INVENTORY, evidence, { manifests, today: new Date(checked.getTime() + (EVIDENCE_MAX_AGE_DAYS - 1) * DAY) })).toEqual([])
      const stale = checkEvidence(INVENTORY, evidence, { manifests, today: new Date(checked.getTime() + (EVIDENCE_MAX_AGE_DAYS + 2) * DAY) })
      expect(stale.length).toBeGreaterThan(0)
      expect(stale[0]).toMatch(new RegExp(`was checked ${evidence.checkedAt}, more than ${EVIDENCE_MAX_AGE_DAYS} days ago`))
    })

    it('is measured by each record, not only the file', () => {
      const old = new Date(checked.getTime() - (EVIDENCE_MAX_AGE_DAYS + 5) * DAY).toISOString().slice(0, 10)
      const [first, ...rest] = evidence.destinations
      expect(checkEvidence(INVENTORY, withEvidence([{ ...first, checkedAt: old }, ...rest]), { manifests, today: checked }))
        .toEqual([`${first!.url} was checked ${old}, more than ${EVIDENCE_MAX_AGE_DAYS} days ago`])
    })
  })

  describe('against the inventory', () => {
    const clean = demo({})
    const url = 'https://github.com/libtmux/libtmux-rs'
    const today = new Date('2026-02-01T12:00:00Z')
    const record = {
      url, kinds: ['source'], host: 'github', ok: true, status: 200, identity: 'libtmux/libtmux-rs', checkedAt: '2026-01-15',
      versionCheck: 'unsupported', versionNote: 'a branch link names no release', entries: ['demo:demo'],
    }
    const good = withEvidence([record])
    const check = (data: ReturnType<typeof withEvidence>, inventory = clean) => checkEvidence(inventory, data, { manifests, today })

    it('passes when every linked destination has a passing record', () => {
      expect(check(good)).toEqual([])
    })

    it('fails when a linked destination has no record, a failing record or no word about its version', () => {
      expect(check(withEvidence([]))).toEqual([`${url} has no evidence (demo:demo)`])
      expect(check(withEvidence([{ ...record, ok: false, failure: 'status', detail: '404' }])))
        .toEqual([`${url} is linked by demo:demo but failed verification: status, 404`])
      const { versionCheck: _check, versionNote: _note, ...silent } = record
      expect(check(withEvidence([silent]))).toEqual([`${url} says nothing of its version; record why a host cannot confirm one`])
    })

    it('fails when the host lacks the version the manifest declares', () => {
      expect(check(withEvidence([{ ...record, expectedVersion: '9.9.9', versionSource: 'x:Cargo.toml', versionCheck: 'absent' }])).join('\n'))
        .toMatch(/does not carry 9\.9\.9, the version x:Cargo\.toml declares/)
    })

    it('fails when a host that lists versions declines to confirm one', () => {
      const registry = demo({ package: { host: 'crates', url: 'https://crates.io/crates/demo' }, coordinate: 'demo' })
      const manifest = { ports: { demo: { distributions: [{ name: 'demo', version: '1.0.0', repo: 'libtmux/libtmux-rs', manifest: 'Cargo.toml' }] } } }
      const crates = { url: 'https://crates.io/crates/demo', kinds: ['package'], host: 'crates', ok: true, status: 200, identity: 'demo', repository: 'libtmux/libtmux-rs', checkedAt: '2026-01-15', entries: ['demo:demo'] }
      const confirmed = { ...crates, expectedVersion: '1.0.0', versionSource: 'libtmux/libtmux-rs:Cargo.toml', versionCheck: 'confirmed' }
      const declined = { ...crates, expectedVersion: '1.0.0', versionSource: 'libtmux/libtmux-rs:Cargo.toml', versionCheck: 'unsupported', versionNote: 'skipped' }
      const run = (records: object[], manifestData = manifest) => checkEvidence(registry, withEvidence([record, ...records]), { manifests: manifestData, today })
      expect(run([confirmed])).toEqual([])
      expect(run([declined]).join('\n')).toMatch(/could not confirm 1\.0\.0 on crates, which lists versions/)
      // The version checked must be the one the manifests declare now.
      expect(run([confirmed], { ports: { demo: { distributions: [{ name: 'demo', version: '2.0.0', repo: 'libtmux/libtmux-rs', manifest: 'Cargo.toml' }] } } }).join('\n'))
        .toMatch(/was checked for 1\.0\.0 but the manifests now declare 2\.0\.0/)
      // A registry must name the repository it holds the package for.
      const { repository: _repository, ...anonymous } = confirmed
      expect(run([anonymous]).join('\n')).toMatch(/names no owning repository/)
    })

    it('fails on a record no entry names', () => {
      expect(check(withEvidence([record, { ...record, url: 'https://github.com/libtmux/orphan' }])))
        .toEqual(['https://github.com/libtmux/orphan has evidence but no entry names it'])
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
