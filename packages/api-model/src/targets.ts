import type { InventoryEntry } from './inventory.ts'

/** Identity survives display and route changes; version selects a snapshot. */
export interface InventoryTarget {
  scope: string
  product: string
  category: string
  identity: string
  display: string
  href: string
  version?: string
  source?: { repo: string; path: string; ref: string }
  native?: { type: string; name: string }[]
  aliases?: string[]
  legacy?: { type: string; name: string }[]
  formerType?: string
}

/** Injective under std:ref's lowercase normalization, including case-distinct APIs. */
export function targetKey(target: Pick<InventoryTarget, 'scope' | 'product' | 'category' | 'identity'>): string {
  return [target.scope, target.product, target.category, target.identity].map((part) => {
    if (!part) throw new Error('Inventory identity components must be nonempty')
    return part.replace(/[^a-z0-9._~-]/gu, (character) => [...Buffer.from(character)]
      .map((byte) => `%${byte.toString(16).padStart(2, '0')}`).join(''))
  }).join(':')
}

/** Record URLs are relative to the mapping base, including preview mounts. */
export function targetEntries(targets: readonly InventoryTarget[], base: string, scoped = false): InventoryEntry[] {
  if (!base.startsWith('/') || !base.endsWith('/')) throw new Error(`Inventory base must be an absolute directory path: ${base}`)
  const entries: InventoryEntry[] = []
  const used = new Map<string, string>()
  const add = (name: string, type: string, target: InventoryTarget) => {
    if (!target.href.startsWith(base) || !new URL(target.href, 'https://inventory.invalid').pathname.startsWith(base)) throw new Error(`Inventory target escapes ${base}: ${target.href}`)
    if (type === 'std:label' && name !== name.toLowerCase()) throw new Error(`Inventory label must survive lowercase normalization: ${name}`)
    const uri = target.href.slice(base.length)
    const spelling = type === 'std:term' ? name.toLowerCase() : name
    const key = `${type}\0${spelling}`
    const previous = used.get(key)
    if (used.has(key)) {
      if (previous !== uri) throw new Error(`Inventory reference has two destinations: ${type} ${name}`)
      return
    }
    used.set(key, uri)
    entries.push({ name: spelling, type, uri, priority: 1, dispname: target.display })
  }
  const nativeDestinations = new Map<string, Set<string>>()
  for (const target of targets) for (const native of target.native ?? []) {
    for (const name of [`${target.scope}:${target.product}:${native.name}`, `${target.scope}:${native.name}`, ...(scoped ? [native.name] : [])]) {
      const key = `${native.type}\0${native.type === 'std:term' ? name.toLowerCase() : name}`
      const destinations = nativeDestinations.get(key) ?? new Set()
      destinations.add(target.href)
      nativeDestinations.set(key, destinations)
    }
  }
  for (const target of targets) {
    const key = targetKey(target)
    add(key, 'std:label', target)
    for (const alias of target.aliases ?? []) add(alias, 'std:label', target)
    if (target.category === 'doc') add(key, 'std:doc', target)
    for (const native of target.native ?? []) {
      for (const name of [`${target.scope}:${target.product}:${native.name}`, `${target.scope}:${native.name}`, ...(scoped ? [native.name] : [])]) {
        const key = `${native.type}\0${native.type === 'std:term' ? name.toLowerCase() : name}`
        if (nativeDestinations.get(key)?.size === 1) add(name, native.type, target)
      }
    }
  }
  return entries
}

/** Compatibility mappings retain raw API names and former aggregate aliases. */
export function compatibilityEntries(targets: readonly InventoryTarget[], base: string, aggregate = false): InventoryEntry[] {
  const entries = new Map<string, InventoryEntry>()
  const cSpellings = new Map<string, Set<string>>()
  if (!aggregate) for (const target of targets) for (const native of target.native ?? []) {
    if (!native.type.startsWith('c:') || /\s/.test(native.name)) continue
    const key = `${native.type}\0${native.name}`
    const destinations = cSpellings.get(key) ?? new Set<string>()
    destinations.add(target.href)
    cSpellings.set(key, destinations)
  }
  for (const target of targets) {
    if (aggregate && target.scope.startsWith('tmux@')) continue
    for (const legacy of target.legacy ?? []) {
      const name = aggregate ? `${target.scope}:${legacy.name}` : legacy.name
      if (!target.href.startsWith(base)) throw new Error(`Legacy inventory target escapes ${base}: ${target.href}`)
      const entry = { name, type: legacy.type, priority: 1, uri: target.href.slice(base.length), dispname: target.display }
      entries.set(`${entry.type}\0${name}`, entry)
      if (aggregate && target.formerType) entries.set(`${target.formerType}\0${name}`, { ...entry, type: target.formerType })
    }
    if (!aggregate) for (const native of target.native ?? []) {
      const key = `${native.type}\0${native.name}`
      if (cSpellings.get(key)?.size === 1) {
        if (!target.href.startsWith(base)) throw new Error(`Legacy inventory target escapes ${base}: ${target.href}`)
        entries.set(key, { name: native.name, type: native.type, priority: 1, uri: target.href.slice(base.length), dispname: target.display })
      }
    }
  }
  return [...entries.values()]
}
