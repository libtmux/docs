import { newCheckPage } from './browser-context.mjs'
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://127.0.0.1:53972/'
const browser = await chromium.launch()
const page = await newCheckPage(browser, url, { viewport: { width: 1280, height: 900 }, colorScheme: 'dark' })
await page.addInitScript(() => {
  window.__shifts = []
  window.__phase = 'load'
  const name = (n) => {
    const e = n instanceof Element ? n : n?.parentElement
    if (!e) return '?'
    const path = []
    for (let x = e; x && path.length < 4; x = x.parentElement) path.push(`${x.tagName.toLowerCase()}${x.classList.length ? '.' + [...x.classList].slice(0, 2).join('.') : ''}${[...x.attributes].filter((a) => a.name.startsWith('data-') && !a.name.startsWith('data-astro')).slice(0, 1).map((a) => `[${a.name}=${a.value.slice(0, 12)}]`).join('')}`)
    return path.join(' < ')
  }
  const observer = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      window.__shifts.push({
        t: Math.round(e.startTime), v: Number(e.value.toFixed(5)), input: e.hadRecentInput, phase: window.__phase,
        src: e.sources.slice(0, 4).map((s) => `${name(s.node)} dy=${Math.round(s.currentRect.y - s.previousRect.y)} dh=${Math.round(s.currentRect.height - s.previousRect.height)}`),
      })
    }
  })
  observer.observe({ type: 'layout-shift', buffered: true })
})
await page.goto(url, { timeout: 60000 })
await page.waitForTimeout(3000)
const show = page.locator('[data-core-showcase]').first()
await show.scrollIntoViewIfNeeded()
await page.waitForTimeout(800)
const height = () => page.evaluate(() => Math.round(document.querySelector('[data-core-showcase]').getBoundingClientRect().height))
const heights = { start: await height() }
const targets = await show.evaluate((root) => {
  const attrs = new Set()
  for (const el of root.querySelectorAll('*')) for (const a of el.getAttributeNames()) if (a.startsWith('data-')) attrs.add(a)
  return [...attrs]
})
console.log('data attributes', targets.join(' '))
const tabs = ['typed-graph', 'watch', 'run-applications']
for (const id of tabs) {
  await page.evaluate((phase) => { window.__phase = phase }, `${id}:select`)
  await show.locator(`[data-capability-option="${id}"]`).click()
  await page.waitForTimeout(900)
  heights[`${id}:select`] = await height()
  const panel = show.locator(`[data-capability-panel="${id}"]`)
  await page.evaluate((phase) => { window.__phase = phase }, `${id}:hover`)
  const calls = panel.locator('.ec-line.is-call')
  console.log(id, 'hover targets', await calls.count())
  const n = Math.min(await calls.count(), 12)
  for (let i = 0; i < n; i++) {
    await calls.nth(i).hover({ force: true })
    await page.waitForTimeout(250)
    heights[`${id}:hover${i}`] = await height()
  }
  await page.mouse.move(5, 5)
  await page.waitForTimeout(300)
  await page.evaluate((phase) => { window.__phase = phase }, `${id}:step`)
  const marks = panel.locator('[data-mark]:not([hidden])')
  const count = await marks.count()
  console.log(id, 'dots', count)
  for (let i = 0; i < count; i++) {
    await marks.nth(i).click()
    await page.waitForTimeout(250)
    heights[`${id}:mark${i}`] = await height()
  }
  for (const label of ['Previous', 'Next']) {
    const b = panel.locator(`[data-controls] button[aria-label="${label === 'Next' ? 'Next call' : 'Previous call'}"]`).first()
    if (await b.count()) { await b.click(); await page.waitForTimeout(400) }
  }
}
const spread = new Set(Object.values(heights))
console.log('showcase heights distinct', JSON.stringify([...spread]))
const shifts = await page.evaluate(() => window.__shifts)
const byPhase = {}
for (const s of shifts) {
  byPhase[s.phase] ??= { total: 0, count: 0, afterInput: 0 }
  if (s.input) byPhase[s.phase].afterInput++
  else { byPhase[s.phase].total = Number((byPhase[s.phase].total + s.v).toFixed(5)); byPhase[s.phase].count++ }
}
console.log('by phase', JSON.stringify(byPhase))
for (const s of shifts.filter((x) => !x.input || x.phase !== 'load').slice(0, 30)) console.log(' ', s.phase, s.t, s.v, s.src.join(' | '))
await browser.close()
