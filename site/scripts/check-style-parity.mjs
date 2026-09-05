#!/usr/bin/env node
/**
 * The reference looks like gp-sphinx's, asserted rather than eyeballed.
 *
 * Both pages describe `libtmux.Server`, from the same tree: gp-sphinx renders
 * it at `/py/stable/api/api/libtmux.server/` and this site at
 * `/reference/py/libtmux-server/`. That coincidence is the only oracle
 * available — the other seven ports have no gp-sphinx twin — so it is worth
 * using precisely.
 *
 * Computed styles, not pixels. The two pages hold different amounts of text
 * and always will, so a screenshot diff between them measures content rather
 * than design. What has to match is the treatment of equivalent elements: the
 * card, the header band, the signature name, the badges, the field-list
 * labels. Pixel regressions against this site's own baselines are
 * `check-visual.mjs`.
 *
 * Usage: node scripts/check-style-parity.mjs [base-url]
 */
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:8080'
const SPHINX = `${base}/py/stable/api/api/libtmux.server/`
/*
 * A member's page, not the type's.
 *
 * The entry treatments this compares — `dl.py.method`, its signature, its
 * field list — used to render on the type's page, inlined under it. Every
 * symbol has its own page now, so the type page lists its members and the
 * entry lives one level down. The selectors did not change; the URL that
 * shows them did, and pointing at the old one reported all seven treatments
 * as "not found on this site" rather than as different.
 */
const OURS = `${base}/reference/py/libtmux-server-new_session/`

/*
 * A second page, because a page is now one symbol.
 *
 * Two of the eight treatments compare an `attribute` entry and the rest a
 * `method`. They used to share a page — every member of `Server` rendered on
 * it — and now each symbol has its own, so no single URL carries both. A case
 * names the page it needs; the default is the method page.
 */
const OURS_ATTRIBUTE = `${base}/reference/py/libtmux-_internal-constants-hooks-after_capture_pane/`

/**
 * Equivalent elements, and the properties that carry the look.
 *
 * Selectors differ because the two pages are not required to share markup —
 * only appearance. Where they do share it, that is because this site adopted
 * gp-sphinx's structure to reuse its stylesheet, not because the brief
 * demanded it.
 */
const CASES = [
  {
    /*
     * A floor, not a match.
     *
     * This compared widths exactly, to catch the content column running a
     * third wider than gp-sphinx's. That ceiling is gone on instruction —
     * "chill out with the narrow page layouts, use the screen real estate
     * given" — and a reference page now fills the shell it reserves.
     *
     * What is still worth asserting is the other direction: the column must
     * never be *narrower* than gp-sphinx's, which is the cramped-measure
     * defect this case was really guarding against. Everything else here
     * compares colour, spacing and type, and none of it would notice.
     */
    name: 'content measure',
    sphinx: '.content',
    ours: 'main > div:nth-child(2)',
    props: ['width'],
    atLeast: true,
  },
  {
    name: 'entry card',
    page: 'attribute',
    sphinx: 'dl.py.attribute',
    ours: 'dl.py.attribute',
    props: ['borderTopWidth', 'borderTopColor', 'borderRadius', 'marginBottom'],
  },
  {
    name: 'header band',
    page: 'attribute',
    sphinx: 'dl.py.attribute > dt',
    ours: 'dl.py.attribute > dt',
    props: ['backgroundColor', 'borderBottomColor', 'paddingTop', 'paddingBottom', 'minHeight'],
  },
  {
    name: 'signature name',
    sphinx: 'dl.py.method > dt .sig-name',
    ours: 'dl.py.method > dt .sig-name',
    props: ['color', 'fontWeight', 'fontFamily'],
  },
  {
    name: 'signature punctuation',
    sphinx: 'dl.py.method > dt .sig-paren',
    ours: 'dl.py.method > dt .sig-paren',
    props: ['color'],
  },
  {
    name: 'description body',
    sphinx: 'dl.py.method > dd',
    ours: 'dl.py.method > dd',
    props: ['paddingTop', 'paddingLeft', 'marginLeft'],
  },
  {
    name: 'field list',
    sphinx: 'dl.py.method > dd dl.field-list',
    ours: 'dl.py.method > dd dl.field-list',
    props: ['display', 'gridTemplateColumns', 'borderTopWidth'],
  },
  {
    name: 'field label',
    sphinx: 'dl.py.method > dd dl.field-list > dt',
    ours: 'dl.py.method > dd dl.field-list > dt',
    props: ['textTransform', 'letterSpacing', 'color', 'fontWeight'],
  },
]

/** Properties whose value is a length that legitimately tracks the base font. */
const NEAR = new Set(['paddingTop', 'paddingBottom', 'paddingLeft', 'marginBottom', 'marginLeft', 'minHeight', 'borderRadius', 'letterSpacing'])

/** A measure within a few characters of gp-sphinx's reads the same. */
const WIDTH_TOLERANCE_PX = 12

const px = (v) => (/^-?[\d.]+px$/.test(v) ? Number.parseFloat(v) : null)

/**
 * Compare the typeface, not the name it was registered under.
 *
 * Astro fingerprints self-hosted families — `IBM Plex Mono-b57a2d6ac89c9825` —
 * so a byte comparison reports a difference between two pages rendering in the
 * identical typeface. What matters is which face the reader sees.
 */
const family = (v) =>
  v
    .split(',')[0]
    .replace(/["']/g, '')
    .replace(/-[0-9a-f]{8,}$/, '')
    .trim()
    .toLowerCase()

/**
 * A resolved `grid-template-columns` is measured, not declared: `max-content`
 * becomes whatever the content needed. Two pages with different text always
 * differ. The design question is how many columns there are.
 */
const columns = (v) => v.trim().split(/\s+/).length

async function styles(page, url, cases, side) {
  await page.goto(url, { waitUntil: 'networkidle' })
  return page.evaluate(
    ([cases, side]) =>
      cases.map((c) => {
        const el = document.querySelector(c[side])
        if (!el) return { name: c.name, missing: true }
        const cs = getComputedStyle(el)
        return { name: c.name, props: Object.fromEntries(c.props.map((p) => [p, cs[p]])) }
      }),
    [cases, side],
  )
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const sphinx = await styles(page, SPHINX, CASES, 'sphinx')
/*
 * Two visits, one array.
 *
 * `styles` returns results positionally against the cases it was given, and
 * the comparison below reads `sphinx[i]` against `ours[i]` over CASES — so the
 * two runs have to be stitched back into that order rather than merged. A
 * spread of two arrays into an object loses the indices silently, which is
 * how this first reported "cannot read properties of undefined".
 */
const methodCases = CASES.filter((c) => c.page !== 'attribute')
const attributeCases = CASES.filter((c) => c.page === 'attribute')
const fromMethod = await styles(page, OURS, methodCases, 'ours')
const fromAttribute = await styles(page, OURS_ATTRIBUTE, attributeCases, 'ours')
const ours = CASES.map((c) =>
  c.page === 'attribute'
    ? fromAttribute[attributeCases.indexOf(c)]
    : fromMethod[methodCases.indexOf(c)],
)
await browser.close()

const problems = []
for (const [i, c] of CASES.entries()) {
  const a = sphinx[i]
  const b = ours[i]
  if (a.missing) {
    // The oracle not having the element is information, not a pass.
    problems.push(`${c.name}: not found on the gp-sphinx page (selector "${c.sphinx}")`)
    continue
  }
  if (b.missing) {
    problems.push(`${c.name}: not found on this site (selector "${c.ours}")`)
    continue
  }
  for (const prop of c.props) {
    const want = a.props[prop]
    const got = b.props[prop]
    if (want === got) continue
    // gp-sphinx's base font is 16.4px against this site's 16, so every length
    // derived from it differs by ~2.5%. A length within a pixel is the same
    // decision expressed against a different root, not a different design.
    if (prop === 'width') {
      const w = px(want)
      const g = px(got)
      if (w !== null && g !== null) {
        if (c.atLeast) {
          if (g + WIDTH_TOLERANCE_PX >= w) continue
          problems.push(`${c.name}.${prop}: narrower than gp-sphinx — ${got} against ${want}`)
          continue
        }
        if (Math.abs(w - g) <= WIDTH_TOLERANCE_PX) continue
      }
    }
    if (prop === 'fontFamily' && family(want) === family(got)) continue
    if (prop === 'gridTemplateColumns' && columns(want) === columns(got)) continue
    const w = px(want)
    const g = px(got)
    if (NEAR.has(prop) && w !== null && g !== null && Math.abs(w - g) <= 1) continue
    problems.push(`${c.name}.${prop}: gp-sphinx=${want}  ours=${got}`)
  }
}

console.log(`${CASES.length} element treatments compared`)
if (problems.length) {
  console.error(`\n${problems.length} differences:`)
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
console.log('every compared treatment matches')
