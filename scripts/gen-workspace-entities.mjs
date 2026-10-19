#!/usr/bin/env node
/**
 * Index the workspace commands, options and configuration keys that prose can
 * link to, so a code span naming one reaches its CLI Manual or Configuration
 * entry. The index is committed because the Markdown exports run bundled, with
 * no content directory beside them.
 *
 * Usage:
 *   node scripts/gen-workspace-entities.mjs             # rewrite the index
 *   node scripts/gen-workspace-entities.mjs --check     # fail if it is stale
 *   node scripts/gen-workspace-entities.mjs --file X    # operate on X (negative test)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectWorkspaceEntities, formatWorkspaceEntities } from './lib/workspace-entities.mjs'
import { PORTS, productAvailable } from '../site/src/lib/ports.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fileArg = process.argv.indexOf('--file')
const out = fileArg === -1 ? join(root, 'site/src/data/workspace-entities.json') : resolve(process.argv[fileArg + 1])

const groups = collectWorkspaceEntities({
  docs: join(root, 'site/src/content/docs'),
  shared: join(root, 'site/src/content/_workspace-shared'),
  ports: PORTS.filter((port) => productAvailable(port, 'workspace')).map((port) => ({
    slug: port.slug, program: port.workspaceCli?.split(/\s+/)[0],
  })),
})
const next = formatWorkspaceEntities(groups)
const summary = `${groups.length} groups, ${groups.reduce((n, group) => n + group.commands.length, 0)} commands, `
  + `${groups.reduce((n, group) => n + group.options.length, 0)} options, ${groups.reduce((n, group) => n + group.keys.length, 0)} keys`

if (process.argv.includes('--check')) {
  if (!existsSync(out) || readFileSync(out, 'utf8') !== next) {
    console.error('gen-workspace-entities: index missing or stale; run node scripts/gen-workspace-entities.mjs')
    process.exit(1)
  }
} else {
  writeFileSync(out, next)
}
console.log(`gen-workspace-entities: ${summary}`)
