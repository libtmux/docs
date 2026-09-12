#!/usr/bin/env node
/**
 * The mobile toolbar and its two drawers, in every permutation.
 *
 * This shell renders a sticky toolbar below 1024px with a navigation drawer
 * and, when the page has headings, a contents drawer. Four things about it
 * were wrong at once and none was visible in a build:
 *
 * - It rendered at every width. Astro scopes a component's own rule to
 *   `.mobile-toolbar[data-astro-cid-…]`, specificity (0,2,0) against
 *   Tailwind's `.lg\:hidden` at (0,1,0), so the utility never won and a
 *   hamburger sat above the three-column desktop layout on 394 pages.
 * - Neither toggle carried `aria-expanded`.
 * - An open drawer never received focus, and a closed one stayed in the tab
 *   order — tabbing walked into an invisible menu.
 * - Widening past the breakpoint hid the drawer and left `body` scroll-locked,
 *   with no visible control to release it.
 *
 * Run against a served assembly. Needs the pages built, so it lives with the
 * visual checks rather than the unit tests.
 *
 * Usage: node scripts/check-mobile-nav.mjs [base-url]
 */
import { chromium } from 'playwright'
const BASE = (process.argv[2] ?? 'http://localhost:8080').replace(/\/$/, '')
const b = await chromium.launch()
const fails = [], ok = []
const note = (pass, msg) => (pass ? ok : fails).push(msg)
const WITH_TOC = '/topics/traversal/', NO_TOC = '/concepts/'
const ctx = await b.newContext()
async function page(path, w = 390) {
  const p = await ctx.newPage()
  await p.setViewportSize({ width: w, height: 800 })
  await p.goto(BASE + path, { waitUntil: 'networkidle' })
  return p
}
const openState = (p, id, closedClass) => p.evaluate(([i, c]) => {
  const el = document.getElementById(i)
  return !!el && !el.classList.contains(c)
}, [id, closedClass])

// aria-expanded
{
  const p = await page(WITH_TOC), t = p.locator('#mobile-sidebar-toggle')
  note((await t.getAttribute('aria-expanded')) === 'false', 'aria-expanded=false when closed')
  await t.click(); await p.waitForTimeout(250)
  note((await t.getAttribute('aria-expanded')) === 'true', 'aria-expanded=true when open')
  await p.keyboard.press('Escape'); await p.waitForTimeout(250)
  note((await t.getAttribute('aria-expanded')) === 'false', 'aria-expanded back to false after Escape')
  await p.close()
}
// focus in, and back — asserted only after confirming it actually entered
{
  const p = await page(WITH_TOC)
  await p.locator('#mobile-sidebar-toggle').click(); await p.waitForTimeout(300)
  const inside = await p.evaluate(() => !!document.getElementById('mobile-sidebar')?.contains(document.activeElement))
  note(inside, 'focus moves into the sidebar drawer on open')
  if (inside) {
    await p.keyboard.press('Escape'); await p.waitForTimeout(300)
    note(await p.evaluate(() => document.activeElement?.id === 'mobile-sidebar-toggle'), 'focus returns to the toggle')
  } else fails.push('focus return untestable — focus never entered')
  await p.close()
}
// closed drawer not reachable
{
  const p = await page(WITH_TOC)
  const reachable = await p.evaluate(() => {
    const a = document.getElementById('mobile-sidebar')?.querySelector('a')
    if (!a) return false
    a.focus(); return document.activeElement === a
  })
  note(!reachable, 'closed drawer is not focusable')
  await p.close()
}
// scroll lock released across the breakpoint
{
  const p = await page(WITH_TOC)
  await p.locator('#mobile-sidebar-toggle').click(); await p.waitForTimeout(250)
  await p.setViewportSize({ width: 1440, height: 900 }); await p.waitForTimeout(400)
  note(!(await p.evaluate(() => document.body.style.overflow === 'hidden')), 'scroll lock released when resized to desktop')
  await p.close()
}
// with one drawer open, the toolbar behind it is not reachable
{
  const p = await page(WITH_TOC)
  await p.locator('#mobile-sidebar-toggle').click(); await p.waitForTimeout(300)
  note(await openState(p, 'mobile-sidebar', '-translate-x-full'), 'sidebar opened (precondition)')
  const covered = await p.evaluate(() => {
    const btn = document.getElementById('mobile-toc-toggle')
    const r = btn.getBoundingClientRect()
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return !btn.contains(top) && top !== btn
  })
  note(covered, 'contents button is covered by the overlay while the sidebar is open')
  await p.close()
}
// and if both are ever opened programmatically, the first closes
{
  const p = await page(WITH_TOC)
  await p.locator('#mobile-sidebar-toggle').click(); await p.waitForTimeout(250)
  note(await openState(p, 'mobile-sidebar', '-translate-x-full'), 'sidebar opened (precondition)')
  await p.evaluate(() => document.getElementById('mobile-toc-toggle').click())
  await p.waitForTimeout(300)
  const tOpen = await openState(p, 'mobile-toc', 'translate-x-full')
  const sStill = await openState(p, 'mobile-sidebar', '-translate-x-full')
  note(tOpen, 'contents opened (precondition)')
  note(tOpen && !sStill, 'opening contents closes the sidebar')
  await p.close()
}
// no-ToC page
{
  const p = await page(NO_TOC)
  note((await p.locator('#mobile-toc-toggle').count()) === 0, 'no contents button without headings')
  await p.locator('#mobile-sidebar-toggle').click(); await p.waitForTimeout(250)
  note(await openState(p, 'mobile-sidebar', '-translate-x-full'), 'sidebar opens on a page with no contents')
  await p.close()
}
// breakpoint
for (const [w, want] of [[360, true], [390, true], [768, true], [1023, true], [1024, false], [1440, false]]) {
  const p = await page(WITH_TOC, w)
  const visible = await p.locator('.mobile-toolbar').isVisible()
  note(visible === want, `toolbar ${want ? 'visible' : 'hidden'} at ${w}px`)
  await p.close()
}
// Reference navigation shares one disclosure, including the port's product menu.
for (const path of ['/reference/go/', '/reference/py/libtmux-server/']) {
  const p = await page(path)
  const menu = p.locator('.api-sidebar__menu')
  const contents = p.locator('.api-toc-shell')
  note(!(await menu.isVisible()), `${path}: phone product menu starts collapsed`)
  note((await p.locator('h1').boundingBox())?.y < 320, `${path}: phone heading stays above the fold`)
  await contents.locator(':scope > summary').click()
  note(await menu.isVisible(), `${path}: opening navigation exposes the product menu`)
  note(await menu.getByRole('link', { name: 'Workspace Manager', exact: true }).isVisible(),
    `${path}: workspace remains reachable from reference navigation`)
  await contents.locator(':scope > summary').click()
  await p.setViewportSize({ width: 1440, height: 900 })
  await p.waitForFunction(() => document.querySelector('.api-toc-shell').open, null, { timeout: 1000 }).catch(() => {})
  note(await menu.isVisible(), `${path}: widening restores the product menu`)
  note(await contents.getAttribute('open') !== null, `${path}: widening restores the symbol tree`)
  await p.setViewportSize({ width: 390, height: 800 })
  await p.waitForFunction(() => !document.querySelector('.api-toc-shell').open, null, { timeout: 1000 }).catch(() => {})
  note(!(await menu.isVisible()), `${path}: narrowing collapses the product menu`)
  await p.close()
}
for (const width of [390, 1440]) {
  const p = await page(WITH_TOC, width)
  await p.keyboard.press('Control+k')
  await p.locator('#search-modal input[type="search"]').fill('workspace')
  const results = p.locator('#search-modal .search-panel__results')
  await results.locator('a').first().waitFor()
  const box = await results.boundingBox()
  const dialog = await p.locator('#search-modal').boundingBox()
  note(box && dialog && box.y + box.height <= dialog.y + dialog.height,
    `search results fit inside the dialog at ${width}px`)
  if (box) {
    await p.mouse.move(box.x + box.width / 2, box.y + Math.min(50, box.height / 2))
    await p.mouse.wheel(0, 500)
    await p.waitForTimeout(150)
    note(await results.evaluate((el) => el.scrollTop > 0), `search results scroll at ${width}px`)
  }
  await p.close()
}
console.log(`check-mobile-nav: ${ok.length} checks passed`)
if (fails.length) {
  console.error(`\ncheck-mobile-nav: ${fails.length} failure(s):`)
  for (const f of fails) console.error('  ' + f)
}
await b.close()
process.exit(fails.length ? 1 : 0)
