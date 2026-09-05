#!/usr/bin/env node
/**
 * Every internal link lands on something that exists.
 *
 * Astro reports a successful build for a page full of hrefs to nowhere, so
 * this is the only thing that says otherwise. Fragments are checked as well
 * as pages, which is the half that matters for a reference: 33 of 266 API
 * link targets once pointed at type pages whose heading carried no id, and
 * the build, the type-checker and the dangling report were all silent about
 * it — every page existed, so nothing was wrong except where the reader
 * landed.
 *
 * Usage: node scripts/check-links.mjs <site-dir> [--all]
 *
 * Without --all only `class="api-mention"` links are checked, which is the
 * fast path after a reference change and is meaningful against any build.
 *
 * --all checks every internal href and is only meaningful against a full
 * assembly: every port-and-version path like `/py/stable/` is produced by a
 * different `astro build`, so a root-only build reports thousands of them
 * missing and is right to.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { globSync } from 'node:fs'

const root = process.argv[2]
const all = process.argv.includes('--all')

/**
 * Output trees written by a generator this repo does not control.
 *
 * A broken link is reported wherever it comes from, but only one this repo
 * could have prevented decides the exit status. The distinction is the source
 * page, never the target: every broken target here lives under `/reference/`,
 * including the ones Sphinx and docfx produce, so a target-based rule would
 * fail this build for their bugs.
 *
 * It was a blanket warning before, on the grounds that "the generated
 * references are upstream output this repo does not control". That was true
 * of Sphinx and docfx and was never true of `/reference/`, which this repo
 * generates — so the one class worth failing on was the one class excused.
 */
const vendored = process.argv
  .map((arg, i) => (arg === '--vendored' ? process.argv[i + 1] : undefined))
  .filter((v) => typeof v === 'string')
  .map((v) => v.replace(/^\/+/, '').replace(/\/*$/, '/'))

const isVendored = (page) => vendored.some((prefix) => page.startsWith(prefix))
if (!root) {
  console.error('usage: check-links.mjs <site-dir> [--all]')
  process.exit(2)
}

const pages = globSync('**/*.html', { cwd: root })
const ids = new Map()
const idsOf = (page) => {
  if (!ids.has(page)) {
    let text
    try {
      text = readFileSync(join(root, page), 'utf8')
    } catch {
      ids.set(page, undefined)
      return undefined
    }
    ids.set(page, new Set([...text.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])))
  }
  return ids.get(page)
}

const pattern = all
  ? /href="([^"#]*)(?:#([^"]*))?"/g
  : /href="([^"#]*)#([^"]+)"\s+class="api-mention"/g

/**
 * A URI scheme, which means the link leaves the site.
 *
 * Tested as a scheme rather than "contains a colon": C++ paths are full of
 * them — `/reference/cxx/libtmux::window/` — and excluding any colon quietly
 * dropped every C++ link from the check, 30 of them, while still reporting
 * zero broken.
 */
const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i

/**
 * Resolve an href against the page that holds it.
 *
 * Relative links have to be followed, not skipped. Checking only
 * `href="/..."` reported zero broken links across 327,754 of them while
 * `../genindex.md` — written by a Sphinx extension, one directory up from a
 * page that exists — was a 404 on every Python reference page. A checker that
 * quietly ignores a whole syntax is worse than none, because its zero is
 * believed.
 */
function resolveHref(fromPage, href) {
  if (href.startsWith('/')) return href.slice(1)
  const base = fromPage.split('/').slice(0, -1)
  for (const part of href.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') base.pop()
    else base.push(part)
  }
  return base.join('/')
}

let checked = 0
const broken = []
for (const page of pages) {
  const html = readFileSync(join(root, page), 'utf8')
  for (const m of html.matchAll(pattern)) {
    const [, path, anchor] = m
    if (path.startsWith('//') || EXTERNAL.test(path) || (!path && !anchor)) continue
    // A bare fragment points into the page it is written on.
    if (!path) {
      checked++
      if (anchor && !idsOf(page)?.has(anchor)) broken.push({ page, path: '', anchor, why: 'no anchor' })
      continue
    }
    checked++
    // The trailing slash has to come from the href, not from the resolved
    // path: `..` and `.` segments are dropped while joining, so
    // `../libtmux.pane/` and `../libtmux.pane` resolve identically and only
    // the first one means a directory.
    // A cache-busting query is not part of the path on a static site.
    const clean = path.replace(/\?.*$/, '')
    const resolved = resolveHref(page, clean)
    const target = clean.endsWith('/') || resolved === '' ? `${resolved}/index.html`.replace(/^\//, '') : resolved
    const targetIds = idsOf(target)
    if (targetIds === undefined) broken.push({ page, path, anchor, why: 'no page' })
    else if (anchor && !targetIds.has(anchor)) broken.push({ page, path, anchor, why: 'no anchor' })
  }
}

const ours = broken.filter((b) => !isVendored(b.page))
console.log(
  `${pages.length} pages, ${checked} links checked, ${broken.length} broken` +
    (vendored.length ? ` (${ours.length} from pages this repo generates)` : ''),
)

// Grouped by target, because one missing page is usually one mistake
// repeated across a thousand navs — a flat list of 5,459 lines hides which
// three things are actually wrong.
const byTarget = new Map()
for (const b of broken) {
  const key = `${b.why}\t${b.path}${b.anchor ? '#' + b.anchor : ''}`
  const seen = byTarget.get(key) ?? { count: 0, from: b.page }
  seen.count++
  byTarget.set(key, seen)
}
const targets = [...byTarget].sort((a, b) => b[1].count - a[1].count)
console.log(`${targets.length} distinct broken targets`)
for (const [key, { count, from }] of targets.slice(0, 30)) {
  const [why, target] = key.split('\t')
  console.log(`  ${String(count).padStart(5)}x  ${why.padEnd(9)} ${target}`)
  console.log(`         e.g. from ${from}`)
}
if (targets.length > 30) console.log(`  ... and ${targets.length - 30} more targets`)
if (vendored.length && broken.length && ours.length === 0) {
  console.log(
    '\nall of them come from a vendored generator\'s own output; ' +
      'reported, but not this build\'s to fail on',
  )
}
process.exit(ours.length ? 1 : 0)
