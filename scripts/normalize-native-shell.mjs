#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Keep generated native shell assets inside the assembly's locale and preview. */
export function normalizeNativeShell(directory, prefix) {
  const root = prefix.replace(/\/+$/, '')
  let changed = 0
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      changed += normalizeNativeShell(path, root)
    } else if (/\.(html|css)$/.test(entry.name)) {
      const before = readFileSync(path, 'utf8')
      const after = before.replace(/(['"(])(?:https?:\/\/libtmux\.org)?\/_shell\//g, `$1${root}/_shell/`)
      if (after !== before) {
        writeFileSync(path, after)
        changed++
      }
    }
  }
  return changed
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, prefix] = process.argv.slice(2)
  if (!directory || !prefix?.startsWith('/')) throw new Error('Usage: normalize-native-shell.mjs DIRECTORY /LOCALE_PREFIX')
  console.log(`Native shell URLs: normalized ${normalizeNativeShell(directory, prefix)} HTML/CSS files`)
}
