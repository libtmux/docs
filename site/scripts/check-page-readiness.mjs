import assert from 'node:assert/strict'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

/** Real font selection, link drawing and geometry at the first visible frame. */
async function observeAppearance(context) {
  await context.addInitScript(() => {
    window.__appearance = { document: crypto.randomUUID(), first: null, shifts: 0, positions: [] }
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (window.__appearance.first && !entry.hadRecentInput) window.__appearance.shifts += entry.value
      }
    }).observe({ type: 'layout-shift', buffered: true })
    const sample = () => {
      const heading = document.querySelector('main h1')
      if (heading && getComputedStyle(document.body).visibility === 'visible') {
        const rect = heading.getBoundingClientRect()
        window.__appearance.positions.push([rect.x, rect.y, rect.width, rect.height])
        if (!window.__appearance.first) {
          const text = [heading, document.querySelector('main code')].filter(Boolean)
          // Icon-only links draw no glyph, and a closed header menu is not what a reader sees first.
          const glyphLinks = [...document.querySelectorAll('a[data-external-link]:not([data-external-link-icon])')]
          const icon = glyphLinks.find((link) => link.checkVisibility()) ?? glyphLinks[0]
          // The legend chip's word sits one box deeper than a modifier's, so the word is any label inside the chip.
          const dotted = document.querySelector('.api-badge[data-link-preview] .api-badge__label')
          window.__appearance.first = {
            readiness: document.documentElement.dataset.pageReadiness,
            fonts: text.every((element) => {
              const s = getComputedStyle(element)
              const family = s.fontFamily.split(',')[0]
              return family.includes('IBM Plex') && document.fonts.check(`${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${family}`)
            }),
            mask: icon ? getComputedStyle(icon, '::after').maskImage : null,
            underline: dotted ? getComputedStyle(dotted).textDecorationStyle : null,
            versions: document.querySelector('[data-select="version"]')?.options.length ?? 0,
            versionVisible: Boolean(document.querySelector('[data-version-control]:not([hidden])')),
          }
        }
      }
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
}

/** Optional policy and beacon requests cannot hold browser lifecycle events. */
export async function checkWebAnalytics(browser, base) {
  for (const kind of ['beacon', 'policy', 'excluded']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } })
    await observeAppearance(context)
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    let release, requested = false, beaconRequests = 0
    const held = new Promise((resolve) => { release = resolve })
    try {
      await page.route('**/_shell/web-analytics.json', async (route) => {
        if (kind === 'policy') {
          requested = true
          await held
          await route.abort()
          return
        }
        const response = await route.fetch()
        assert.equal(response.status(), 200, 'The built policy resource exists')
        const headers = { ...response.headers() }
        if (kind !== 'excluded') headers['x-libtmux-analytics'] = 'allow'
        else delete headers['x-libtmux-analytics']
        await route.fulfill({ response, headers })
      })
      await page.route('https://static.cloudflareinsights.com/**', async (route) => {
        beaconRequests++
        requested = true
        await held
        await route.abort()
      })
      const incoming = kind === 'beacon' ? page.waitForRequest('https://static.cloudflareinsights.com/**')
        : kind === 'policy' ? page.waitForRequest('**/_shell/web-analytics.json')
        : page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/_shell/web-analytics.json'))
      await Promise.all([incoming, page.goto(`${base}/swift/latest/mcp/reference/jsonvalue-(_-_-)-sduv/`, {
        waitUntil: 'load', timeout: process.env.CI ? 20000 : 10000,
      })])
      await page.waitForFunction(() => document.documentElement.dataset.pageReadiness === 'ready')
      await page.evaluate(() => new Promise((resolve) => {
        let remaining = 8
        const sample = () => { if (--remaining) requestAnimationFrame(sample); else resolve() }
        requestAnimationFrame(sample)
      }))
      const observation = await page.evaluate(() => ({
        readyState: document.readyState,
        load: performance.getEntriesByType('navigation')[0].loadEventEnd,
        appearance: window.__appearance,
        beacon: Boolean(document.querySelector('script[data-cf-beacon]')),
      }))
      assert.equal(observation.readyState, 'complete', `${kind}: browser load completed`)
      assert(observation.load > 0, `${kind}: load was recorded before releasing analytics`)
      assert(observation.appearance.first.fonts, `${kind}: downloaded fonts were ready at first appearance`)
      assert.equal(observation.appearance.shifts, 0, `${kind}: no observed post-reveal layout shift`)
      if (kind === 'excluded') {
        assert.equal(beaconRequests, 0, 'Excluded visitors make no beacon request')
        assert.equal(observation.beacon, false, 'Excluded visitors have no beacon element')
      } else assert(requested, `${kind}: the optional request remains held`)
      assert.deepEqual(errors, [], `${kind}: no page error`)
    } finally {
      release()
      await page.unrouteAll({ behavior: 'wait' })
      await context.close()
    }
  }
  console.log('Analytics: held policy/beacon cannot block load; edge denial excludes the beacon PASS')
}

/** Reproduce a late beacon arriving between an Astro swap and script execution. */
export async function checkWebAnalyticsTransitions(browser, base) {
  for (const markHandled of [true, false]) {
    const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 900 } })
    const page = await context.newPage()
    page.setDefaultTimeout(process.env.CI ? 20000 : 10000)
    let release, requested = false
    const held = new Promise((resolve) => { release = resolve })
    try {
      await page.route('**/_shell/web-analytics.json', async (route) => {
        const response = await route.fetch()
        await route.fulfill({ response, headers: { ...response.headers(), 'x-libtmux-analytics': 'allow' } })
      })
      await page.route('https://static.cloudflareinsights.com/**', async (route) => {
        requested = true
        await held
        await route.abort()
      })
      const incoming = page.waitForRequest('https://static.cloudflareinsights.com/**')
      await Promise.all([incoming, page.goto(`${base}/analytics-router-probe/first/`, { waitUntil: 'load' })])
      await page.evaluate((markHandled) => {
        const beacon = document.querySelector('script[data-cf-beacon]')
        if (beacon?.getAttribute('data-astro-exec') !== '') throw new Error('The real loader must mark its beacon handled')
        const late = beacon.cloneNode(true)
        if (!markHandled) late.removeAttribute('data-astro-exec')
        window.__analyticsRouterProbe = { identity: crypto.randomUUID(), pageLoads: 0, inserted: false }
        document.addEventListener('astro:page-load', () => { window.__analyticsRouterProbe.pageLoads++ })
        document.addEventListener('astro:after-swap', () => {
          document.head.append(late)
          window.__analyticsRouterProbe.inserted = true
        }, { once: true })
      }, markHandled)
      const identity = await page.evaluate(() => window.__analyticsRouterProbe.identity)
      await page.locator('#analytics-next').click()
      await page.waitForFunction(() => window.__analyticsRouterProbe?.inserted &&
        document.querySelector('main h1')?.textContent === 'second analytics article')
      if (markHandled) {
        await page.waitForFunction(() => window.__analyticsRouterProbe.pageLoads === 1)
      }
      await page.evaluate(() => new Promise((resolve) => {
        let remaining = 8
        const sample = () => { if (--remaining) requestAnimationFrame(sample); else resolve() }
        requestAnimationFrame(sample)
      }))
      const observation = await page.evaluate(() => ({
        ...window.__analyticsRouterProbe,
        load: performance.getEntriesByType('navigation')[0].loadEventEnd,
      }))
      assert.equal(observation.identity, identity, 'A real ClientRouter swap retained the document')
      assert(observation.load > 0 && requested, 'The initial document loaded while the beacon remained held')
      assert.equal(observation.pageLoads, markHandled ? 1 : 0,
        'Only the unmarked negative control waits for optional analytics')
      release()
      await page.waitForFunction(() => window.__analyticsRouterProbe.pageLoads === 1)
    } finally { release(); await page.unrouteAll({ behavior: 'wait' }); await context.close() }
  }
  console.log('Analytics: real ClientRouter swap completes with held beacon; unmarked negative control stalls and recovers PASS')
}

/** Held and failed required resources must never become elapsed-time success. */
export async function checkRequiredAppearance(browser, base) {
  for (const [kind, path, width] of [
    ['font', '/', 390],
    ['module', '/java/latest/reference/io-github-libtmux-buffers-buffers-delete/', 1280],
    ['effect', '/prompts/?port=ts', 390],
  ]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    await observeAppearance(context)
    const page = await context.newPage()
    page.setDefaultTimeout(process.env.CI ? 20000 : 10000)
    let release, requested = false
    const hold = new Promise((resolve) => { release = resolve })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    try {
      await page.clock.install()
      let module
      if (kind === 'module') {
        const html = await page.request.get(`${base}${path}`).then((response) => response.text())
        const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map((match) => match[1])
        const attributes = scripts.find((attributes) => /type="module"/.test(attributes)
          && /src="/.test(attributes) && !/vite|toolbar|cloudflareinsights/.test(attributes))
        assert(attributes, 'The real page contains an external required module')
        module = new URL(attributes.match(/src="([^"]+)"/)[1], base).href
      }
      const required = (request) => kind === 'font' ? request.resourceType() === 'font'
          : kind === 'effect' ? new URL(request.url()).pathname.endsWith('/versions.json')
          : request.url() === module
      const incoming = page.waitForRequest(required)
      await page.route('**/*', async (route) => {
        if (required(route.request())) { requested = true; await hold }
        if (kind === 'effect' && required(route.request())) {
          // Exercise insertion even when a new preview's actual manifest has
          // only one published version for the selected port.
          const entries = [
            { slug: 'stable', label: 'stable', supported: true },
            { slug: 'latest', label: 'latest', supported: true },
          ]
          await route.fulfill({ json: { schema: 1, ports: { py: entries, ts: entries } } })
          return
        }
        await route.continue()
      })
      await page.goto(`${base}${path}`, { waitUntil: 'commit' })
      await incoming
      await page.waitForFunction(() => Boolean(document.querySelector('main h1')))
      // The test clock crosses the former cutoff; no product timer is used.
      await page.clock.fastForward(3500)
      assert(requested, `${kind}: the actual required request was held`)
      const held = await page.evaluate(() => ({ ...window.__appearance,
        readiness: document.documentElement.dataset.pageReadiness }))
      assert.equal(held.readiness, 'pending', `${kind}: stays pending past the old cutoff`)
      assert.equal(held.first, null, `${kind}: no incomplete visible frame`)
      release()
      const sample = await page.waitForFunction((document) => {
        const result = window.__appearance
        if (result.document !== document) return { changed: true }
        return result.first && result.positions.length >= 2 ? structuredClone(result) : false
      }, held.document)
      const result = await sample.jsonValue()
      if (result.changed) throw new Error('Appearance document changed during required-resource check')
      assert.equal(result.first.readiness, 'ready')
      assert(result.first.fonts, `${kind}: selected fonts succeeded before reveal`)
      assert.match(result.first.mask, /^url\("?data:image\/svg\+xml,/, `${kind}: the external icon draws at first reveal`)
      if (kind === 'module') assert.equal(result.first.underline, 'dotted', 'Reference underlines are present at first reveal')
      if (kind === 'effect') assert(result.first.versions > 1 && result.first.versionVisible, 'Visible version options finished before reveal')
      assert.deepEqual(result.positions[1], result.positions[0], `${kind}: text stays in place after reveal`)
      assert.equal(result.shifts, 0, `${kind}: no post-reveal layout shift`)
      assert.deepEqual(errors, [], `${kind}: no runtime errors`)
    } finally { release(); await context.close() }
  }

  const context = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.setDefaultTimeout(process.env.CI ? 20000 : 10000)
  try {
    await page.route('**/*', (route) => route.request().resourceType() === 'font' ? route.abort() : route.continue())
    await page.goto(`${base}/`, { waitUntil: 'commit' })
    await page.getByRole('alert').waitFor({ state: 'visible' })
    assert.equal(await page.locator('html').getAttribute('data-page-readiness'), 'failed')
    assert.equal(await page.locator('main h1').isVisible(), false, 'Required failure keeps incomplete content gated')
    await page.unroute('**/*')
    await page.getByRole('button', { name: 'Reload', exact: true }).click()
    await page.locator('html[data-page-readiness="ready"]').waitFor({ state: 'attached' })
    assert(await page.locator('main h1').isVisible(), 'Reload recovers after the required resource becomes available')
  } finally { await context.close() }
  const legacy = await browser.newPage()
  try {
    const probe = `${base}/legacy-shell-probe/`
    await legacy.route(probe, (route) => route.fulfill({ contentType: 'text/html', body:
      `<link rel="stylesheet" href="${base}/_shell/anchors.css"><script type="module" src="${base}/_shell/anchors.js"></script><a href="https://example.com/">External</a>` }))
    await legacy.goto(probe)
    // The conditional decorator import can finish after window load.
    await legacy.locator('a[data-external-link]').waitFor({ state: 'attached' })
    assert.equal(await legacy.locator('a').getAttribute('data-external-link'), 'example.com', 'Standalone and cached older heads retain decoration')
    assert.match(await legacy.locator('a').evaluate((link) => getComputedStyle(link, '::after').maskImage), /external-link\.svg/)
  } finally { await legacy.close() }
  console.log('Appearance: held font/module/effect, first visible fonts/icons/dotted links, stable geometry, failure and Reload PASS')
}

/**
 * A quarter em; navigation rows keep their 4px, which is .286em at 14px.
 * Split chips (the mark is the cap of one outlined token) and the tree's fixed
 * gutter (names indent after the mark column) have no such gap and say `gap: false`.
 */
const BADGE_GAP = { min: .21, max: .29 }

/*
 * Cards and list rows lead a bare name, not a code chip, so their mark sits a
 * half em from it and is centred on the name's capital height rather than on
 * its line box. `gap: false, centre: false` hands those entries to
 * check-badge-centring, which measures them from pixels (the cap-centre and the
 * gap, in both directions) with a negative control.
 */

/**
 * A reference page's sidebar is the shared API tree, open on the current
 * member: a member row is a link holding its mark, and a type row holds the
 * mark beside the name's own link. The tree keeps its marks in a fixed gutter
 * and centres one on the whole row when a long name wraps, so only the
 * decorations are measured here; the badge-centring check owns the geometry.
 */
const SIDEBAR_PAGE = '/py/stable/workspace/reference/tmuxp-workspace-builder-classicworkspacebuilder-build/'
const SIDEBAR_BADGE_LINKS = [
  { label: 'sidebar member link', path: SIDEBAR_PAGE, badges: 'a.api-nav__leaf > .api-nav__kind', gap: false, centre: false },
  { label: 'sidebar type row', path: SIDEBAR_PAGE, badges: 'div.api-nav__row > .api-nav__kind', gap: false, centre: false },
]

/**
 * Every link that leads with a kind badge, by the badge's selector. `line`
 * marks single-line prose links, which must not grow their line; `sample`
 * keeps an entry in the bounded sample.
 */
const BADGE_LINKS = [
  { label: 'prose link', path: '/rs/latest/concepts/server-session-window-pane/', badges: 'p a > .api-link-kind', line: true, fixtures: true, sample: true },
  { label: 'guide prose link', path: '/py/stable/guides/attaching-to-tmux/', badges: 'p a > .api-link-kind', line: true, sample: true },
  { label: 'MCP prose link', path: '/py/stable/mcp/tools/capture_pane/', badges: 'p a > .api-link-kind', line: true },
  { label: 'MCP index card', path: '/py/stable/mcp/tools/', badges: '.api-index-card a > .api-nav__kind', gap: false, centre: false, sample: true },
  { label: 'MCP catalog heading', path: '/py/stable/mcp/tools/', badges: 'h2 a > .api-nav__kind', gap: false, centre: false },
  { label: 'API equivalent', path: '/py/stable/workspace/reference/tmuxp-workspace-builder-classicworkspacebuilder-build/', badges: '.api-elsewhere-value a > .api-nav__kind', gap: false, sample: true },
  ...SIDEBAR_BADGE_LINKS,
  // The MCP tree draws no marks under a group of one kind, so its leaf marks are measured on an API tree.
  { label: 'navigation tree link', path: '/java/latest/reference/io-github-libtmux-server-server/', badges: 'a.api-nav__leaf > .api-nav__kind', gap: false },
  { label: 'navigation tree row', path: '/java/latest/reference/io-github-libtmux-server-server/', badges: 'div.api-nav__row > .api-nav__kind', gap: false },
  { label: 'related type card', path: '/java/latest/reference/io-github-libtmux-server-server/', badges: '.api-related-card a > .api-nav__kind' },
  { label: 'related API contents', path: '/java/latest/reference/io-github-libtmux-server-server/', badges: 'nav.api-related a > .api-nav__kind', gap: false },
  { label: 'command related API', path: '/powershell/latest/reference/libtmux-enter-tmuxsession/', badges: '.api-command-related a > .api-nav__kind', gap: false },
  { label: 'navigation search result', path: '/lua/latest/reference/libtmux-server/', badges: '[data-api-search-results] a strong > .api-nav__kind', gap: false,
    prepare: async (page) => {
      await page.getByRole('searchbox', { name: 'Find a type or member' }).fill('Server')
      await page.locator('[data-api-search-results] a').first().waitFor()
    } },
]

/** Read the decorations that reach a badge and its name, and the badge's centring and gap. */
async function describeBadgeLink(badge) {
  return badge.evaluate((badge) => {
    // Atomic inline boxes keep their contents clear of an ancestor's decoration.
    const atomic = (element) => {
      const style = getComputedStyle(element)
      return /^inline-(block|flex|grid|table)$/.test(style.display) || style.float !== 'none'
        || style.position === 'absolute' || style.position === 'fixed'
    }
    const owners = (node) => {
      const found = []
      let blocked = false
      for (let element = node; element && element !== document.body; element = element.parentElement) {
        const style = getComputedStyle(element)
        if (style.textDecorationLine !== 'none' && (element === node || !blocked)) {
          found.push(`${element.tagName.toLowerCase()}${element.className ? `.${String(element.className).split(' ')[0]}` : ''} ${style.textDecorationLine} ${style.textDecorationStyle}`)
        }
        if (atomic(element)) blocked = true
      }
      return found
    }
    let name = badge.nextSibling
    while (name && name.nodeType !== 1 && !name.textContent.trim()) name = name.nextSibling
    let text = name.nodeType === 3 ? name : null
    const walker = document.createTreeWalker(name, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); !text && node; node = walker.nextNode()) if (node.textContent.trim()) text = node
    const range = document.createRange()
    const first = text.textContent.search(/\S/)
    range.setStart(text, first)
    range.setEnd(text, first + 1)
    const glyph = range.getBoundingClientRect()
    const box = badge.getBoundingClientRect()
    const chip = name.nodeType === 1 ? (name.matches('code') ? name : name.querySelector('code')) : null
    const link = badge.closest('a') ?? badge.parentElement
    const holder = badge.parentElement
    const fontSize = parseFloat(getComputedStyle(holder).fontSize)
    const gap = (chip ? chip.getClientRects()[0].left : glyph.left) - box.right
    return {
      name: text.textContent.trim().slice(0, 24),
      preview: link.hasAttribute('data-link-preview'),
      badgeOwners: owners(badge),
      nameOwners: owners(text.parentElement),
      centre: (box.top + box.height / 2) - (glyph.top + glyph.height / 2),
      gap: gap / fontSize,
      lineExcess: link.getBoundingClientRect().height - parseFloat(getComputedStyle(link).lineHeight),
    }
  })
}

/**
 * The badge's own pixels, and a strip under it, with and without any
 * decoration. A badge's rounded corners sit at a fractional offset, and
 * repaints rasterize them a channel unit apart, so compare perceptible
 * change; an underline changes whole pixels.
 */
async function paintsBadgeDecoration(page, badge) {
  await badge.scrollIntoViewIfNeeded()
  const box = await badge.boundingBox()
  const clip = { x: box.x, y: box.y, width: box.width, height: box.height + 4 }
  const drawn = await page.screenshot({ clip })
  const style = await page.addStyleTag({ content: '*, *::before, *::after { text-decoration: none !important; }' })
  const bare = await page.screenshot({ clip })
  await style.evaluate((node) => node.remove())
  if (drawn.equals(bare)) return false
  const [before, after] = [PNG.sync.read(drawn), PNG.sync.read(bare)]
  return pixelmatch(before.data, after.data, null, before.width, before.height, { threshold: .1 }) > 0
}

/** Clone the first prose link into headings and a table, the contexts real pages vary in. */
async function addBadgeLinkFixtures(page) {
  await page.evaluate(() => {
    const source = document.querySelector('p a:has(> .api-link-kind)')
    const article = source.closest('p').parentElement
    const variant = (plain) => {
      const clone = source.cloneNode(true)
      if (plain) clone.querySelector('.api-symbol-link__name').textContent = 'Session'
      return clone
    }
    for (const tag of ['h2', 'h3', 'h4']) for (const plain of [false, true]) {
      const heading = document.createElement(tag)
      heading.append('Heading ', variant(plain))
      heading.dataset.fixture = 'heading'
      article.append(heading)
    }
    const table = document.createElement('table')
    table.dataset.fixture = 'table'
    table.innerHTML = '<thead><tr><th></th></tr></thead><tbody><tr><td></td></tr><tr><td></td></tr></tbody>'
    table.querySelector('th').append(variant(true))
    const cells = table.querySelectorAll('td')
    cells[0].append(variant(false))
    cells[1].append(variant(true))
    article.append(table)
  })
}

/**
 * A kind badge inside a link carries no dotted line, sits centred on the
 * name's text, and leads it by about a quarter em.
 */
export async function checkKindBadgeLinks(browser, base, { sample = false, entries = BADGE_LINKS } = {}) {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1600, height: 1000 } })
  const page = await context.newPage()
  page.setDefaultTimeout(process.env.CI ? 20000 : 10000)
  const failures = []
  try {
    for (const path of new Set(entries.filter((entry) => !sample || entry.sample).map((entry) => entry.path))) {
      await page.goto(`${base}${path}`, { waitUntil: 'load' })
      await page.waitForFunction(() => document.documentElement.dataset.pageReadiness === 'ready')
      // A hover preview opens over the page and would differ between the two paints.
      await page.addStyleTag({ content: '.reference-link-preview { display: none !important; }' })
      for (const entry of entries.filter((candidate) => candidate.path === path && (!sample || candidate.sample))) {
        await entry.prepare?.(page)
        const variants = [{ label: entry.label, badges: entry.badges, line: entry.line, gap: entry.gap, centre: entry.centre }]
        if (entry.fixtures) {
          await addBadgeLinkFixtures(page)
          variants.push(
            { label: `${entry.label} in a heading`, badges: '[data-fixture="heading"] .api-link-kind', line: true },
            { label: `${entry.label} in a table`, badges: '[data-fixture="table"] .api-link-kind', line: true })
        }
        for (const { label, badges, line, gap: checkGap, centre: checkCentre } of variants) {
          // A closed disclosure lays out nothing to measure.
          await page.evaluate((selector) => {
            for (const badge of document.querySelectorAll(selector)) {
              for (let fold = badge.closest('details'); fold; fold = fold.parentElement?.closest('details')) fold.open = true
            }
          }, badges)
          const found = page.locator(badges).filter({ visible: true })
          const count = Math.min(await found.count(), 6)
          assert(count > 0, `${path}: no ${label} badge to measure`)
          for (let index = 0; index < count; index++) {
            const badge = found.nth(index)
            const measured = await describeBadgeLink(badge)
            const where = `${label} "${measured.name}"`
            if (measured.badgeOwners.length) failures.push(`${where}: a decoration reaches the badge (${measured.badgeOwners.join('; ')})`)
            if (measured.preview && (measured.nameOwners.length !== 1 || !measured.nameOwners[0].endsWith('underline dotted'))) {
              failures.push(`${where}: the name needs exactly one dotted underline (${measured.nameOwners.join('; ') || 'none'})`)
            }
            if (checkCentre !== false && Math.abs(measured.centre) > 1) failures.push(`${where}: badge centre is ${measured.centre.toFixed(2)}px from the text centre`)
            if (checkGap !== false && (measured.gap < BADGE_GAP.min || measured.gap > BADGE_GAP.max)) failures.push(`${where}: badge gap is ${measured.gap.toFixed(3)}em, not about .25em`)
            if (line && measured.lineExcess > 1) failures.push(`${where}: the link is ${measured.lineExcess.toFixed(2)}px taller than its line`)
          }
          // The rendered badge, hovered or not, must match the same page drawn without decorations.
          const first = found.first()
          if (await paintsBadgeDecoration(page, first)) failures.push(`${label}: the badge's rendered box is underlined`)
          await first.hover()
          if (await paintsBadgeDecoration(page, first)) failures.push(`${label}: the badge is underlined while hovered`)
          await page.mouse.move(0, 0)
        }
      }
    }
    assert.deepEqual(failures, [], 'Kind badges inside links')
    console.log(`Kind badges: ${sample ? 'sampled' : 'every'} link variant has no underline on the badge, a centred badge and a quarter-em gap PASS`)
  } finally {
    await context.close()
  }
}

/**
 * A sidebar with no badged row has nothing to measure and must fail, not pass
 * empty. A guide's sidebar is plain links, so each sidebar selector is asked
 * of it alone and has to report the missing badge by its own name.
 */
export async function checkKindBadgeLinksFail(browser, base) {
  for (const entry of SIDEBAR_BADGE_LINKS) {
    await assert.rejects(checkKindBadgeLinks(browser, base, { entries: [{ ...entry, path: '/py/stable/workspace/guides/' }] }),
      new RegExp(`no ${entry.label} badge to measure`))
  }
  console.log(`Kind badges: a sidebar without badged rows fails each of its ${SIDEBAR_BADGE_LINKS.length} selectors PASS`)
}

/** Overview pages with cards, then a prose page whose inline preview links must keep their line. */
const BLOCK_LINK_PAGES = [
  { path: '/ts/latest/workspace/', sample: true },
  { path: '/rs/latest/' },
  { path: '/go/latest/mcp/' },
  { path: '/rs/latest/concepts/server-session-window-pane/', inline: true, sample: true },
]

/** Link elements whose own text decoration is dotted, with why each is not an inline text run. */
function dottedDecorations() {
  const blocks = 'h1, h2, h3, h4, h5, h6, p, div, ul, ol, li, table, pre, section, article, aside, blockquote, dl'
  const found = []
  for (const element of document.body.querySelectorAll('*')) {
    const style = getComputedStyle(element)
    if (!style.textDecorationLine.includes('underline') || style.textDecorationStyle !== 'dotted') continue
    // An abbreviation's own dotted line is not a preview.
    const link = element.closest('a')
    if (!link) continue
    const display = getComputedStyle(link).display
    const wrapped = link.querySelector(blocks)
    const reason = !/^(inline|inline-flex|inline-block)$/.test(display) ? `a ${display} link`
      : wrapped ? `a link wrapping <${wrapped.tagName.toLowerCase()}>` : ''
    found.push({ element: `${element.tagName.toLowerCase()}${element.className ? `.${String(element.className).split(' ')[0]}` : ''}`,
      href: link.getAttribute('href'), reason })
  }
  return found
}

/**
 * A card or other block link shows its own summary, so it takes no preview
 * line; only inline text runs carry the dotted underline.
 */
export async function checkBlockLinksUndecorated(browser, base, { sample = false } = {}) {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  page.setDefaultTimeout(process.env.CI ? 20000 : 10000)
  const failures = []
  try {
    for (const { path, inline } of BLOCK_LINK_PAGES.filter((entry) => !sample || entry.sample)) {
      await page.goto(`${base}${path}`, { waitUntil: 'load' })
      await page.waitForFunction(() => document.documentElement.dataset.pageReadiness === 'ready')
      // Hovering is what asks for a preview, so exercise every block link on the page.
      const cards = page.locator('main a[href]').filter({ has: page.locator('h1, h2, h3, h4, h5, h6, p') })
      for (let index = 0; index < Math.min(await cards.count(), 8); index++) {
        await cards.nth(index).hover()
        // The preview waits 180ms before it marks a link, so wait past that dwell.
        await page.waitForTimeout(400)
      }
      await page.mouse.move(0, 0)
      const dotted = await page.evaluate(dottedDecorations)
      for (const { element, href, reason } of dotted) {
        if (reason) failures.push(`${path}: ${element} (${href}) carries a dotted line but is ${reason}`)
      }
      if (inline) assert(dotted.some(({ reason }) => !reason), `${path}: an inline preview link keeps its dotted line`)
    }
    assert.deepEqual(failures, [], 'Block links with a preview line')
    console.log(`Block links: ${sample ? 'sampled' : 'every'} overview card page keeps preview lines on inline links only PASS`)
  } finally {
    await context.close()
  }
}

/**
 * The port and version a link's destination is a core reference of, if it is one.
 *
 * A port's core reference is a tree of its own, built for one version of the port. `ports`, `segment` (the part of the path
 * that makes a page a core reference) and `root` are the site's own: `PORTS`, `referenceSegment` and the mount of the build.
 *
 * @param {string} pathname the path of the link, root included
 * @param {{ root: string, ports: readonly { slug: string, versionedDocs: boolean }[], segment: string }} build
 */
function coreReference(pathname, { root, ports, segment }) {
  const rest = pathname.startsWith(`${root}/`) ? pathname.slice(root.length + 1) : pathname.replace(/^\//, '')
  const parts = rest.split('/')
  const port = ports.find((entry) => entry.slug === parts[0])
  if (!port) return undefined
  const at = port.versionedDocs ? 2 : 1
  if (parts.slice(at, at + segment.split('/').length).join('/') !== segment) return undefined
  return { port, version: port.versionedDocs ? parts[1] : undefined }
}

/**
 * Whether the build under test contains the destination of a link, as far as a preview payload is concerned.
 *
 * The build under test serves one version of each port's core reference: `version`, the one its own target names. A link
 * to another version of a port's reference leaves for a tree this build does not contain, such as the Python reference that
 * the other ports' pages link to at its default, `stable`. That tree exists in the assembly, where the port's own shell build
 * renders it at `/<slug>/<version>/reference/` with its payloads; `reference-previews.test.ts` checks them there.
 * Everything else is served at whatever version a link names: tmux's pages, a product's pages, the glossary.
 *
 * @param {string} pathname the path of the link, root included
 * @param {{ root: string, ports: readonly { slug: string, versionedDocs: boolean }[], version: string, segment: string }} build
 */
export function servedByBuild(pathname, build) {
  const target = coreReference(pathname, build)
  return !target || target.version === undefined || target.version === build.version
}

/**
 * Whether a destination is a core reference of a port whose publisher owns its version tree (`publishesOwnTree`), at a
 * version this build does not serve: the one kind of destination the check leaves out, so that what it leaves out is
 * bounded by what the site says and not by what the check finds convenient.
 *
 * @param {string} pathname the path of the link, root included
 * @param {{ root: string, ports: readonly { slug: string, versionedDocs: boolean, publishesOwnTree?: boolean }[], version: string, segment: string }} build
 */
export function ownTreeElsewhere(pathname, build) {
  const target = coreReference(pathname, build)
  return Boolean(target?.port.publishesOwnTree) && target?.version !== undefined && target.version !== build.version
}

/**
 * The links of `hrefs` that the build serves and that have no payload, and the ones it does not serve, which are not asked.
 * A payload is at the path of the page with `.preview.json`, as the preview policy computes it.
 */
export async function payloadGaps(request, origin, hrefs, served) {
  const missing = []
  const skipped = []
  for (const href of hrefs) {
    if (served && !served(href)) { skipped.push(href); continue }
    const response = await request.get(`${origin}${href.slice(0, -1)}.preview.json`)
    if (!response.ok()) missing.push(`${href} answers ${response.status()}`)
  }
  return { missing, skipped }
}

/**
 * A link marked for a preview card has a card to show. A C function a method links to carried `data-link-preview` and
 * opened nothing, because no preview payload was served at its address. Hovering the link is what asks for the card,
 * so hover it and read the card, then ask the same of every marked link on the pages whose destination the build
 * serves (`served`, from `servedByBuild`; without it every destination is asked), and of one that has no payload.
 */
export async function checkTmuxReferencePreviews(browser, base, { served: build } = {}) {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  page.setDefaultTimeout(process.env.CI ? 20000 : 10000)
  const opened = () => page.evaluate(() => document.getElementById('reference-link-preview')?.matches(':popover-open') ?? false)
  const origin = new URL(base).origin
  const served = build ? (href) => servedByBuild(href, build) : undefined
  try {
    await page.goto(`${base}/cxx/latest/reference/libtmux-server-panes/`, { waitUntil: 'load' })
    await page.waitForFunction(() => document.documentElement.dataset.pageReadiness === 'ready')
    const link = page.locator('p.gp-sphinx-api-mentions .tmux-send a[data-link-preview]').first()
    assert.equal(await link.count(), 1, 'The method page has no C function link marked for a preview')
    assert.equal(await link.textContent(), 'cmd_list_panes_server')
    await link.hover()
    // The first request for a declaration's card compiles its route in the dev server.
    await page.waitForFunction(() => document.getElementById('reference-link-preview')?.matches(':popover-open'), null, { timeout: 60000 })
    assert.equal(await page.locator('#reference-link-preview [data-preview-title]').textContent(), 'cmd_list_panes_server')
    assert.match(await page.locator('#reference-link-preview [data-preview-signature]').textContent(), /^static void cmd_list_panes_server\(struct cmd \*, struct cmdq_item \*\)$/)
    assert.match(await page.locator('#reference-link-preview [data-preview-open]').getAttribute('href'), /\/tmux\/latest\/reference\/c-function-cmd-list-panes-c-cmd_list_panes_server\/$/)
    // Every link a page marks for a card, whose destination the build serves, has a payload at the address the card asks for.
    const missing = []
    const skipped = new Set()
    const questioned = new Set()
    let asked = 0
    for (const path of ['/cxx/latest/reference/libtmux-server-panes/', '/tmux/latest/manual/list-panes/', '/tmux/latest/reference/c-function-cmd-list-panes-c-cmd_list_panes_server/', '/tmux/latest/reference/c-struct-window_pane/']) {
      await page.goto(`${base}${path}`, { waitUntil: 'load' })
      await page.waitForFunction(() => document.documentElement.dataset.pageReadiness === 'ready')
      const hrefs = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[data-link-preview]')].map((anchor) => new URL(anchor.href).pathname))])
      const gaps = await payloadGaps(page.request, origin, hrefs, served)
      asked += hrefs.length - gaps.skipped.length
      for (const href of gaps.skipped) skipped.add(href)
      for (const href of hrefs) if (!gaps.skipped.includes(href)) questioned.add(href)
      missing.push(...gaps.missing.map((gap) => `${path}: ${gap}`))
    }
    assert(asked > 3, `Only ${asked} links were asked for a payload, so the pages were not measured`)
    assert.deepEqual(missing, [], `A link marked for a card that has none:\n${missing.join('\n')}`)
    // What was left out is bounded by what the site says: only reference trees that a port's publisher owns, at versions this build does not serve.
    if (build) {
      assert.deepEqual([...skipped].filter((href) => !ownTreeElsewhere(href, build)), [], 'A destination was left out of the payload check that is not another version of a port tree')
      assert.deepEqual([...questioned].filter((href) => ownTreeElsewhere(href, build)), [], 'A destination in another version of a port tree was asked for a payload')
    }
    // The controls. A payload missing on a destination the build serves is reported, and a destination it does not serve is
    // left out and not reported, so the sweep cannot go green by skipping what it should have asked.
    if (served) {
      const kept = `${build.root}/${build.ports[0].slug}/${build.version}/${build.segment}/no-such-declaration/`
      const elsewhere = build.version === 'stable' ? 'latest' : 'stable'
      const away = `${build.root}/${build.ports.find((port) => port.versionedDocs).slug}/${elsewhere}/${build.segment}/no-such-declaration/`
      const control = await payloadGaps(page.request, origin, [kept, away], served)
      assert.deepEqual(control.missing, [`${kept} answers 404`], 'A payload missing on a served port was not reported')
      assert.deepEqual(control.skipped, [away], 'A destination the build does not serve was asked for a payload')
    }
    // A link marked for a card whose payload does not exist opens nothing.
    await page.goto(`${base}/tmux/latest/manual/list-panes/`, { waitUntil: 'load' })
    await page.waitForFunction(() => document.documentElement.dataset.pageReadiness === 'ready')
    await page.evaluate(() => {
      const anchor = document.createElement('a')
      anchor.id = 'no-card'
      anchor.href = '/en/tmux/latest/reference/c-function-no-such-declaration/'
      anchor.textContent = 'no_such_declaration'
      document.querySelector('main').prepend(anchor)
    })
    const absent = await page.request.get(`${origin}/en/tmux/latest/reference/c-function-no-such-declaration.preview.json`)
    assert.equal(absent.status(), 404, 'The control address answered, so the sweep cannot show a missing payload')
    // The pointer arrives as the browser delivers it, to the link itself, so a sticky header over the top of the page cannot take it.
    await page.evaluate(() => document.getElementById('no-card').dispatchEvent(new PointerEvent('pointerover', { pointerType: 'mouse', bubbles: true })))
    await page.waitForTimeout(700)
    assert.equal(await opened(), false, 'A link with no payload opened a card')
    console.log(`Tmux reference previews: the C function link of a method page opens its card with its signature; ${asked} marked links on four pages each have a payload (${skipped.size} to trees this build does not serve were not asked); a payload missing on a served port is reported, and a link with none opens nothing PASS`)
  } finally { await context.close() }
}
