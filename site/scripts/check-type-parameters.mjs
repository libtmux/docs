import assert from 'node:assert/strict'

/**
 * Member pages whose signatures use a type parameter their owner declares.
 * `uses` is the least number of occurrences the signature must link.
 */
export const TYPE_PARAMETER_PAGES = [
  { port: 'ts', page: 'selection-selection-where', owner: 'selection-selection', name: 'Model', uses: 2 },
  { port: 'py', page: 'libtmux-_internal-query_list-querylist-filter', owner: 'libtmux-_internal-query_list-querylist', name: 'T', uses: 1 },
  { port: 'rs', page: 'query-filterexpr-matches', owner: 'query-filterexpr', name: 'T', uses: 1 },
  { port: 'go', page: 'tmux-sparsearray-get', owner: 'tmux-sparsearray', name: 'T', uses: 1 },
  { port: 'java', page: 'io-github-libtmux-control-eventsubscription-eventsubscription-offer',
    owner: 'io-github-libtmux-control-eventsubscription-eventsubscription', name: 'T', uses: 1 },
]

/**
 * Each type parameter in a signature links to its declaration, that
 * declaration exists on the owner's page, and the Markdown twin says the same.
 */
export async function checkTypeParameters(browser, base, pages = TYPE_PARAMETER_PAGES) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.setDefaultTimeout(process.env.CI ? 20000 : 10000)
  try {
    for (const entry of pages) {
      const path = `${base}/${entry.port}/latest/reference/${entry.page}/`
      const label = `${entry.port} ${entry.page}`
      const response = await page.goto(path, { waitUntil: 'load' })
      assert(response?.ok(), `${label}: HTTP ${response?.status()}`)
      await page.evaluate(() => document.fonts.ready)

      const signature = page.locator('.gp-sphinx-api-signature')
      const used = await signature.locator('a[data-type-parameter]').evaluateAll((links) =>
        links.map((link) => ({ text: link.textContent, parameter: link.getAttribute('data-type-parameter'), href: link.getAttribute('href') })))
      assert(used.length >= entry.uses, `${label}: the signature links ${entry.name} at least ${entry.uses} time(s), found ${used.length}`)
      assert(used.every((link) => link.text === entry.name && link.parameter === entry.name), `${label}: only ${entry.name} is marked as a type parameter`)
      const hrefs = [...new Set(used.map((link) => link.href))]
      assert.equal(hrefs.length, 1, `${label}: every ${entry.name} has one destination: ${hrefs}`)
      const [href] = hrefs
      assert(href.startsWith(`${new URL(base).pathname}/${entry.port}/latest/reference/${entry.owner}/#`), `${label}: ${href} is on the owner's page`)
      // The bug this guards: a same-named global type taking the name.
      const others = await signature.locator('a.api-type-link').evaluateAll((links, name) =>
        links.filter((link) => link.textContent === name && !link.hasAttribute('data-type-parameter')).map((link) => link.getAttribute('href')), entry.name)
      assert.deepEqual(others, [], `${label}: no other link takes the name ${entry.name}`)

      // The member page says where the parameter comes from, without declaring it again.
      const section = page.locator('.api-type-parameters li').filter({ has: page.locator('.api-type-parameter-owner') })
      assert.equal(await section.locator('a').first().getAttribute('href'), href, `${label}: the Type parameters entry links the owner's anchor`)
      assert.equal(await section.locator('.api-type-parameter-owner a').first().getAttribute('href'), href.split('#')[0], `${label}: the entry names the declaring page`)
      assert.equal(await page.locator('.api-type-parameters li[id]').count(), 0, `${label}: an inherited parameter keeps no id of its own`)

      // The Markdown twin links the same destination.
      const twin = await page.request.get(`${path.slice(0, -1)}.md`)
      assert(twin.ok(), `${label}: Markdown twin HTTP ${twin.status()}`)
      const markdown = await twin.text()
      assert(markdown.includes('## Type parameters'), `${label}: Markdown has a Type parameters section`)
      assert(markdown.includes(`](${href})`), `${label}: Markdown links ${href}`)

      // Following the link lands on a visible declaration under the header.
      await Promise.all([page.waitForURL((url) => url.pathname === href.split('#')[0]), signature.locator('a[data-type-parameter]').first().click()])
      await page.evaluate(() => document.fonts.ready)
      const arrival = await page.evaluate(() => {
        const target = document.getElementById(decodeURIComponent(location.hash.slice(1)))
        const rect = target?.getBoundingClientRect()
        return {
          found: Boolean(target), listed: Boolean(target?.closest('.api-type-parameters')), targeted: Boolean(target?.matches(':target')),
          name: target?.querySelector('strong code')?.textContent, top: rect?.top, bottom: rect?.bottom,
          header: document.querySelector('.site-header').getBoundingClientRect().bottom, viewport: innerHeight,
        }
      })
      assert(arrival.found && arrival.listed && arrival.targeted, `${label}: ${href} exists in the owner's Type parameters list: ${JSON.stringify(arrival)}`)
      assert.equal(arrival.name, entry.name, `${label}: the target names ${entry.name}`)
      assert(arrival.top >= arrival.header - 1 && arrival.bottom <= arrival.viewport, `${label}: the declaration is visible below the header: ${JSON.stringify(arrival)}`)
    }
  } finally {
    await context.close()
  }
  console.log(`Type parameters: ${pages.length} member signatures link their owner's declaration, which exists on the owner page and in Markdown`)
}
