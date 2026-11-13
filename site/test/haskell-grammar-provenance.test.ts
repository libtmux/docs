import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const dir = new URL('../src/vendor/haskell-grammar/', import.meta.url)
const read = (name: string) => readFileSync(new URL(name, dir))
const PROVENANCE = JSON.parse(read('provenance.json').toString())
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex')
/** Git's object id for file contents: what GitHub reports as the blob `sha` of the upstream path. */
const blobId = (data: Buffer) => createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex')

/** Where the vendored files differ from what `provenance.json` and the README say they are. */
function problems(file: (name: string) => Buffer, provenance: typeof PROVENANCE) {
  const found: string[] = []
  const grammar = file(provenance.asset)
  if (sha256(grammar) !== provenance.sha256) found.push('grammar digest')
  if (blobId(grammar) !== provenance.gitBlobSha1) found.push('grammar is not the upstream git object')
  if (sha256(file(provenance.derivedCopy.file)) !== provenance.derivedCopy.sha256) found.push('converted grammar digest')
  const license = file(provenance.license.localCopy.file)
  if (sha256(license) !== provenance.license.localCopy.sha256) found.push('license digest')
  if (!license.toString().includes(provenance.copyright)) found.push('license names another copyright')
  if (!/^(BSD-[23]-Clause|MIT|Apache-2\.0)$/.test(provenance.license.name)) found.push('license is not permissive')
  const urls = [provenance.sourceUrl, provenance.resolvedUrl, provenance.sourcePage, ...provenance.license.urls, provenance.license.localCopy.sourceUrl]
  if (urls.some((url) => !url.includes(`/${provenance.upstreamRevision}/`))) found.push('a source URL is not pinned to the revision')
  const readme = file('README.md').toString()
  if (!readme.includes(provenance.upstreamRevision) || !readme.includes(provenance.license.name)) found.push('README names another revision or license')
  return found
}

describe('vendored Haskell grammar', () => {
  it('is the pinned upstream file, with its license and a record of where it came from', () => {
    expect(problems(read, PROVENANCE)).toEqual([])
  })

  it('notices an edited grammar, license or record', () => {
    const swapped = (name: string, text: string) => (file: string) => (file === name ? Buffer.from(text) : read(file))
    const edited = problems(swapped(PROVENANCE.asset, `${read(PROVENANCE.asset).toString()} `), PROVENANCE)
    expect(edited).toContain('grammar digest')
    expect(edited).toContain('grammar is not the upstream git object')
    expect(problems(swapped(PROVENANCE.derivedCopy.file, '{}'), PROVENANCE)).toContain('converted grammar digest')
    expect(problems(swapped(PROVENANCE.license.localCopy.file, 'MIT'), PROVENANCE)).toContain('license names another copyright')
    expect(problems(read, { ...PROVENANCE, license: { ...PROVENANCE.license, name: 'GPL-3.0-only' } })).toContain('license is not permissive')
    expect(problems(read, { ...PROVENANCE, upstreamRevision: 'master' })).toContain('a source URL is not pinned to the revision')
  })
})
