import { Resolver, type InventoryEntry } from '@libtmux/api-model'
import { API_MODELS } from './api-models'
import domInv from '../data/inventories/dom.entries.json'
import jdkInv from '../data/inventories/jdk.entries.json'
import pythonInv from '../data/inventories/python.entries.json'

/**
 * The resolver that answers "what does this name refer to", with the
 * standard-library inventories attached.
 *
 * One instance, shared. It lived inside `plugins/rehype-api-links.ts`, which
 * only runs over Markdown — so prose written in an `.astro` template could not
 * reach it, and `java.nio.file.Path` in the Java quickstart note rendered as
 * plain text while the same name in a Markdown page linked to Oracle's
 * javadoc. Two behaviours from one rule means the rule is in the wrong place.
 *
 * The inventories are imported, not read from disk. The plugin found them with
 * `import.meta.url` and `fs`, which is correct where a Vite plugin runs and
 * silently wrong inside a bundled SSR component: `existsSync` returned false,
 * no inventory was added, and every standard-library name resolved to nothing
 * with no error anywhere. An import is resolved by the bundler and fails
 * loudly.
 *
 * Scoped to the ports they describe. An unscoped CPython inventory once
 * answered for all eight and sent Go readers to Python's `time` module.
 */
/** The sidecar shape as the JSON import types it: rows of [name, uri]. */
interface InventorySidecar {
  e: (string | undefined)[][]
}

const INVENTORIES: {
  data: InventorySidecar
  project: string
  baseUrl: string
  langs: string[]
}[] = [
  { data: pythonInv, project: 'Python', baseUrl: 'https://docs.python.org/3/', langs: ['py'] },
  {
    data: jdkInv,
    project: 'Java SE',
    baseUrl: 'https://docs.oracle.com/en/java/javase/21/docs/api/',
    langs: ['java'],
  },
  { data: domInv, project: 'MDN', baseUrl: 'https://developer.mozilla.org/', langs: ['ts'] },
]

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

let resolver: Resolver | undefined

/**
 * Languages whose standard library publishes an inventory get one; the other
 * five resolve through the curated map in `packages/api-model/src/builtins.ts`.
 * Both paths end at `Resolver`, so a caller never has to know which a language
 * has.
 */
export function getResolver(): Resolver {
  if (resolver) return resolver
  const r = new Resolver(Object.values(API_MODELS))
  for (const { data, project, baseUrl, langs } of INVENTORIES) {
    r.addInventory(project, baseUrl, entriesOf(data), langs)
  }
  resolver = r
  return r
}
