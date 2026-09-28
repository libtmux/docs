import assert from 'node:assert/strict'

/** Check the controls attached to a document after its content is replaced. */
export async function checkNavigation(page, base) {
  await page.goto(`${base}/examples/attach-and-send-keys/`, { waitUntil: 'load' })
  await page.evaluate(() => {
    localStorage.setItem('color-scheme', 'dark')
    localStorage.setItem('libtmux-docs.mcp-install.cooldown.enabled', '1')
    window.__applyTheme()
    window.__navigationProbe = { loads: 0, blank: false, wrongTheme: false }
    document.addEventListener('astro:page-load', () => window.__navigationProbe.loads++)
    document.addEventListener('astro:after-swap', () => {
      window.__navigationProbe.blank ||= document.documentElement.classList.contains('fonts-pending')
      window.__navigationProbe.wrongTheme ||= document.documentElement.dataset.themeMode !== 'dark'
    })
  })
  await page.getByRole('navigation', { name: 'Breadcrumb', exact: true }).getByRole('link', { name: 'Examples', exact: true }).click()
  await page.waitForFunction(() => window.__navigationProbe?.loads === 1)
  assert.match(page.url(), /\/examples\/$/)
  await page.locator('main').getByRole('link', { name: 'Attach and send keys', exact: true }).click()
  await page.waitForFunction(() => window.__navigationProbe?.loads === 2)
  await page.keyboard.press('Control+k')
  await page.locator('#search-modal[open] .search-panel__input').waitFor({ state: 'visible' })
  assert(await page.locator('#search-modal .search-panel__input').evaluate((input) => document.activeElement === input))
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('#search-modal').open)
  await page.locator('[data-page-actions] summary').click()
  await page.getByRole('button', { name: 'Print', exact: true }).waitFor({ state: 'visible' })
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('[data-page-actions]').getAttribute('open'), null)
  const otherTab = page.locator('.code-tab[aria-selected="false"]').first()
  const port = await otherTab.getAttribute('data-port')
  await otherTab.click()
  assert.equal(await page.locator(`.code-tab[data-port="${port}"]`).first().getAttribute('aria-selected'), 'true')
  await page.goBack()
  await page.waitForFunction(() => window.__navigationProbe?.loads === 3)
  assert.deepEqual(await page.evaluate(() => window.__navigationProbe), { loads: 3, blank: false, wrongTheme: false })
  assert.equal(await page.locator('html').getAttribute('data-mcp-install-cooldown-enabled'), '1')
  console.log('Navigation: document retained, Back, search, code tabs, menu and saved theme/cooldown pass')
}
