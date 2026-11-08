// Audits all generated destinations; small address and HTML fixtures remain in medium.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { collectApiDestinations, EXTERNAL_INVENTORIES } from '../../scripts/lib/api-destinations.mjs'
import { checkApiEvidence, INVENTORY_SOURCES, inventoryDigest, needsCheck, UNVERIFIABLE_REASONS } from '../../scripts/lib/api-destination-verification.mjs'
import evidence from '../src/data/api-destination-evidence.json'

const root = new URL('../../', import.meta.url).pathname
const destinations = collectApiDestinations({ root })
const today = new Date(`${evidence.checkedAt}T12:00:00Z`)

describe('API destination evidence', () => {
  it('records the heading a link was read at, never the name of the book or site the page belongs to', () => {
    // "Associated items - The Rust Reference" is headed "Associated items": a record that kept "The Rust Reference" could not see a page move.
    // A name that ends the titles of three pages of one host is the host's book, not any page's.
    const records = evidence.destinations as { url: string; host: string; title?: string; heading?: string }[]
    const parts = (record: { title?: string }) => (record.title ?? '').split(/\s+[-|\u2013\u2014]\s+/).map((part) => part.trim().toLowerCase()).filter(Boolean)
    const seen = new Map<string, Set<string>>()
    for (const record of records) for (const part of new Set(parts(record))) seen.set(`${record.host}\0${part}`, new Set([...(seen.get(`${record.host}\0${part}`) ?? []), record.url.split('#')[0]]))
    const books = new Set([...seen].filter(([, pages]) => pages.size >= 3).map(([key]) => key))
    for (const record of records) {
      if (record.heading === undefined) continue
      expect(books.has(`${record.host}\0${record.heading.toLowerCase()}`), `${record.url} records ${JSON.stringify(record.heading)}`).toBe(false)
    }
    expect([...books].some((key) => key.endsWith('\0the rust reference'))).toBe(true)
  })

  it('holds a passing record for every destination the site generates, and none for a link nothing makes', () => {
    const { problems } = checkApiEvidence(destinations, evidence, { today, root })
    expect(problems).toEqual([])
    expect(Object.keys(destinations.get('https://docs.rs/tmux-mcp')?.uses.values().next().value.package ?? {})).toEqual(['identity', 'ports'])
  })

  it('never records an unreadable host as passing', () => {
    for (const record of evidence.destinations as { url: string; ok: boolean; unverifiable?: string; failure?: string; detail?: string }[]) {
      if (record.unverifiable) {
        expect(record.ok, record.url).toBe(false)
        expect(UNVERIFIABLE_REASONS.some((reason) => reason.test(record.unverifiable!)), `${record.url}: ${record.unverifiable}`).toBe(true)
      } else if (!record.ok) {
        expect(record.failure, record.url).toBeTruthy()
        expect(record.detail, record.url).toBeTruthy()
      }
    }
  })

  it('requires a page that answers 200 at its own address, and a verdict for each name', () => {
    for (const record of evidence.destinations as { url: string; ok: boolean; status: number; finalUrl?: string; checkedAt: string; terminal?: { symbol: string; at: string }[] }[]) {
      expect(record.url, 'https url').toMatch(/^https:\/\//)
      expect(record.checkedAt, record.url).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      if (!record.ok) continue
      expect(record.status, record.url).toBe(200)
      expect(record.finalUrl, `${record.url} is a redirect`).toBeUndefined()
      const destination = destinations.get(record.url)
      if (!destination) continue
      expect(needsCheck(destination, record), record.url).toBe(false)
    }
  })

  it('names every cached inventory, each checked against its host and still holding the entries it was checked with', () => {
    expect(evidence.inventories.map((record) => record.name).sort()).toEqual(Object.keys(INVENTORY_SOURCES).sort())
    for (const record of evidence.inventories as { name: string; ok: boolean; missing: number; digest: string }[]) {
      expect(record.ok, record.name).toBe(true)
      expect(record.missing, record.name).toBe(0)
      const entries = JSON.parse(readFileSync(new URL(`../src/data/inventories/${record.name}.entries.json`, import.meta.url), 'utf8')).e as [string, string][]
      expect(record.digest, record.name).toBe(inventoryDigest(entries))
    }
  })

  it('keeps a manual\'s own labels out of the inventories, so a name never means one', () => {
    for (const name of ['python', 'julia']) {
      const { e } = JSON.parse(readFileSync(new URL(`../src/data/inventories/${name}.entries.json`, import.meta.url), 'utf8')) as { e: [string, string][] }
      const names = new Set(e.map(([entry]) => entry))
      for (const label of name === 'python' ? ['search', 'default', 'genindex', 'modindex'] : ['index', 'Level-6']) expect(names.has(label), `${name}: ${label}`).toBe(false)
    }
  })

  it('holds one record for each address', () => {
    const urls = (evidence.destinations as { url: string }[]).map((record) => record.url)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('lists the same inventories the reference and the prose linker attach', () => {
    for (const file of ['src/lib/api-models.ts', 'src/lib/prose-resolver.ts']) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
      for (const { baseUrl, langs } of EXTERNAL_INVENTORIES) {
        const attached = new RegExp(`baseUrl: '${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}',\\s*langs: \\[([^\\]]*)\\]`).exec(source)
          ?? new RegExp(`langs: \\[([^\\]]*)\\][^}]*baseUrl: '${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`).exec(source)
          ?? new RegExp(`baseUrl: '${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'[^}]*langs: \\[([^\\]]*)\\]`).exec(source)
        expect(attached, `${file} attaches ${baseUrl}`).not.toBeNull()
        expect([...attached![1]!.matchAll(/'(\w+)'/g)].map(([, lang]) => lang), `${file} ${baseUrl}`).toEqual(langs)
      }
    }
  })
})
