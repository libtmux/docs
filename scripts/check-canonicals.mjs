#!/usr/bin/env node
/*
 * Every reference page canonicalises to itself under the port's default
 * version.
 *
 * A reference lives under the version it documents, so its canonical follows
 * the rule the rest of a port's pages follow: the default version is the one
 * URL, and another version of the same page points at it. What is never
 * legitimate is pointing outside the port, or at a version that was not
 * built — `pagePath` was once composed from the symbol rather than from the
 * route, so every page in all eight ports declared a canonical without the
 * port segment, the same URL for any two ports sharing a symbol slug.
 *
 * Nothing caught it. The pages are noindex today, so no ranking moved; the
 * links in them all resolve, so check-links passed; and no test asserts a
 * canonical anywhere. It would have become live the moment `/reference/` was
 * promoted to indexable, which is the stated plan.
 *
 * Usage: node scripts/check-canonicals.mjs [site-dir]
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { referenceDirs } from './reference-trees.mjs'

const { PORTS: PORT_DEFS } = await import(`file://${join(dirname(fileURLToPath(import.meta.url)), '../site/src/lib/ports.ts')}`)
const PORTS = PORT_DEFS.map((p) => p.slug)

/**
 * Each port's default version, read from the tree that was built: a port
 * publishing one prefix is its own default, and Python's two make `stable`
 * the canonical one.
 */
const DEFAULTS = Object.fromEntries(PORTS.map((port) => {
  const built = referenceDirs(siteDir, port).map((dir) => dir.split('/').at(-2))
  return [port, built.includes('stable') ? 'stable' : built[0]]
}).filter(([, version]) => version))

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const defaultSite = join(repoRoot, '_site')
const siteDir = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? defaultSite
const LOCALE = process.env.LIBTMUX_DOCS_LOCALE ?? 'en'

if (!existsSync(siteDir)) {
  console.error(`check-canonicals: no site at ${siteDir} — run ./scripts/build-site.sh`)
  process.exit(1)
}

// A tree mid-assembly answers this question wrongly in both directions. Same
// kernel-exact test as check-edge-extensions and site/test/site-root.ts; kept
// inline because every script here is self-contained.
const lock = join(repoRoot, '.build.lock')
if (siteDir === defaultSite && existsSync(lock)) {
  let held = false
  try {
    execFileSync('flock', ['-n', lock, 'true'], { stdio: 'ignore' })
  } catch {
    held = true
  }
  if (held) {
    console.error(`check-canonicals: an assembly holds .build.lock — ${siteDir} is being written.`)
    process.exit(1)
  }
}

const roots = PORTS.flatMap((port) => referenceDirs(siteDir, port, { products: true }))
if (!roots.length) {
  console.error(`check-canonicals: no reference tree under ${siteDir}`)
  process.exit(1)
}

const pages = []
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full)
    else if (entry === 'index.html') pages.push(full)
  }
}
for (const root of roots) walk(root)

const CANONICAL = /<link\s+rel="canonical"\s+href="([^"]+)"/i
const wrong = []
let checked = 0

for (const file of pages) {
  const html = readFileSync(file, 'utf8')
  const found = html.match(CANONICAL)
  if (!found) {
    wrong.push({ file, want: '(a canonical)', got: 'none' })
    continue
  }
  // The canonical is a served URL and carries the locale segment; the path
  // below is relative to the site root, which is that segment. Strip it so the
  // two describe the same thing, and so this check reads the same on a tree
  // built with a prefix and one built without.
  const declared = new URL(found[1]).pathname.replace(new RegExp(`^/${LOCALE}/`), '/')
  // The page's own path, as served: the directory holding its index.html.
  const own = `${file.slice(siteDir.length, -'index.html'.length)}`
  // Its canonical twin: the same page under this port's default version.
  const [, port, version] = own.split('/')
  const want = DEFAULTS[port] && DEFAULTS[port] !== version
    ? own.replace(`/${port}/${version}/`, `/${port}/${DEFAULTS[port]}/`)
    : own
  checked += 1
  if (declared !== want) wrong.push({ file, want, got: declared })
}

if (wrong.length) {
  console.error(`check-canonicals: ${wrong.length} reference pages canonicalise somewhere other than themselves.`)
  for (const w of wrong.slice(0, 8)) {
    console.error(`  ${w.want}`)
    console.error(`    declares ${w.got}`)
  }
  if (wrong.length > 8) console.error(`  ... and more`)
  console.error(`\nThe reference tree carries no version and no locale, so a page here has`)
  console.error(`no other page to point at. Compose pagePath from the route, not the symbol.`)
  process.exit(1)
}

console.log(`check-canonicals: every reference page is canonical to itself (${checked} pages)`)
