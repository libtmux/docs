import { SymbolIndex, type ApiModel, type ApiSymbol, type InventoryEntry } from '@libtmux/api-model'
import mentionIndex from '../data/mentions.json'
import domInv from '../data/inventories/dom.entries.json'
import jdkInv from '../data/inventories/jdk.entries.json'
import pythonInv from '../data/inventories/python.entries.json'
import { withRoot } from './site-root'
import cxxNav from '../data/api/cxx.nav.json'
import dotnetNav from '../data/api/dotnet.nav.json'
import goNav from '../data/api/go.nav.json'
import javaNav from '../data/api/java.nav.json'
import pyNav from '../data/api/py.nav.json'
import rsNav from '../data/api/rs.nav.json'
import swiftNav from '../data/api/swift.nav.json'
import tsNav from '../data/api/ts.nav.json'
import cxxModel from '../data/api/cxx.json'
import dotnetModel from '../data/api/dotnet.json'
import goModel from '../data/api/go.json'
import javaModel from '../data/api/java.json'
import pyModel from '../data/api/py.json'
import rsModel from '../data/api/rs.json'
import swiftModel from '../data/api/swift.json'
import tsModel from '../data/api/ts.json'

/**
 * The extracted models, in one module rather than in the route.
 *
 * Astro hoists `getStaticPaths()` out of the component scope, so a constant
 * declared in the frontmatter and used in both `getStaticPaths()` and the
 * template is defined in neither at runtime — the route fails with
 * "MODELS is not defined" during static generation, long after type-checking
 * passed. Imports are visible to both.
 */
export const API_MODELS: Record<string, ApiModel> = {
  py: pyModel as unknown as ApiModel,
  ts: tsModel as unknown as ApiModel,
  rs: rsModel as unknown as ApiModel,
  go: goModel as unknown as ApiModel,
  java: javaModel as unknown as ApiModel,
  dotnet: dotnetModel as unknown as ApiModel,
  cxx: cxxModel as unknown as ApiModel,
  swift: swiftModel as unknown as ApiModel,
}

/** One entry in a curated sidebar bucket, carrying just enough to link it. */
export interface NavEntry {
  id: string
  name: string
  slug: string
  kind: string
}

/** One bucket in a compiled sidebar, and the buckets it splits into. */
export interface NavBucket {
  id: string
  label: string
  collapsed: boolean
  /** Present when the bucket grew large enough to divide — see SPLITS in
   *  nav-config.ts. A child holds symbols of its own, so a renderer that
   *  walked only the top level would drop them. */
  children?: NavBucket[]
}

/** A port's sidebar, compiled by `scripts/gen-api-model.mjs`. */
export interface PortNavData {
  port: string
  buckets: NavBucket[]
  assignments: Record<string, NavEntry[]>
  /** Symbol id to the bucket holding it, so a page looks up rather than scans. */
  placement: Record<string, string>
  unplaced: NavEntry[]
}

/**
 * The curated sidebars, compiled once per port at model-generation time.
 *
 * A page reads its own branch out of this. Deciding which of twelve thousand
 * symbols belongs in which bucket is the same answer on every page of a port,
 * so it is decided beside `slug` in `gen-api-model.mjs` and written next to
 * the model rather than recomputed here.
 *
 * `scripts/check-nav.mjs` lints these same files, so what the lint checks and
 * what a page renders cannot disagree.
 */
export const API_NAV: Record<string, PortNavData> = {
  py: pyNav as unknown as PortNavData,
  ts: tsNav as unknown as PortNavData,
  rs: rsNav as unknown as PortNavData,
  go: goNav as unknown as PortNavData,
  java: javaNav as unknown as PortNavData,
  dotnet: dotnetNav as unknown as PortNavData,
  cxx: cxxNav as unknown as PortNavData,
  swift: swiftNav as unknown as PortNavData,
}

/**
 * Declarations that own a page of members.
 *
 * A Rust `enum` and a Go `struct` earn one for the same reason a Python class
 * does; a type alias does not, because it has nothing under it.
 */
export const OWNER_KINDS = new Set([
  'class',
  'exception',
  'interface',
  'struct',
  'trait',
  'enum',
])

export const PORT_NAME: Record<string, string> = {
  py: 'Python',
  ts: 'TypeScript',
  rs: 'Rust',
  go: 'Go',
  java: 'Java',
  dotnet: '.NET',
  cxx: 'C++',
  swift: 'Swift',
}

/**
 * Types that get their own page: the ones with members to put on it.
 *
 * Three rules have been wrong here, each producing something invisible:
 *
 * - "has members" alone left 259 links to pages never generated, because
 *   `SymbolIndex` links every symbol and member-less types had no home.
 * - "no parent" excluded nested types like `FilterSchema.Field`, whose own
 *   members still linked to a page for them.
 * - "everything" fixed the links and produced 509 thin pages — a heading, a
 *   signature, and nothing else.
 *
 * The resolution is not a fourth filter on this function. A member-less type
 * does not need a *page*; it needs a *home*, and it already has one — nested
 * types render as entries on their parent's page, and top-level ones render
 * on the port index. `hrefFor` sends links to that anchor instead. Pages are
 * for types that have something under them.
 */
export function ownersOf(model: ApiModel) {
  const hasMembers = new Set(model.symbols.flatMap((s) => (s.parent ? [s.parent] : [])))
  return model.symbols.filter((s) => OWNER_KINDS.has(s.kind) && hasMembers.has(s.id))
}

/** The types the port index lists: top-level only, so nesting reads as nesting. */
export function topLevelTypesOf(model: ApiModel) {
  return model.symbols.filter((s) => !s.parent && OWNER_KINDS.has(s.kind))
}

/**
 * The URL segment for a type's page.
 *
 * Ids come from source and can hold anything the language allows: Rust's
 * `impl` blocks yield `formats.text.&str` and `hooks.&'values SparseValues`,
 * where `&` and `'` are legal in a type and hostile in a path. Three symbols
 * out of 13,753 — and three broken links, because the route and the linker
 * each did their own ad-hoc transform and disagreed on the result.
 *
 * One function, used by both, is what keeps them agreeing.
 */
export function pageSlug(id: string): string {
  return id
    .toLowerCase()
    .replaceAll('.', '-')
    .replace(/[^a-z0-9_:()\[\]-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
}


/**
 * Inventories this site resolves external names against, intersphinx-style.
 *
 * Cached by `scripts/fetch-inventories.mjs` rather than fetched at build time:
 * the site builds fourteen times per assembly and a docs build should not need
 * the network. CPython's file alone carries 19,441 entries against the 22-name
 * table it replaces.
 */
/**
 * Imported, not read from disk.
 *
 * This resolved the `.inv` path from `import.meta.url` and skipped it when
 * `existsSync` said no. Under Vite that path moves, so the check failed
 * silently and the federation was dead in every build for as long as it
 * existed: Python's 6,253 external links were identical with the inventory
 * present and absent, all of them from a hand-written fallback table. A
 * static import is what the models beside it already use, and it fails the
 * build when the file is missing instead of quietly linking less.
 */
const INVENTORIES: {
  data: InventorySidecar
  baseUrl: string
  langs: string[]
  project: string
}[] = [
  { data: pythonInv, baseUrl: 'https://docs.python.org/3/', langs: ['py'], project: 'Python' },
  // Neither of these is published as an inventory; both are converted from
  // what their projects do publish — see scripts/build-inventories.mjs.
  {
    data: jdkInv,
    baseUrl: 'https://docs.oracle.com/en/java/javase/21/docs/api/',
    langs: ['java'],
    project: 'Java SE',
  },
  {
    data: domInv,
    baseUrl: 'https://developer.mozilla.org/',
    langs: ['ts'],
    project: 'MDN Web Docs',
  },
]

interface InventorySidecar {
  project: string
  version: string
  /** `[name, uri]` — the only two fields a lookup reads. */
  e: string[][]
}

/**
 * The sidecar back into entries.
 *
 * `type` and `dispname` are reconstructed rather than stored: a lookup uses
 * neither, and only the writer cares what domain a name belongs to.
 */
const entriesOf = (inv: InventorySidecar): InventoryEntry[] =>
  inv.e.map(([name, uri]) => ({
    name: name ?? '',
    type: 'std:label',
    priority: 1,
    uri: uri ?? '',
    dispname: '-',
  }))

const indexes = new Map<string, SymbolIndex>()

/**
 * A resolver for one port's model, with the external inventories attached.
 *
 * Built once per port, not once per page. The result is the same for every
 * page of a port — the index is a function of `model.symbols` and the three
 * inventories, none of which vary within a port — and every page of the
 * reference was paying to rebuild it. Across twelve thousand pages that
 * repetition was a large fraction of an assembly.
 *
 * Keyed by port rather than by the arguments, because `hrefFor` is a closure
 * built fresh on every page and would never compare equal. That is sound only
 * while every caller's `hrefFor` depends on nothing but the port, which is
 * true of the one caller: it closes over `model` and reads `model.port`. A
 * caller wanting different hrefs for the same port must not use this — build
 * a `SymbolIndex` directly.
 *
 * The miss logs, so a build says how many were built. More lines than ports
 * means the key stopped matching and the memo is silently doing nothing.
 *
 * A model with no symbols is never cached. The reference index route has no
 * model of its own and passes a stub to get an empty index; that stub used to
 * carry `port: 'py'`, so when it was built first it claimed the `py` key and
 * every Python page after it resolved against an index of nothing. The result
 * was 349 unlinked cross-references on `libtmux.Server` alone, with the other
 * seven ports fine — a caching bug that looks exactly like a Python
 * extraction bug.
 */
export function indexFor(model: ApiModel, hrefFor: (s: ApiSymbol) => string): SymbolIndex {
  if (model.symbols.length === 0) return new SymbolIndex(model.symbols, hrefFor, model.port)

  const cached = indexes.get(model.port)
  if (cached) return cached

  const index = new SymbolIndex(model.symbols, hrefFor, model.port)
  for (const { data, baseUrl, langs, project } of INVENTORIES) {
    index.addInventory(baseUrl, entriesOf(data), langs, project)
  }
  indexes.set(model.port, index)
  console.log(`[api-index] built ${model.port}`)
  return index
}

/**
 * Where a symbol is rendered, addressed across ports.
 *
 * The route's own `hrefFor` closes over one model, which is right for a page
 * that shows one port. Anything crossing ports — the concept map's "in other
 * languages", the prose linker — needs to ask about a port it is not
 * rendering, so the rule lives here once rather than being restated with
 * slightly different edge cases in each caller.
 *
 * Returns undefined when the port or the symbol is unknown, so a stale entry
 * renders as text instead of a link to nothing.
 */
export function referenceHref(port: string, publicId: string): string | undefined {
  const model = API_MODELS[port]
  if (!model) return undefined
  // Existence is still checked: a stale entry should render as text rather
  // than link to a page that was never generated.
  const symbol = model.symbols.find((s) => (s.publicId ?? s.id) === publicId)
  if (!symbol) return undefined
  return withRoot(`/reference/${port}/${symbol.slug ?? pageSlug(publicId)}/`)
}

interface MentionIndex {
  generated: string
  mentions: { port: string; symbol: string; page: string; title?: string; section?: string }[]
}

/**
 * Prose pages that mention a symbol, for the backlink on its entry.
 *
 * Built by `scripts/gen-mentions.mjs` before the build rather than recorded
 * while rendering: a render-time recorder sees nothing on a cached build and
 * reports that as "no mentions", which is indistinguishable from prose that
 * stopped referring to the API. With the assembly's cache hitting on every
 * unchanged run it would have been empty almost always.
 *
 * Keyed on `symbol.id`, not `publicId` — the id is what the resolver returns
 * and what the symbol tables are keyed on.
 */
const mentionsBySymbol = new Map<string, MentionIndex['mentions']>()
for (const m of (mentionIndex as MentionIndex).mentions) {
  const key = `${m.port} ${m.symbol}`
  const list = mentionsBySymbol.get(key) ?? []
  list.push(m)
  mentionsBySymbol.set(key, list)
}

export function mentionsOf(port: string, symbolId: string): MentionIndex['mentions'] {
  return mentionsBySymbol.get(`${port} ${symbolId}`) ?? []
}
