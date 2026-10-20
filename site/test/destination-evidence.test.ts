import { describe, expect, it } from 'vitest'
import { checkEvidence, collectDestinations } from '../../scripts/lib/destination-verification.mjs'
import evidence from '../src/data/destination-evidence.json'
import { INVENTORY, entryDestinations, type InventoryEntry } from '../src/lib/port-inventory'

type Evidence = (typeof evidence.destinations)[number]
const records = new Map<string, Evidence>(evidence.destinations.map((record) => [record.url, record]))
const everyEntry = Object.entries(INVENTORY).flatMap(([port, list]) => list.map((entry) => ({ port, entry })))
const withEvidence = (destinations: unknown[]) => ({ ...evidence, destinations })
const demo = (fields: Partial<InventoryEntry>): Record<string, InventoryEntry[]> => ({
  demo: [{ id: 'demo', kind: 'library', product: 'core', label: 'demo', coordinate: 'demo', aliases: [], repo: 'libtmux/libtmux-rs', ref: 'master', status: 'published', ...fields }],
})

describe('destination evidence', () => {
  it('holds a passing record for every destination the inventory links', () => {
    expect(checkEvidence(INVENTORY, evidence)).toEqual([])
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
        expect(record.failure, record.url).toMatch(/^(?:status|identity|unstable|unverifiable)$/)
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

  it('carries the registry snapshot’s version for each package that records one, and the host has it', () => {
    const checked = evidence.destinations.filter((record) => 'expectedVersion' in record)
    expect(checked.length).toBeGreaterThan(0)
    for (const record of checked) expect(record, record.url).toMatchObject({ versionFound: true })
  })

  describe('against the inventory', () => {
    const clean = demo({})
    const url = 'https://github.com/libtmux/libtmux-rs'
    const good = withEvidence([{ url, kinds: ['source'], host: 'github', ok: true, status: 200, identity: 'libtmux/libtmux-rs', checkedAt: '2026-01-01', entries: ['demo:demo'] }])

    it('passes when every linked destination has a passing record', () => {
      expect(checkEvidence(clean, good)).toEqual([])
    })

    it('fails when a linked destination has no record, a failing record, or the host lacks the snapshot version', () => {
      expect(checkEvidence(clean, withEvidence([]))).toEqual([`${url} has no evidence (demo:demo)`])
      expect(checkEvidence(clean, withEvidence([{ ...good.destinations[0], ok: false, failure: 'status', detail: '404' }])))
        .toEqual([`${url} is linked by demo:demo but failed verification: status, 404`])
      expect(checkEvidence(clean, withEvidence([{ ...good.destinations[0], expectedVersion: '9.9.9', versionFound: false }])))
        .toEqual([`${url} does not carry 9.9.9, the registry snapshot's version`])
    })

    it('fails on a record no entry names', () => {
      expect(checkEvidence(clean, withEvidence([...good.destinations, { ...good.destinations[0], url: 'https://github.com/libtmux/orphan' }])))
        .toEqual(['https://github.com/libtmux/orphan has evidence but no entry names it'])
    })

    it('expects an unpublished entry’s package page to fail, and says when it starts to pass', () => {
      const unpublished = demo({ status: 'configured-unpublished', note: 'not uploaded', package: { host: 'crates', url: 'https://crates.io/crates/demo' } })
      const absent = { url: 'https://crates.io/crates/demo', kinds: ['package'], host: 'crates', ok: false, status: 404, failure: 'status', detail: '404', checkedAt: '2026-01-01', entries: ['demo:demo'] }
      expect([...collectDestinations(unpublished).keys()], 'its unlinked source directory is not asked about').toEqual(['https://crates.io/crates/demo'])
      expect(checkEvidence(unpublished, withEvidence([absent]))).toEqual([])
      expect(checkEvidence(unpublished, withEvidence([{ ...absent, ok: true, status: 200, identity: 'demo' }])))
        .toEqual(['https://crates.io/crates/demo answers, so demo:demo can be published'])
    })
  })
})
