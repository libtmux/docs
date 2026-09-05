#!/usr/bin/env node
/*
 * The edge function's file-versus-page test, held to what the build emits.
 *
 * `infra/cloudfront-function.js` decides "is this a file?" from an allowlist
 * of extensions and redirects anything else to a trailing-slash URL. Deciding
 * it by "contains a dot" instead is not equivalent — a version tag, a .NET
 * type name and a locale-tagged path all carry one — so the allowlist is the
 * right shape. A hand-kept one is not: a generator adding a file type breaks
 * a URL class with nothing reporting it.
 *
 * The failure this exists for is specific. `objects.inv` is how an external
 * Sphinx project resolves an intersphinx reference into this site. Absent from
 * the allowlist it is redirected to a trailing slash and 403s, and every
 * cross-reference from every other project stops resolving — while every link
 * check here still passes, because nothing in this repository links to it.
 *
 * Scope: this can only see what the tree in front of it emits. CI assembles
 * the shell alone, with no port checkouts, so a Sphinx or DocC file type is
 * absent there and cannot be caught until a full local assembly runs. The
 * check reports which allowlisted extensions the tree did not emit for that
 * reason — silence would read as full coverage.
 *
 * Usage: node scripts/check-edge-extensions.mjs [site-dir] [--function <path>]
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const fnIndex = args.indexOf('--function')
const fnPath = fnIndex === -1 ? join(repoRoot, 'infra', 'cloudfront-function.js') : args[fnIndex + 1]
const defaultSite = join(repoRoot, '_site')
const siteDir = args.find((a) => !a.startsWith('--') && a !== fnPath) ?? defaultSite

if (!existsSync(siteDir)) {
  console.error(`check-edge-extensions: no site at ${siteDir} — run ./scripts/build-site.sh`)
  process.exit(1)
}

/*
 * A tree being written cannot be measured, and this check cannot tell a file
 * type that is absent from one that has not been emitted yet — it would
 * report "allowlisted but not emitted", which reads as drift rather than as a
 * running build. `site/test/site-root.ts` guards its own suites the same way
 * and for the same reason; the rationale is written out there.
 *
 * Scoped to the default tree. An explicitly named directory is the caller's,
 * and the repository lock says nothing about whether they are writing it —
 * the negative test's fixtures are exactly that case.
 */
const lock = join(repoRoot, '.build.lock')
if (siteDir === defaultSite && existsSync(lock)) {
  let held = false
  try {
    execFileSync('flock', ['-n', lock, 'true'], { stdio: 'ignore' })
  } catch {
    held = true
  }
  if (held) {
    console.error(`check-edge-extensions: an assembly holds .build.lock — ${siteDir} is being written.`)
    console.error(`Re-run when it finishes; a half-populated tree cannot answer this question.`)
    process.exit(1)
  }
}

const source = readFileSync(fnPath, 'utf8')
const table = source.match(/const ASSET_EXTENSIONS = \{([\s\S]*?)\n\}/)
if (!table) {
  console.error(`check-edge-extensions: no ASSET_EXTENSIONS table in ${fnPath}`)
  process.exit(1)
}
const allowed = new Set([...table[1].matchAll(/([A-Za-z0-9_]+)\s*:\s*1/g)].map((m) => m[1].toLowerCase()))

/** Extensions actually present, and one example path each. */
const found = new Map()
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full)
      continue
    }
    // `dot === -1`, not `dot <= 0`: the function treats a leading dot as an
    // extension separator too, so `.buildinfo` is the extension `buildinfo`
    // there. Skipping dotfiles here made this check blind to exactly the file
    // class the function is most likely to redirect away from itself.
    const dot = entry.lastIndexOf('.')
    if (dot === -1) continue
    const ext = entry.slice(dot + 1).toLowerCase()
    if (!found.has(ext)) found.set(ext, full.slice(siteDir.length))
  }
}
walk(siteDir)

const missing = [...found.keys()].filter((e) => !allowed.has(e)).sort()
if (missing.length) {
  console.error(`check-edge-extensions: the edge function would redirect these away from their own files.`)
  for (const ext of missing) console.error(`  .${ext.padEnd(12)} e.g. ${found.get(ext)}`)
  console.error(`\nAdd them to ASSET_EXTENSIONS in ${fnPath.slice(repoRoot.length + 1)}.`)
  process.exit(1)
}

// An allowlisted extension the tree never emits is not a failure — a generator
// may be absent on this machine — but an allowlist that has drifted far from
// the tree is worth seeing, so say which are unused rather than staying quiet.
const unused = [...allowed].filter((e) => !found.has(e)).sort()
console.log(`check-edge-extensions: ${found.size} extensions in the tree, all allowlisted`)
if (unused.length) console.log(`  allowlisted but not emitted here: ${unused.join(' ')}`)
