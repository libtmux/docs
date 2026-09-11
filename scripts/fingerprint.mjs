#!/usr/bin/env node
/**
 * A digest of everything an Astro build of this site reads.
 *
 * The assembly runs fourteen builds of the same source with different
 * environment variables, and repeats that on every invocation whether or not
 * anything changed. This is the key that says whether it has to.
 *
 * What goes in is chosen by what has already broken. Astro's own content
 * cache keys on the markdown source and not on the plugins that transform it,
 * which is how a build after a linker fix shipped the old links and reported
 * success — so this hashes the whole site and package source, not the content
 * directory. The extracted models are gitignored and five megabytes, so they
 * are hashed explicitly rather than reached through git.
 *
 * Usage: fingerprint.mjs [extra strings to fold in]
 */
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { globSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Globs covering every input. Directories that a build writes are excluded:
 * hashing `_site` or `.astro` would make the key depend on the previous run.
 */
const PATTERNS = [
  'site/src/**/*',
  'site/public/**/*',
  'site/astro.config.ts',
  'site/package.json',
  'site/tsconfig.json',
  'packages/*/src/**/*',
  'packages/*/package.json',
  'pnpm-lock.yaml',
  'scripts/*.mjs',
  'scripts/build-site.sh',
]

const files = new Set()
for (const pattern of PATTERNS) {
  for (const match of globSync(pattern, { cwd: root })) {
    const abs = join(root, match)
    try {
      if (statSync(abs).isFile()) files.add(match)
    } catch {
      /* raced with a write; a missing file is not an input */
    }
  }
}

// Sorted, so the digest depends on the content and not on directory order.
const hash = createHash('sha256')
for (const rel of [...files].sort()) {
  hash.update(rel)
  hash.update('\0')
  hash.update(readFileSync(join(root, rel)))
  hash.update('\0')
}
for (const extra of process.argv.slice(2)) {
  hash.update(extra)
  hash.update('\0')
}
console.log(hash.digest('hex').slice(0, 16))
