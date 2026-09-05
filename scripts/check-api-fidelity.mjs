#!/usr/bin/env node
/**
 * Every reference entry carries what gp-sphinx gives one.
 *
 * Python is the only port with a gp-sphinx twin to compare against. The other
 * seven have none, so parity there cannot be a diff — it has to be the same
 * per-entry checks, asserted directly. A port rendering fewer affordances
 * than another is the failure this catches, and it is invisible to a link
 * checker because everything it emits is valid.
 *
 * Checked per entry:
 *   - a permalink, whose target is the entry's own id
 *   - a source link, wherever the model knows a file and line
 *   - the data hooks gp-sphinx's CSS and JS bind to, with real values
 *   - both layout variants, since the container query needs both to exist
 *
 * Usage: node scripts/check-api-fidelity.mjs <site-dir>
 */
import { readFileSync, globSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = process.argv[2]
// `root` above is the assembled site this run measures; the port list comes
// from the repository, which is a different place.
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
if (!root) {
  console.error('usage: check-api-fidelity.mjs <site-dir>')
  process.exit(2)
}

const { PORTS: PORT_DEFS } = await import(`file://${join(repoRoot, 'site/src/lib/ports.ts')}`)
const PORTS = PORT_DEFS.map((p) => p.slug)
const HOOKS = [
  'data-domain',
  'data-objtype',
  'data-badge-count',
  'data-has-badges',
  'data-has-source',
  'data-signature-expanded',
]

/**
 * Each `<dt class="… gp-sphinx-api-header" …>` with its attributes.
 *
 * Scanned with quote tracking rather than `<dt\s([^>]*)>`, because an
 * unescaped `>` inside an attribute value is valid HTML and this reference
 * has them: C++ emits `id="std::hash<libtmux::Pane>"` and Swift emits the
 * `>` comparison operator as a method name. The naive pattern truncated at
 * the first one and reported eight entries as missing every data hook they
 * in fact had.
 */
function entriesIn(html) {
  const out = []
  let i = 0
  while ((i = html.indexOf('<dt', i)) !== -1) {
    i += 3
    let quote = null
    let end = i
    while (end < html.length) {
      const ch = html[end]
      if (quote) {
        if (ch === quote) quote = null
      } else if (ch === '"' || ch === "'") {
        quote = ch
      } else if (ch === '>') {
        break
      }
      end++
    }
    const raw = html.slice(i, end)
    if (raw.includes('gp-sphinx-api-header')) {
      out.push(
        Object.fromEntries([...raw.matchAll(/([a-z-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])),
      )
    }
    i = end
  }
  return out
}

const failures = []
const summary = []

for (const port of PORTS) {
  const pages = globSync(`reference/${port}/**/index.html`, { cwd: root })
  if (!pages.length) {
    failures.push(`${port}: no reference pages built`)
    continue
  }

  let entries = 0
  let permalinks = 0
  let sources = 0
  let mobile = 0
  const missingHooks = new Map()
  const badPermalink = []

  for (const rel of pages) {
    const html = readFileSync(join(root, rel), 'utf8')
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))

    for (const attrs of entriesIn(html)) {
      entries++
      for (const hook of HOOKS) {
        if (attrs[hook] === undefined || attrs[hook] === '') {
          missingHooks.set(hook, (missingHooks.get(hook) ?? 0) + 1)
        }
      }
      if (attrs['data-has-source'] === 'true') sources++
      // A permalink is only useful if its fragment is on the page.
      if (attrs.id && !ids.has(attrs.id)) badPermalink.push(`${rel}#${attrs.id}`)
    }
    permalinks += (html.match(/class="headerlink"/g) ?? []).length
    mobile += (html.match(/gp-sphinx-api-layout--mobile/g) ?? []).length
  }

  // Two of each per entry: the desktop and mobile variants both carry the
  // affordances, and the container query shows exactly one.
  const expected = entries * 2
  if (permalinks !== expected) {
    failures.push(`${port}: ${permalinks} permalinks for ${entries} entries, expected ${expected}`)
  }
  if (mobile !== entries) {
    failures.push(`${port}: ${mobile} mobile layouts for ${entries} entries`)
  }
  for (const [hook, n] of missingHooks) {
    failures.push(`${port}: ${n} entries missing ${hook}`)
  }
  if (badPermalink.length) {
    failures.push(`${port}: ${badPermalink.length} permalinks to a missing id, e.g. ${badPermalink[0]}`)
  }

  const rate = entries ? Math.round((sources / entries) * 100) : 0
  summary.push({ port, pages: pages.length, entries, sources, rate })
  // A source link needs a file and a line, and not every extractor records
  // them for every symbol — a synthesised entry has nowhere to point. The
  // floor is what stops that becoming the normal case.
  if (rate < 90) {
    failures.push(`${port}: only ${rate}% of entries link to source (${sources}/${entries})`)
  }
}

console.log('port     pages  entries  source  rate')
for (const s of summary) {
  console.log(
    `${s.port.padEnd(8)} ${String(s.pages).padStart(5)}  ${String(s.entries).padStart(7)}  ${String(s.sources).padStart(6)}  ${String(s.rate).padStart(3)}%`,
  )
}

if (failures.length) {
  console.error(`\n${failures.length} fidelity failures:`)
  for (const f of failures) console.error(`  ${f}`)
  process.exit(1)
}
console.log('\nevery entry carries a permalink, its hooks and both layouts')
