import { withPortRoot } from './site-root.ts'

/** The tmux release belongs to its manual, catalog and C source reference. */
export function tmuxInventoryVersion(pagePath: string): string | undefined {
  return /^tmux\/(latest|\d[^/]*)\/(?:manual|catalog|reference)(?:\/|$)/.exec(pagePath)?.[1]
}

/** Inventory scope follows the page's port/version, independently of LLM subtrees. */
export function inventoryLinks(port?: string, version?: string, pagePath = '') {
  const tmuxVersion = tmuxInventoryVersion(pagePath)
  const scoped = port && version ? `/${port}/${version}/objects.inv`
    : /^tmux(?:\/|$)/.test(pagePath) ? `/tmux/${tmuxVersion ? `${tmuxVersion}/` : ''}objects.inv` : undefined
  return {
    scoped: scoped ? withPortRoot(scoped) : undefined,
    full: withPortRoot('/objects-full.inv'),
    help: withPortRoot('/meta/intersphinx/'),
  }
}
