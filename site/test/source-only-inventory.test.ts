import { describe, expect, it } from 'vitest'
import { collectDestinations, inventoryCoverage } from '../../scripts/lib/destination-verification.mjs'
import { portHeaderLinks } from '../src/lib/header-links'
import { INVENTORY, type InventoryEntry } from '../src/lib/port-inventory'
import { PORT_BY_SLUG } from '../src/lib/ports'

const library: InventoryEntry = {
  ...INVENTORY.perl![0]!, sourceAvailable: true,
  package: { host: 'npm', url: 'https://www.npmjs.com/package/unpublished-test' },
}

describe('source availability independent of registry publication', () => {
  it('offers verified source without a package-host or API publication claim', () => {
    const links = portHeaderLinks(PORT_BY_SLUG.perl!, { perl: [library] })
    expect(links.actions.map(({ kind }) => kind)).toEqual(['source'])
    expect(links.rows.map(({ kind }) => kind)).toEqual(['source'])
    expect(links.rows[0]?.url).toContain('/tree/master/packages/core')
  })
  it('verifies available source as present and the unpublished host as absent', () => {
    const records = collectDestinations({ perl: [library] }, {})
    expect([...records.values()].find(({ host }) => host === 'github')?.entries[0].status).toBe('published')
    expect(records.get(library.package!.url)?.entries[0].status).toBe('configured-unpublished')
    expect(inventoryCoverage({ perl: [library] }, ['perl'])).toEqual([])
    expect(inventoryCoverage({ perl: [{ ...library, sourceAvailable: false }] }, ['perl'])).not.toEqual([])
  })
})
