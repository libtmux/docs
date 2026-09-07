import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PORTS } from '../src/lib/ports'
import { SITE_BUILT, SITE_ROOT, BUCKET_ROOT, sitePath } from './site-root'

/**
 * The assembled tree holds nothing the manifest no longer lists.
 *
 * `build-site.sh` starts with `rm -rf "$out_dir"`, so today this is true by
 * construction and these assertions cost nothing. They exist for the day it
 * stops being: the shell builds are already fingerprint-cached, and the
 * obvious next step for a three-minute assembly is to stop wiping the output
 * and only rebuild what changed. At that point a retired version keeps its
 * directory, keeps being served, keeps being indexed by Pagefind, and nothing
 * says so.
 *
 * The same reasoning caught a real bug in the API projection: rebuilding into
 * a fresh file made pruning look automatic, and readers holding the old
 * database went on answering from it.
 */
const SITE = SITE_ROOT

interface VersionEntry {
  slug: string
  supported: boolean
}

const describeIfAssembled = SITE_BUILT && existsSync(sitePath('versions.json')) ? describe : describe.skip

describeIfAssembled('assembled tree pruning', () => {
  // Read lazily. `describe.skip` still evaluates this callback, so reading the
  // manifest here at definition time throws on a checkout with nothing built —
  // the suite fails instead of skipping, which is what it does on fresh CI.
  const manifest = (): { ports: Record<string, VersionEntry[]> } =>
    JSON.parse(readFileSync(join(SITE, 'versions.json'), 'utf8'))

  const dirsIn = (rel: string): string[] => {
    const abs = join(SITE, rel)
    if (!existsSync(abs)) return []
    return readdirSync(abs).filter((n) => statSync(join(abs, n)).isDirectory())
  }

  it.each(PORTS.filter((p) => p.versionedDocs).map((p) => [p.slug]))(
    '%s serves only versions the manifest lists',
    (slug) => {
      const listed = new Set((manifest().ports[slug] ?? []).map((v) => v.slug))
      // Non-version directories a port build legitimately emits.
      const ignore = new Set(['_astro', 'pagefind', 'assets'])
      const served = dirsIn(slug).filter((d) => !ignore.has(d))

      const orphans = served.filter((d) => !listed.has(d))
      expect(orphans, `${slug} directories with no manifest entry`).toEqual([])
    },
  )

  it('serves no pull-request preview tree', () => {
    // A preview is deleted when its PR closes. One left behind is noindex, so
    // it is invisible to search and to us — it just keeps being served.
    const previews = readdirSync(BUCKET_ROOT).filter((n) => n.startsWith('pr-'))
    expect(previews).toEqual([])
  })

  it('leaves no build scratch inside the published tree', () => {
    const stray = readdirSync(BUCKET_ROOT).filter((n) => /\.tmp$|^\.build-|~$/.test(n) && n !== '.build-logs')
    expect(stray, 'scratch left in the output tree').toEqual([])
  })

  it('every version the manifest advertises was actually built', () => {
    // The other direction, and the one that fails quietly: the switcher reads
    // this manifest, so an advertised version that was never assembled is a
    // dropdown entry leading to a 404.
    const missing: string[] = []
    for (const port of PORTS.filter((p) => p.versionedDocs)) {
      for (const entry of manifest().ports[port.slug] ?? []) {
        if (!entry.supported) continue
        if (!existsSync(join(SITE, port.slug, entry.slug))) {
          missing.push(`${port.slug}/${entry.slug}`)
        }
      }
    }
    expect(missing, 'advertised in versions.json but not built').toEqual([])
  })
})
