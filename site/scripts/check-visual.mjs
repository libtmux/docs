#!/usr/bin/env node
/**
 * The reference does not change appearance by accident.
 *
 * `check-style-parity.mjs` asserts this site looks like gp-sphinx's, which is
 * the parity claim. This is the other half: that it goes on looking like
 * whatever it looks like now, so a change to a shared stylesheet or a
 * component shows up as a diff instead of as something noticed months later.
 *
 * Baselines are committed. A PNG in the tree is a strange thing to review,
 * but it is the only artefact that fails when a colour token is edited three
 * files away, and reviewing "this pixel moved" is the point.
 *
 * Three viewports, because the entry switches layout on its own inline size:
 * a wide one, one just inside the container query's 36rem threshold, and a
 * phone. A regression that only shows on a phone is still a regression.
 *
 * Usage: node scripts/check-visual.mjs [--update] [base-url]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

// Lives under site/ so `playwright` resolves from this package.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'test/baselines')
const update = process.argv.includes('--update')
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:8080'

/** One page per rendering path, not one per port: the component is shared. */
const PAGES = [
  ['py-class', '/reference/py/libtmux-server/'],
  // Rust carries the other prose path: fenced examples and `# Errors`
  // rubrics, which no Python docstring in this estate uses.
  ['rs-class', '/reference/rs/server-server/'],
  ['cxx-class', '/reference/cxx/libtmux-pane/'],
  ['swift-class', '/reference/swift/server/'],
  ['port-index', '/reference/go/'],
  ['symbol-index', '/reference/symbols/p/'],
]

const VIEWPORTS = [
  ['wide', 1440, 1000],
  ['narrow', 720, 1000],
  ['phone', 390, 900],
]

/** Anything above this many differing pixels is a regression, not noise. */
const TOLERANCE = 0.001

mkdirSync(dir, { recursive: true })
const browser = await chromium.launch()
const failures = []
let compared = 0
let written = 0

for (const [scheme] of [['light'], ['dark']]) {
  for (const [vname, width, height] of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width, height }, colorScheme: scheme })
    for (const [pname, path] of PAGES) {
      const name = `${pname}-${vname}-${scheme}.png`
      const file = join(dir, name)
      const response = await page.goto(base + path, { waitUntil: 'networkidle' })
      /*
       * Confirm this is the page that was asked for, before a single pixel is
       * written or compared.
       *
       * A screenshot of an error page is still a screenshot. Written as a
       * baseline under `--update` it locks the error in as correct, and every
       * later run passes against it — a check that cannot fail, which is the
       * third of those found in this repository.
       *
       * It is not hypothetical. An assembly running concurrently repopulates
       * `_site` one port at a time, so a page is briefly absent; a run during
       * one produced 18 regressions whose diffs turned out to be python's
       * "Error code: 404" page composited over the real one.
       */
      if (!response?.ok()) {
        failures.push(`${name}: ${path} returned ${response?.status() ?? 'no response'}`)
        continue
      }
      const heading = await page.textContent('h1').catch(() => null)
      if (!heading?.trim()) {
        failures.push(`${name}: ${path} rendered no heading — not treating it as ${pname}`)
        continue
      }
      // Fonts change metrics, and a screenshot taken before they land differs
      // from one taken after for reasons that have nothing to do with the CSS.
      await page.evaluate(() => document.fonts.ready)
      const shot = await page.screenshot({ clip: { x: 0, y: 0, width, height } })

      if (update || !existsSync(file)) {
        writeFileSync(file, shot)
        written++
        continue
      }
      const want = PNG.sync.read(readFileSync(file))
      const got = PNG.sync.read(shot)
      compared++
      if (want.width !== got.width || want.height !== got.height) {
        failures.push(`${name}: size changed ${want.width}x${want.height} -> ${got.width}x${got.height}`)
        continue
      }
      const diff = new PNG({ width: want.width, height: want.height })
      const changed = pixelmatch(want.data, got.data, diff.data, want.width, want.height, {
        threshold: 0.1,
      })
      const ratio = changed / (want.width * want.height)
      if (ratio > TOLERANCE) {
        const out = join(dir, name.replace(/\.png$/, '.diff.png'))
        writeFileSync(out, PNG.sync.write(diff))
        failures.push(`${name}: ${changed} pixels differ (${(ratio * 100).toFixed(2)}%) — see ${out}`)
      }
    }
    await page.close()
  }
}
await browser.close()

if (written) console.log(`${written} baselines written`)
if (compared) console.log(`${compared} screenshots compared`)
if (failures.length) {
  console.error(`\n${failures.length} visual regressions:`)
  for (const f of failures) console.error(`  ${f}`)
  console.error('\nIf the change is intended: node scripts/check-visual.mjs --update')
  process.exit(1)
}
if (compared) console.log('no visual change')
