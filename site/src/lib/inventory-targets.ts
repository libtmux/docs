import { fromHtml } from 'hast-util-from-html'
import { inventoryType, qualifiedNameOf, targetKey, type ApiSymbol, type InventoryTarget, type SymbolKind } from '@libtmux/api-model'

export interface InventoryPage {
  scope: string
  product: string
  identity: string
  title: string
  version?: string
  source?: InventoryTarget['source']
  aliases?: string[]
  exclude?: boolean
}

/** Renderers attach identities to the elements that own their fragments. */
export function apiInventoryIdentity(symbol: ApiSymbol, language: string, parentKind?: SymbolKind): string {
  // Doxygen's anonymous enum IDs change with their bodies; C enumerator names do not.
  return language === 'c' && symbol.kind === 'constant' && parentKind === 'enum'
    ? `c:enumerator:${symbol.source.file}:${symbol.name}` : symbol.publicId ?? symbol.id
}

export function apiInventoryAttributes(symbol: ApiSymbol, language: string, parentKind?: SymbolKind) {
  const type = inventoryType(symbol, language, parentKind)
  const name = language === 'c' && type === 'c:enumerator' ? symbol.name : qualifiedNameOf(symbol)
  return {
    'data-inventory-id': apiInventoryIdentity(symbol, language, parentKind),
    'data-inventory-category': 'api',
    'data-inventory-display': qualifiedNameOf(symbol),
    'data-inventory-native': type === 'std:label' ? undefined : JSON.stringify([...new Set([name, symbol.publicId ?? symbol.id])].map((name) => ({ type, name }))),
    'data-inventory-legacy-type': type,
    'data-inventory-former-type': inventoryType(symbol, 'py'),
    'data-inventory-legacy-name': symbol.publicId ?? symbol.id,
  }
}

type Node = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: Node[]; position?: { start: { offset?: number } } }
const attribute = (props: Record<string, unknown>, key: string) => typeof props[key] === 'string' ? props[key] : undefined
const DROP = new Set(['script', 'style', 'template', 'noscript', 'nav', 'aside', 'button', 'input', 'select', 'dialog', 'svg'])
const CONTROL_ROLES = new Set(['dialog', 'tooltip', 'menu', 'menubar', 'tablist', 'tab', 'combobox', 'listbox', 'button', 'checkbox', 'radio', 'switch', 'slider', 'spinbutton'])
const text = (node: Node): string => node.type === 'text' ? node.value ?? ''
  : (node.children ?? []).filter((child) => !['a', 'button'].includes(child.tagName ?? '') ||
    !String(child.properties?.className).includes('link')).map(text).join('')
const walk = (node: Node, visit: (node: Node) => void) => { visit(node); for (const child of node.children ?? []) walk(child, visit) }

export interface RenderedTarget extends InventoryTarget {
  legacy?: { type: string; name: string }[]
  formerType?: string
}

/** Read actual destinations, including nested schemas and explicitly typed prose. */
export function renderedTargets(html: string, href: string): RenderedTarget[] {
  const mainStart = html.search(/<main(?:\s|>)/)
  const mainEnd = html.lastIndexOf('</main>')
  const headEnd = html.indexOf('</head>')
  // Parse content once; repeated navigation can dwarf an API declaration.
  const content = mainStart >= 0 && mainEnd > mainStart && headEnd >= 0
    ? `${html.slice(0, headEnd + 7)}<body>${html.slice(mainStart, mainEnd + 7)}</body></html>` : html
  const tree: Node = fromHtml(content)
  let page: InventoryPage | undefined
  let main: Node | undefined
  const ids = new Map<string, number>()
  walk(tree, (node) => {
    const props = node.properties ?? {}
    if (node.tagName === 'meta' && props.name === 'libtmux-inventory') page = JSON.parse(attribute(props, 'content') ?? '{}') as InventoryPage
    if (node.tagName === 'main' || props.role === 'main') main = node
    if (typeof props.id === 'string') ids.set(props.id, (ids.get(props.id) ?? 0) + 1)
  })
  if (!page || page.exclude || !main) return []
  const context = { scope: page.scope, product: page.product, version: page.version, source: page.source }
  const targets: RenderedTarget[] = [{ ...context, category: 'doc', identity: page.identity,
    display: page.title, href, aliases: page.aliases }]
  const collect = (node: Node, inheritedOwner?: string, inheritedAnchor?: string) => {
    const props = node.properties ?? {}
    if (DROP.has(node.tagName ?? '') || CONTROL_ROLES.has(attribute(props, 'role') ?? '') || Object.hasOwn(props, 'dataInventoryIgnore')) return
    const owner = attribute(props, 'dataInventoryOwner') ?? inheritedOwner
    const anchor = attribute(props, 'dataInventoryAnchor') ?? inheritedAnchor
    const owned = (id: string) => Boolean(owner && anchor && (id === anchor || id.startsWith(`${anchor}.`)))
    const logical = (id: string) => owned(id) ? owner! + id.slice(anchor!.length) : id
    if (typeof props.id === 'string' && props.id !== '_top' && (props.role !== 'tabpanel' || props.dataInventoryId)) {
      const id = props.id
      if (ids.get(id) !== 1) throw new Error(`Inventory destination has duplicate HTML IDs: ${href}#${id}`)
      const explicit = typeof props.dataInventoryId === 'string'
      const category = attribute(props, 'dataInventoryCategory') ?? (owned(id) ? 'section' : /^h[1-6]$/.test(node.tagName ?? '') ? 'heading' : 'anchor')
      const identity = explicit ? logical(attribute(props, 'dataInventoryId')!) : owned(id) ? logical(id) : `${owner ?? page!.identity}#${id}`
      const native = props.dataInventoryNative ? JSON.parse(attribute(props, 'dataInventoryNative')!) : undefined
      const legacy = props.dataInventoryLegacyType ? [{ type: attribute(props, 'dataInventoryLegacyType')!, name: attribute(props, 'dataInventoryLegacyName')! }] : undefined
      targets.push({ ...context, category, identity,
        display: (attribute(props, 'dataInventoryDisplay') ?? (/^h[1-6]$/.test(node.tagName ?? '') || node.tagName === 'tr'
          ? text(node) : id)).replace(/\s+/g, ' ').trim(), href: `${href}#${encodeURIComponent(id)}`,
        ...(native ? { native } : {}), ...(legacy ? { legacy, formerType: attribute(props, 'dataInventoryFormerType') } : {}),
        ...(props.dataInventoryAliases ? { aliases: JSON.parse(attribute(props, 'dataInventoryAliases')!) } : {}),
      })
      if (props.dataInventoryTargets) {
        const entries = JSON.parse(attribute(props, 'dataInventoryTargets')!) as Pick<InventoryTarget, 'category' | 'identity' | 'display' | 'native'>[]
        for (const entry of entries) targets.push({ ...context, ...entry, href: `${href}#${encodeURIComponent(id)}` })
      }
    }
    for (const child of node.children ?? []) collect(child, owner, anchor)
  }
  collect(main)
  // Detach attribute substrings so retained targets cannot pin complete HTML buffers.
  return JSON.parse(JSON.stringify(targets)) as RenderedTarget[]
}

/** An alias keeps a published key while a destination or logical name changes. */
export interface InventoryAlias { from: string; to: string; scope: string; product?: string; fragment?: string }

/** Preserve a retired fragment at the element now owning the reference. */
export function installFragmentAlias(html: string, target: RenderedTarget, alias: InventoryAlias): string {
  if (!alias.fragment) return html
  const fragment = decodeURIComponent(new URL(target.href, 'https://inventory.invalid').hash.slice(1))
  const tree: Node = fromHtml(html)
  let destination: Node | undefined
  let existing: Node | undefined
  walk(tree, (node) => {
    if (node.properties?.id === alias.fragment) existing = node
    if (fragment ? node.properties?.id === fragment : node.tagName === 'main') destination = node
  })
  if (existing) {
    if (fragment === alias.fragment || existing.properties?.dataInventoryAliasFor === alias.to) return html
    throw new Error(`Inventory fragment alias conflicts with an existing ID: ${alias.fragment}`)
  }
  const start = destination?.position?.start.offset
  if (start === undefined) throw new Error(`Inventory fragment alias destination is missing: ${target.href}`)
  let quote = ''
  let end = start
  for (; end < html.length; end++) {
    const char = html[end]!
    if (quote) { if (char === quote) quote = '' }
    else if (char === '"' || char === "'") quote = char
    else if (char === '>') break
  }
  const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  const span = `<span id="${escape(alias.fragment)}" class="section-anchor-alias" data-inventory-ignore data-inventory-alias-for="${escape(alias.to)}"></span>`
  return html.slice(0, end + 1) + span + html.slice(end + 1)
}

export function mergeTargets(targets: readonly RenderedTarget[], aliases: readonly InventoryAlias[] = []): RenderedTarget[] {
  const result = new Map<string, RenderedTarget>()
  for (const target of targets) {
    const key = `${target.version ?? ''}\0${targetKey(target)}`
    const existing = result.get(key)
    if (existing && existing.href !== target.href) throw new Error(`Inventory identity has two destinations: ${targetKey(target)}: ${existing.href}, ${target.href}`)
    if (!existing) result.set(key, { ...target })
  }
  for (const alias of aliases) {
    const matches = [...result.values()].filter((target) => target.scope === alias.scope &&
      (!alias.product || target.product === alias.product) && targetKey(target) === alias.to)
    if (!matches.length) throw new Error(`Inventory alias has no destination: ${alias.from} -> ${alias.to}`)
    for (const target of matches) {
      // Archived snapshots keep the declaration that still owns the old key.
      if (result.has(`${target.version ?? ''}\0${alias.from}`)) continue
      target.aliases = [...new Set([...(target.aliases ?? []), alias.from])]
    }
  }
  return [...result.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, target]) => target)
}
