import { newCheckContext } from './browser-context.mjs'
import assert from 'node:assert/strict'
import { CONCEPT_DESCRIPTION, workspaceInstallGuidance, PORT_BY_SLUG } from '../src/lib/ports.ts'

/**
 * A product's status is a dismissible bar under the header, the release bar's
 * kind of notice, and not an admonition that opens the article. The check
 * reads real pages: the bar says the right thing and sits outside the page
 * body; Dismiss hides it and remembers; a later visit paints without it
 * before any bundled script runs, and a client-routed page keeps it hidden;
 * hiding one bar leaves the release bar and other products' bars alone; and
 * without JavaScript the bar stays. Each control at the end breaks one thing
 * the check holds and requires it to notice.
 */
const KEY = 'libtmux-docs.product-notice.'
const servedVersion = (slug) => JSON.parse(process.env.LIBTMUX_DOCS_PORT_DEFAULTS || '{}')[slug] ?? 'latest'
const IN_DEVELOPMENT = 'Server behavior and tool contracts may change. Tool availability depends on the server configuration.'

/** [port, page below its version root, bar id, badge, sentence] */
const PAGES = [
  ['ocaml', 'workspace/', 'workspace-concept', 'Concept example', CONCEPT_DESCRIPTION],
  ['java', 'mcp/', 'mcp-concept', 'Concept example', CONCEPT_DESCRIPTION],
  ['rs', 'mcp/tools/', 'mcp-concept', 'Concept example', CONCEPT_DESCRIPTION],
  ['py', 'mcp/', 'mcp-in-development', 'In development', IN_DEVELOPMENT],
]
const url = (base, port, path) => `${base}/${port}/${servedVersion(port)}/${path}`
const forget = (page) => page.evaluate(() => {
  for (const key of Object.keys(localStorage)) if (key.startsWith('libtmux-docs.product-notice.')) localStorage.removeItem(key)
})

async function open(page, address) {
  // The development server can replace a page while it optimizes dependencies; load it again once.
  for (const attempt of [1, 2]) {
    try {
      await page.goto(address, { waitUntil: 'load' })
      await page.waitForSelector('[data-prerelease-notice]', { state: 'attached' })
      return
    } catch (error) {
      if (attempt === 2) throw error
    }
  }
}

/** What a reader sees and where the bar `id` sits, read from the page. */
const read = (id) => {
  const bars = [...document.querySelectorAll('[data-product-notice]')]
  const bar = bars.find((element) => element.getAttribute('data-product-notice') === id)
  const release = document.querySelector('[data-prerelease-notice]')
  const visible = (element) => Boolean(element) && getComputedStyle(element).display !== 'none'
  return {
    bars: bars.map((element) => element.getAttribute('data-product-notice')),
    badge: bar?.querySelector('.prerelease-notice__badge')?.textContent?.trim(),
    text: bar?.querySelector('.prerelease-notice__text span')?.textContent?.replace(/\s+/g, ' ').trim(),
    link: bar?.querySelector('.prerelease-notice__text a')?.getAttribute('href'),
    follows: Boolean(bar && release && release.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING),
    outside: Boolean(bar) && !bar.closest('main, [data-pagefind-body]'),
    barVisible: visible(bar),
    releaseVisible: visible(release),
    notes: [...document.querySelectorAll('main [role="note"]')]
      .map((note) => note.textContent.trim()).filter((text) => /^(?:Workspace Manager|MCP)\s+(?:concept example|is in development)/i.test(text)),
    stored: localStorage.getItem(`libtmux-docs.product-notice.${id}`),
    attribute: document.documentElement.getAttribute('data-product-notice-dismissed'),
  }
}

/** Check the bar on one page of each product status, its dismissal and its fallbacks. */
export async function checkProductNotice(browser, base, options = {}) {
  const { sabotage, timeout } = options
  const context = await newCheckContext(browser, base, { reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.setDefaultTimeout(timeout ?? (process.env.CI ? 20000 : 10000))
  page.setDefaultNavigationTimeout(60000)
  try {
    for (const [port, path, id, badge, sentence] of PAGES) {
      const where = `${port} ${path}`
      await open(page, url(base, port, path))
      if (sabotage?.admonition) {
        await page.evaluate(() => {
          const note = Object.assign(document.createElement('aside'), { textContent: 'Workspace Manager concept example. A working example.' })
          note.setAttribute('role', 'note')
          document.querySelector('main').prepend(note)
        })
      }
      let state = await page.evaluate(read, id)
      assert.deepEqual(state.bars, [id], `${where}: one product bar, for ${id}`)
      assert.deepEqual(state.notes, [], `${where}: the article opens with no status admonition`)
      assert.equal(state.badge, badge, `${where}: the badge`)
      assert.equal(state.text.startsWith(sentence), true, `${where}: the bar says "${sentence}", not "${state.text}"`)
      if (badge === 'Concept example') assert.match(state.link ?? '', /\/meta\/support\/#concept-and-alpha$/, `${where}: the bar links the guide`)
      assert.equal(state.follows && state.outside, true, `${where}: the bar follows the release bar and sits outside the page body`)
      assert.equal(state.barVisible && state.releaseVisible, true, `${where}: both bars show on a first visit`)
      assert.equal(state.stored, null, `${where}: nothing is remembered before a click`)

      const dismiss = page.locator(`[data-product-notice-dismiss="${id}"]`)
      await dismiss.waitFor({ state: 'visible' })
      assert.match(await dismiss.getAttribute('aria-label'), /^Dismiss the .+ notice$/, `${where}: the control names what it dismisses`)
      await dismiss.click()
      if (sabotage?.showAfterDismiss) await page.addStyleTag({ content: '[data-product-notice] { display: block !important }' })
      state = await page.evaluate(read, id)
      assert.equal(state.barVisible, false, `${where}: the bar is hidden after Dismiss`)
      assert.equal(state.releaseVisible, true, `${where}: dismissing a product bar leaves the release bar`)
      assert.equal(state.stored, 'dismissed', `${where}: Dismiss is remembered under ${KEY}${id}`)
      await forget(page)
    }

    // The remembered dismissal paints without the bar before any bundled script runs.
    await open(page, url(base, 'ocaml', 'workspace/'))
    await page.locator('[data-product-notice-dismiss="workspace-concept"]').click()
    const bundled = await context.newPage()
    await bundled.route('**/*', (route) => (route.request().resourceType() === 'script' ? route.abort() : route.continue()))
    await bundled.goto(url(base, 'ocaml', 'workspace/'), { waitUntil: 'load' })
    let state = await bundled.evaluate(read, 'workspace-concept')
    assert.equal(state.barVisible, false, 'ocaml workspace/: a dismissed bar is hidden by <head> and the stylesheet alone')
    assert.equal(state.attribute, 'workspace-concept', 'ocaml workspace/: <head> listed the id on the root')
    assert.equal(state.releaseVisible, true, 'ocaml workspace/: the release bar is unaffected')
    await bundled.close()

    // The same status on another port is the same dismissal; another product's bar is not.
    await open(page, url(base, 'java', 'workspace/'))
    state = await page.evaluate(read, 'workspace-concept')
    assert.equal(state.barVisible, false, 'java workspace/: the dismissal of the Workspace Manager note covers every port')
    await open(page, url(base, 'java', 'mcp/'))
    state = await page.evaluate(read, 'mcp-concept')
    assert.equal(state.barVisible, true, 'java mcp/: the MCP bar is a different dismissal')

    // A client-routed page applies the saved dismissals before it paints.
    await open(page, url(base, 'ocaml', 'workspace/'))
    await page.evaluate(() => { window.__routed = true })
    await page.locator('article a[href$="/workspace/reference/"]').first().click()
    await page.waitForURL(/\/workspace\/reference\/$/)
    assert.equal(await page.evaluate(() => window.__routed === true), true, 'the click was routed on the client, not a full load')
    state = await page.evaluate(read, 'workspace-concept')
    assert.deepEqual(state.bars, ['workspace-concept'], 'ocaml workspace/reference/: the reference page draws the same bar')
    assert.equal(state.barVisible, false, 'ocaml workspace/reference/: the dismissal holds across a client-routed swap')
    await forget(page)
  } finally {
    await context.close()
  }

  // Without JavaScript the bar stays and the install guidance is in the article.
  const plain = await newCheckContext(browser, base, { javaScriptEnabled: false })
  try {
    const page = await plain.newPage()
    await page.goto(url(base, 'ocaml', 'workspace/'), { waitUntil: 'load' })
    const state = await page.evaluate(read, 'workspace-concept')
    assert.equal(state.barVisible, true, 'without JavaScript the bar shows')
    const guidance = workspaceInstallGuidance(PORT_BY_SLUG.ocaml).replaceAll('`', '').replace(/\s+/g, ' ')
    const install = await page.evaluate(() => {
      const text = []
      for (let node = document.querySelector('article h2#install')?.nextElementSibling; node && node.tagName !== 'H2'; node = node.nextElementSibling) text.push(node.textContent)
      return text.join(' ').replace(/\s+/g, ' ')
    })
    assert.equal(install.includes(guidance), true, `the install section carries the guidance: ${install}`)
  } finally {
    await plain.close()
  }
  if (!sabotage) console.log(`Product notice: ${PAGES.length} product pages draw one dismissible bar under the release bar and no status admonition; Dismiss is remembered, paints hidden before bundled scripts run and survives a client-routed swap; the bar shows without JavaScript`)
}

/** Break one thing the check holds, and require it to notice by the problem it names. */
export async function checkProductNoticeFail(browser, base) {
  for (const [sabotage, message] of [
    [{ admonition: true }, /opens with no status admonition/],
    [{ showAfterDismiss: true }, /hidden after Dismiss/],
  ]) {
    await assert.rejects(() => checkProductNotice(browser, base, { sabotage, timeout: 3000 }), message)
  }
  console.log('Product notice: the check fails on an admonition in the article and on a bar that stays after Dismiss')
}
