/*
 * Where a built reference tree is, now that there are three per port.
 *
 * The core library answers under `<port>/<version>/reference/`, and the
 * Workspace Manager and MCP server under `<port>/<version>/<product>/
 * reference/`. A port publishes one version prefix today and Python two, so
 * every check that reads the reference has to look for all of them rather
 * than the single `reference/<port>/` it used to know.
 *
 * One module, because five checks ask the same question and the answer moved
 * once already.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Product sections carrying a reference of their own. */
export const PRODUCT_SECTIONS = ['workspace', 'mcp']

/** Version prefixes built for a port, newest-agnostic and sorted for stability. */
export function versionsOf(site, port) {
  const dir = join(site, port)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((entry) => statSync(join(dir, entry)).isDirectory())
    .filter((entry) => existsSync(join(dir, entry, 'reference')))
    .sort()
}

/**
 * Every reference directory for a port: its core tree per version, and each
 * product's tree beside it.
 *
 * `products` is off by default because most checks measure the core library;
 * the ones that cover the whole estate ask for it.
 */
export function referenceDirs(site, port, { products = false } = {}) {
  const dirs = []
  for (const version of versionsOf(site, port)) {
    dirs.push(join(site, port, version, 'reference'))
    if (!products) continue
    for (const product of PRODUCT_SECTIONS) {
      const dir = join(site, port, version, product, 'reference')
      if (existsSync(dir)) dirs.push(dir)
    }
  }
  return dirs
}
