import { withPortRoot } from './site-root.ts'

/** Inventory scope follows the page's port/version, independently of LLM subtrees. */
export function inventoryLinks(port?: string, version?: string) {
  return {
    scoped: port && version ? withPortRoot(`/${port}/${version}/objects.inv`) : undefined,
    full: withPortRoot('/objects-full.inv'),
    help: withPortRoot('/meta/intersphinx/'),
  }
}
