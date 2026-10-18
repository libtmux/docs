import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { compatibilityEntries, targetEntries, targetKey, writeInventoryEntries } from '@libtmux/api-model'
import { installFragmentAlias, mergeTargets, renderedTargets, type InventoryAlias, type RenderedTarget } from './inventory-targets.ts'
import type { VersionManifest } from './versions.ts'

export function collectInventoryTargets(out: string, base: string): RenderedTarget[] {
  const targets: RenderedTarget[] = []
  for (const file of readdirSync(out, { recursive: true }).filter((file): file is string => typeof file === 'string' && file.endsWith('.html'))) {
    const path = file.replaceAll('\\', '/').replace(/index\.html$/, '')
    targets.push(...renderedTargets(readFileSync(join(out, file), 'utf8'), `${base}${path}`))
  }
  return mergeTargets(targets)
}

const write = (out: string, path: string, bytes: string | Buffer) => {
  const file = join(out, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, bytes)
}

function catalog(out: string, path: string, targets: RenderedTarget[], coverage: Record<string, unknown>) {
  write(out, path, `${JSON.stringify({ schema: 1, ...coverage, targets: targets.map((target) => ({ key: targetKey(target), ...target })) })}\n`)
}

/** A port export names only the version just rendered, with auto-discovery at its root. */
export function publishPortInventory(out: string, base: string, targets: RenderedTarget[], port: string, version: string) {
  const selected = targets.filter((target) => target.scope === port && target.version === version)
  if (!selected.length) throw new Error(`No rendered inventory targets for ${port}/${version}`)
  const options = { project: `libtmux ${port}`, version }
  write(out, 'objects.inv', writeInventoryEntries(targetEntries(selected, base, true), options))
  catalog(out, 'targets.json', selected, { base, scope: port, version })
  // Existing mappings use the reference directory as their base.
  const compatibility = compatibilityEntries(selected, base).map((entry) => ({ ...entry, uri: `../${entry.uri}` }))
  write(out, 'reference/objects.inv', writeInventoryEntries(compatibility, { ...options, legacyCaseSensitiveLabels: true }))
  return { scope: port, version, targets: selected.length, base }
}

/** The full export is assembled only after all advertised default trees exist. */
export function publishAssembledInventories(out: string, base: string, manifest: VersionManifest, aliases: InventoryAlias[] = []) {
  const all = collectInventoryTargets(out, base)
  const scopes = new Set(all.filter((target) => target.scope === 'site' || target.scope.startsWith('tmux@') || manifest.ports[target.scope]?.length).map((target) => target.scope))
  const targets = mergeTargets(all, aliases.filter((alias) => scopes.has(alias.scope)))
  for (const alias of aliases.filter((alias) => alias.fragment)) {
    for (const target of targets.filter((target) => target.scope === alias.scope && targetKey(target) === alias.to && target.aliases?.includes(alias.from))) {
      if (!target.href.startsWith(base)) throw new Error(`Inventory alias escapes ${base}: ${target.href}`)
      const path = new URL(target.href, 'https://inventory.invalid').pathname
      const file = join(out, decodeURIComponent(path.slice(base.length)), ...(path.endsWith('/') ? ['index.html'] : []))
      const html = readFileSync(file, 'utf8')
      const updated = installFragmentAlias(html, target, alias)
      if (html !== updated) writeFileSync(file, updated)
    }
  }
  const ports = []
  const excluded = []
  for (const [port, versions] of Object.entries(manifest.ports)) {
    if (!versions.length) { excluded.push(port); continue }
    const selectedDefault = manifest.defaultVersion[port]
    if (!versions.some((entry) => entry.slug === selectedDefault)) throw new Error(`Inventory default version was not assembled: ${port}/${selectedDefault}`)
    for (const version of versions) {
      const portBase = `${base}${port}/${version.slug}/`
      ports.push(publishPortInventory(join(out, port, version.slug), portBase, targets, port, version.slug))
    }
  }
  const full = targets.filter((target) => target.scope === 'site' || target.scope.startsWith('tmux@') ||
    manifest.defaultVersion[target.scope] === target.version && manifest.ports[target.scope]?.length)
  write(out, 'objects-full.inv', writeInventoryEntries(targetEntries(full, base), { project: 'libtmux', version: 'all' }))
  catalog(out, 'targets.json', full, { base, defaults: manifest.defaultVersion, coverage: { ports, excluded } })
  write(out, 'objects.inv', writeInventoryEntries(compatibilityEntries(full, base, true), {
    project: 'libtmux', version: 'all', legacyCaseSensitiveLabels: true,
  }))
  for (const scope of new Set(full.filter((target) => target.scope.startsWith('tmux@')).map((target) => target.scope))) {
    const version = scope.slice('tmux@'.length)
    const prefix = `tmux/${version}/reference/`
    write(out, `${prefix}objects.inv`, writeInventoryEntries(compatibilityEntries(full.filter((target) => target.scope === scope), `${base}${prefix}`), {
      project: 'tmux C source', version, legacyCaseSensitiveLabels: true,
    }))
  }
  return { targets: full.length, ports, excluded }
}
