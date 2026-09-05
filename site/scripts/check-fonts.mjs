#!/usr/bin/env node
/**
 * The type is loaded before it is needed, on every page that shows text.
 *
 * Two failures this catches, both invisible in a green build.
 *
 * `font-display: block` hides text until its face arrives. That is the right
 * choice for a reference — a reflow mid-read costs more than the few hundred
 * milliseconds swapping saves — but it is only safe when the faces a page
 * opens with are preloaded, so they are fetched beside the critical CSS
 * rather than discovered when the CSS is parsed. gp-sphinx pairs the two
 * deliberately; this site had `block` on all thirty faces and preloaded ten
 * Sans and no Mono, so the monospace wordmark and every code block were
 * exactly the text `block` hid.
 *
 * The second is the mirror: a face preloaded and never used is bytes fetched
 * at the highest priority the browser has, ahead of the ones that are.
 *
 * Phase 1 is static and covers every page in the assembly. Phase 2 opens the
 * archetypes in a browser, because "which faces does this page open with" is
 * a rendering question that no amount of HTML grepping answers.
 *
 * Usage: node scripts/check-fonts.mjs [--site DIR] [--url BASE] [--json]
 */
import { existsSync, readFileSync } from 'node:fs'
import { globSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? fallback : process.argv[i + 1]
}
const SITE = resolve(arg('--site', join(HERE, '../../_site')))
const BASE = arg('--url', 'http://localhost:8080').replace(/\/$/, '')
const JSON_OUT = process.argv.includes('--json')

/** The two families every page is meant to render in. */
const FAMILIES = ['IBM Plex Sans', 'IBM Plex Mono']

/**
 * One page per kind of page.
 *
 * The preload list lives in one layout, so what it must cover is the union of
 * what these open with — not any single page. They are chosen to span the
 * layouts rather than the content: a reference entry and a topic differ in
 * what they put above the fold even though both are prose pages.
 */
const ARCHETYPES = [
  ['home', '/', true],
  ['port page', '/py/', true],
  ['reference entry', '/reference/py/libtmux-server/', true],
  ['reference index', '/reference/go/', true],
  ['symbol index', '/reference/symbols/p/', true],
  ['topic', '/topics/traversal/', true],
  ['example', '/examples/attach-and-send-keys/', true],
  // Sphinx builds this one and emits its own preloads. It is checked — a
  // vendored page still has to open with the type it declares — but its
  // preload list is gp-sphinx's to choose, so it does not vote on ours.
  ['vendored gp-sphinx', '/py/stable/api/api/libtmux.server/', false],
  // One reference entry per port. The layout is shared, but the content is
  // not: a C++ signature and a Go one reach for different faces, and the
  // goal is no missing text in *any* port rather than in the one that was
  // checked.
  ['ref py', '/reference/py/libtmux-_compat-legacyversion/', true],
  ['ref ts', '/reference/ts/builder-applywindowcontext/', true],
  ['ref rs', '/reference/rs/blocking-runtime/', true],
  ['ref go', '/reference/go/tmux-activityaction/', true],
  ['ref java', '/reference/java/io-github-libtmux-batch-batch-batch/', true],
  ['ref dotnet', '/reference/dotnet/libtmux-attachsessionrequest/', true],
  ['ref cxx', '/reference/cxx/libtmux-argumentsensitivity/', true],
  ['ref swift', '/reference/swift/calleridentity/', true],
  // A member's own page, which is a different shape from its type's: the type
  // lists its members, the member carries the signature. The italic type
  // annotations in a signature live only here, so an archetype list without
  // one reports Mono 400 italic as preloaded and unused.
  ['member py', '/reference/py/libtmux-server-wait_for/', true],
  ['member dotnet', '/reference/dotnet/libtmux-pane-clearhistoryasync/', true],
]

/**
 * A page with no text to style.
 *
 * The assembly emits redirect stubs — a `<meta refresh>`, a line of script and
 * one sentence nobody reads at a size nobody notices. Excluding them by name
 * would be a list that rots; excluding them by shape means the exclusion is
 * checked on every run. A page qualifies only if it redirects *and* carries
 * almost no prose, so a real page cannot fall into the exemption by having a
 * canonical link.
 */
function isRedirectStub(html) {
  const redirects = /http-equiv=["']?refresh/i.test(html) || /window\.location\.(href|replace)/.test(html)
  if (!redirects) return false
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length < 200
}

const failures = []
const notes = []

// ---------------------------------------------------------------- phase 1
if (!existsSync(SITE)) {
  console.error(`check-fonts: no assembly at ${SITE} — run scripts/build-site.sh`)
  process.exit(1)
}

const pages = globSync('**/*.html', { cwd: SITE })
let styled = 0
const stubs = []
const missing = []

for (const rel of pages) {
  const html = readFileSync(join(SITE, rel), 'utf8')
  if (isRedirectStub(html)) {
    stubs.push(rel)
    continue
  }
  const hasFaces = FAMILIES.every((f) => html.includes(f))
  /*
   * Every face of ours, not merely one somewhere on the page.
   *
   * This asked `/font-display:\s*block/.test(html)` — true if a single rule
   * anywhere carried it. Rewriting all thirty faces on a page to `swap` left
   * that assertion passing, because three unrelated declarations elsewhere
   * still said block. A check that nineteen faces can regress without
   * tripping is not checking those nineteen.
   */
  const blocks = [...html.matchAll(/@font-face\s*\{([^}]*)\}/g)]
    // The real webfonts only. `optimizedFallbacks` emits metric-matched
    // faces backed by `src: local(...)` whose family name also contains
    // "IBM Plex", and `swap` is right for those — they are never fetched, so
    // there is no load for `block` to wait on. Filtering on the family name
    // alone flagged all 1,714 pages.
    .filter((m) => m[1].includes('url(') && FAMILIES.some((f) => m[1].includes(f)))
    .every((m) => /font-display:\s*block/.test(m[1]))
  const preloads = /rel="preload"[^>]*as="font"/.test(html)
  if (hasFaces && blocks && preloads) styled++
  else missing.push({ page: rel, hasFaces, blocks, preloads })
}

notes.push(`${pages.length} pages: ${styled} styled, ${stubs.length} redirect stubs`)
if (missing.length) {
  const m = missing[0]
  failures.push(
    `${missing.length} page(s) render text without the full font setup, e.g. ${m.page} ` +
      `(families=${m.hasFaces} block=${m.blocks} preload=${m.preloads})`,
  )
}

// ---------------------------------------------------------------- phase 2
let usage = null
try {
  // Nothing served means the browser phase cannot run, which is not the same
  // as it failing. A fresh checkout and a CI job without `serve.sh` both land
  // here, and reporting eight "no response" failures would train a reader to
  // ignore this command's output.
  const reachable = await fetch(BASE, { method: 'HEAD' }).then((r) => r.ok).catch(() => false)
  if (!reachable) throw new Error(`nothing serving at ${BASE}`)
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  usage = []
  for (const [name, path, ours] of ARCHETYPES) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const response = await page.goto(BASE + path, { waitUntil: 'networkidle' }).catch(() => null)
    if (!response?.ok()) {
      failures.push(`${name}: ${path} returned ${response?.status() ?? 'no response'}`)
      await page.close()
      continue
    }
    await page.evaluate(() => document.fonts.ready)
    usage.push({ name, path, ours, ...(await page.evaluate(collect)) })
    await page.close()
  }
  await browser.close()
} catch (error) {
  notes.push(`browser checks skipped: ${error.message.split('\n')[0]}`)
}

/**
 * What this page asks for above the fold, and what it was given early.
 *
 * "Above the fold" is measured, not assumed: an element counts when its box
 * intersects the first viewport and it carries text of its own. Reading
 * `document.fonts` instead would report every face the whole document uses,
 * which is the list that over-preloading comes from.
 */
function collect() {
  const declared = []
  for (const sheet of document.styleSheets) {
    let rules
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    for (const rule of rules) {
      if (rule.constructor.name !== 'CSSFontFaceRule') continue
      const url = /url\(["']?([^"')]+)/.exec(rule.style.getPropertyValue('src'))
      // Resolved against the sheet that declared it, exactly as the preload
      // href is resolved against the document. The vendored gp-sphinx tree
      // writes both relative (`../../_static/fonts/…`), so comparing a raw
      // `src` against a resolved href reports every one of its faces as
      // un-preloaded — which it is not.
      const sheetBase = sheet.href ?? location.href
      declared.push({
        family: rule.style.getPropertyValue('font-family').replace(/["']/g, ''),
        weight: rule.style.getPropertyValue('font-weight') || '400',
        style: rule.style.getPropertyValue('font-style') || 'normal',
        url: url?.[1] ? new URL(url[1], sheetBase).pathname : null,
      })
    }
  }
  const preloaded = [...document.querySelectorAll('link[rel="preload"][as="font"]')].map((l) =>
    new URL(l.getAttribute('href'), location.href).pathname,
  )
  // What the preload actually cost, from the network rather than from disk:
  // a preloaded face is fetched at the highest priority the browser has, so
  // the number belongs beside the list it justifies.
  const bytes = performance
    .getEntriesByType('resource')
    .filter((e) => preloaded.includes(new URL(e.name).pathname))
    .reduce((n, e) => n + (e.encodedBodySize || e.transferSize || 0), 0)

  const fold = window.innerHeight
  const used = new Map()
  for (const el of document.querySelectorAll('body *')) {
    const box = el.getBoundingClientRect()
    if (box.top >= fold || box.bottom <= 0 || box.width === 0 || box.height === 0) continue
    // Text this element owns, not text inherited from a descendant — otherwise
    // <body> claims every face on the page.
    const owns = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (!owns) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue
    const family = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim()
    const key = `${family}|${cs.fontWeight}|${cs.fontStyle}`
    if (!used.has(key)) used.set(key, { family, weight: cs.fontWeight, style: cs.fontStyle })
  }
  return { declared, preloaded, bytes, used: [...used.values()] }
}

// The hashed family Astro emits (`IBM Plex Sans-eb55…`) is the same face as
// the name written in the config; compare on the readable half.
const base = (family) => FAMILIES.find((f) => family.startsWith(f)) ?? family
const label = (f) => `${base(f.family)} ${f.weight} ${f.style}`

if (usage) {
  const needed = new Map()
  const preloadedEverywhere = new Map()
  for (const page of usage) {
    const byUrl = new Map(page.declared.filter((d) => d.url).map((d) => [d.url, d]))
    for (const u of page.used) {
      if (!FAMILIES.some((f) => u.family.startsWith(f))) continue
      if (!needed.has(label(u))) needed.set(label(u), [])
      if (page.ours) needed.get(label(u)).push(page.name)
    }
    if (page.ours) {
      for (const p of page.preloaded) {
        const d = byUrl.get(p)
        if (d) preloadedEverywhere.set(label(d), true)
      }
    }
    // Per page: a face opened with but not preloaded is text `block` hides.
    const pre = new Set(page.preloaded.map((p) => byUrl.get(p)).filter(Boolean).map(label))
    const late = page.used
      .filter((u) => FAMILIES.some((f) => u.family.startsWith(f)))
      .map(label)
      .filter((l) => !pre.has(l))
    if (late.length) failures.push(`${page.name} (${page.path}): opens with un-preloaded ${late.join(', ')}`)
  }
  // Failed, not merely reported. A preloaded face nothing opens with is
  // fetched at the highest priority the browser has, ahead of the faces that
  // are holding the paint back behind the font gate.
  const wasted = [...preloadedEverywhere.keys()].filter((l) => !needed.get(l)?.length)
  if (wasted.length) failures.push(`preloaded but no archetype opens with it: ${wasted.join(', ')}`)
  // The justification list: every face, and the pages that open with it.
  // A preload entry with no page beside it has no reason to be on the list.
  notes.push('preload cost per archetype:')
  for (const page of usage)
    notes.push(`  ${page.name.padEnd(20)} ${String(page.preloaded.length).padStart(2)} faces  ${(page.bytes / 1024).toFixed(0).padStart(4)} KB`)
  notes.push('faces opened with, and by which archetype:')
  for (const [face, pages] of [...needed].sort())
    if (pages.length) notes.push(`  ${face.padEnd(28)} ${[...new Set(pages)].join(', ')}`)
}

if (JSON_OUT) {
  console.log(JSON.stringify({ notes, failures, usage }, null, 1))
} else {
  for (const n of notes) console.log(`check-fonts: ${n}`)
  if (failures.length) {
    console.error(`\ncheck-fonts: ${failures.length} problem(s):`)
    for (const f of failures) console.error(`  ${f}`)
  }
}
process.exit(failures.length ? 1 : 0)
