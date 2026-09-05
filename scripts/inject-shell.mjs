#!/usr/bin/env node
// Cross-generator smoke test for the design-token bridge (see
// notes/research/03-design-token-bridge.md and notes/status.md, "Python and
// C++ are unskinned islands"). Run after scripts/build-site.sh.
//
// A generator upgrade (a new Furo release renaming a --color-* variable, a
// theme change dropping html_css_files entirely) can silently produce a
// page that LOOKS built — it has a title, it has content — while carrying
// none of the shared chrome. Nothing else in this build catches that: the
// page is not empty, so audit-site.mjs's content check passes, and the
// link crawl only follows hrefs, so it never notices that shell.js is
// simply absent. This script is the thing that walks the whole tree for
// that specific glitch, per status.md's "Tooling not built yet" ask.
//
// Checks, per self-hosted Sphinx port (site/src/lib/ports.ts is read
// directly — never hand-duplicate the port list here):
//
//   1. Every built <port>/<version>/api/ page's <head> carries a
//      libtmux-org.css link and a shell.js script tag pointing at the
//      real production URL.
//   2. The adapter stylesheet actually shipped to _static/ still imports
//      tokens.css from that same URL.
//   3. Every --color-* name the adapter maps FROM Furo actually exists in
//      that build's own generated CSS — the check that catches a Furo
//      upgrade renaming a variable out from under the mapping.
//   4. Every --lt-* name the adapter maps TO exists in our own
//      site/public/_shell/tokens.css — catches a typo on our side.
//   5. /_shell/tokens.css and /_shell/shell.js were actually published at
//      the site root (Astro's public/ passthrough can only be assumed
//      until it's been walked once).
//
// Usage:
//   node scripts/inject-shell.mjs [--site <dir>]
//
//   --site <dir>   Assembled site root (default: <repo>/_site, matching
//                   build-site.sh's own out_dir).
//
// Exits non-zero if any built reference page fails a check. A port with no
// built reference yet is reported as skipped, not failed — matching
// build-site.sh's own "absent toolchain is a skip" philosophy, since this
// script is meant to run against however much of the tree got built.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = dirname(here)
const siteLib = join(repoRoot, 'site', 'src', 'lib')

const { PORTS } = await import(`file://${join(siteLib, 'ports.ts')}`)

function parseArgs(argv) {
  const opts = { site: join(repoRoot, '_site') }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--site') opts.site = argv[++i]
  }
  return opts
}
const opts = parseArgs(process.argv.slice(2))

const SHELL_ORIGIN = 'https://libtmux.org'
const TOKENS_URL = `${SHELL_ORIGIN}/_shell/tokens.css`
const SHELL_JS_URL = `${SHELL_ORIGIN}/_shell/shell.js`
const ADAPTER_BASENAME = 'libtmux-org.css'

/** Strip /* ... *\/ comments before scanning for custom-property names —
 *  prose inside a comment (e.g. this very file's own header, or an
 *  adapter's "var(--lt-x, ...)" example) must never be mistaken for a
 *  real declaration or reference. */
function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Every --lt-* custom property this build's tokens.css actually declares. */
function readOwnTokenNames(siteDir) {
  const path = join(siteDir, '_shell', 'tokens.css')
  if (!existsSync(path)) return null
  const css = stripCssComments(readFileSync(path, 'utf8'))
  return new Set([...css.matchAll(/--lt-[a-z0-9-]+(?=\s*:)/gi)].map((m) => m[0]))
}

/** Concatenated text of every CSS file this port+version's Furo build emitted,
 *  excluding our own adapter — the ground truth for "does this variable
 *  still exist in this generator's output". */
function readGeneratedFuroCss(staticDir) {
  let combined = ''
  ;(function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ADAPTER_BASENAME) continue
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.name.endsWith('.css')) combined += readFileSync(p, 'utf8')
    }
  })(staticDir)
  return combined
}

function builtVersions(siteDir, slug) {
  const portDir = join(siteDir, slug)
  if (!existsSync(portDir)) return []
  return readdirSync(portDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(portDir, e.name, 'api', 'index.html')))
    .map((e) => e.name)
}

/** Every rendered page under a dirhtml build's api/ tree — not just the
 *  root index.html. A per-page html-page-context override (Sphinx allows
 *  add_css_file/add_js_file scoped to one page) would pass an index-only
 *  check while leaving other pages unskinned, which is exactly the kind of
 *  page that "looks built" the header comment above warns about. */
function apiPages(apiDir) {
  const pages = []
  ;(function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '_static' || entry.name === '_sources') continue
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.name === 'index.html') pages.push(p)
    }
  })(apiDir)
  return pages
}

const failures = []
const skipped = []
const checked = []

// --- Shared runtime artifacts actually published at the site root -------
for (const [name, url] of [
  ['/_shell/tokens.css', join(opts.site, '_shell', 'tokens.css')],
  ['/_shell/shell.js', join(opts.site, '_shell', 'shell.js')],
]) {
  if (!existsSync(url)) failures.push(`${name} was not published to the assembled site root`)
}

const ownTokenNames = readOwnTokenNames(opts.site)

// --- Per-port, per-version reference pages --------------------------------
const sphinxPorts = PORTS.filter((p) => p.renderer === 'sphinx')
for (const port of sphinxPorts) {
  const versions = builtVersions(opts.site, port.slug)
  if (versions.length === 0) {
    skipped.push(`${port.slug}: no built reference under ${join(opts.site, port.slug)}`)
    continue
  }

  for (const version of versions) {
    const apiDir = join(opts.site, port.slug, version, 'api')
    const label = `${port.slug}/${version}`

    // A meta-refresh redirect stub (e.g. Furo's own search.html, overridden
    // to bounce to the shell's Pagefind search — notes/status.md, "Sphinx's
    // own search page is a dead end") never renders content and correctly
    // carries no chrome; audit-site.mjs excludes the same pages from its own
    // checks by the same marker string.
    const pages = apiPages(apiDir).filter(
      (p) => !readFileSync(p, 'utf8').includes('You should have been redirected'),
    )
    let pagesMissingLink = 0
    let pagesMissingScript = 0
    for (const pagePath of pages) {
      const html = readFileSync(pagePath, 'utf8')
      if (!html.includes(ADAPTER_BASENAME)) pagesMissingLink += 1
      if (!html.includes(SHELL_JS_URL)) pagesMissingScript += 1
    }
    if (pagesMissingLink > 0) {
      failures.push(
        `${label}: ${pagesMissingLink}/${pages.length} page(s) have no ${ADAPTER_BASENAME} link in <head>`,
      )
    }
    if (pagesMissingScript > 0) {
      failures.push(
        `${label}: ${pagesMissingScript}/${pages.length} page(s) have no <script src="${SHELL_JS_URL}">`,
      )
    }

    const adapterPath = join(apiDir, '_static', ADAPTER_BASENAME)
    if (!existsSync(adapterPath)) {
      failures.push(`${label}: html_css_files references ${ADAPTER_BASENAME} but it was not copied to _static/`)
      continue
    }
    const adapterCss = readFileSync(adapterPath, 'utf8')

    if (!adapterCss.includes(`@import url('${TOKENS_URL}')`) && !adapterCss.includes(`@import url("${TOKENS_URL}")`)) {
      failures.push(`${label}: ${ADAPTER_BASENAME} does not @import ${TOKENS_URL}`)
    }

    // Comments (e.g. this adapter's own header, which uses "--lt-x" as a
    // prose placeholder) must never be mistaken for a real declaration or
    // reference — every regex scan below runs against comment-stripped text.
    const adapterCssCode = stripCssComments(adapterCss)

    // Every Furo variable the adapter writes into must still exist in this
    // build's own generated CSS — the check that catches a generator
    // upgrade silently renaming or dropping a --color-* token.
    const mappedFuroNames = new Set(
      [...adapterCssCode.matchAll(/--color-[a-z0-9-]+(?=\s*:)/gi)].map((m) => m[0]),
    )
    const generatedCss = readGeneratedFuroCss(join(apiDir, '_static'))
    for (const name of mappedFuroNames) {
      if (!generatedCss.includes(name)) {
        failures.push(
          `${label}: adapter maps ${name}, but no CSS file this build generated declares it ` +
            '(a Furo/theme upgrade likely renamed or dropped it)',
        )
      }
    }

    // Every --lt-* name the adapter reads must exist in our own tokens.css
    // — catches a typo on our side rather than upstream's.
    if (ownTokenNames) {
      const referencedLtNames = new Set(
        [...adapterCssCode.matchAll(/--lt-[a-z0-9-]+/gi)].map((m) => m[0]),
      )
      for (const name of referencedLtNames) {
        if (!ownTokenNames.has(name)) {
          failures.push(`${label}: adapter references ${name}, which tokens.css does not declare`)
        }
      }
    }

    checked.push(`${label} (${pages.length} page${pages.length === 1 ? '' : 's'})`)
  }
}

// --- Report ----------------------------------------------------------------
console.log(`shell injection check: ${checked.length} version build(s) checked, ${sphinxPorts.length} sphinx port(s) known`)
for (const s of skipped) console.log(`  skip  ${s}`)
for (const c of checked) console.log(`  ok    ${c}`)
if (failures.length > 0) {
  console.log(`\n${failures.length} failure(s):`)
  for (const f of failures) console.log(`  FAIL  ${f}`)
  process.exit(1)
}
console.log('\nall checks passed')
