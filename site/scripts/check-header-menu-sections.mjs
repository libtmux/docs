import assert from 'node:assert/strict'

/**
 * The header's packages disclosure names each kind of destination (Source,
 * Packages, API reference) with a heading over its rows. A heading is a label:
 * it takes no focus, shows no pointer or hover state, names its group for
 * assistive technology, and goes when filtering leaves its group empty.
 */
const PORTS_WITH_PRODUCTS = ['py', 'java', 'csharp']
// C++ lists source directories only, so its disclosure carries no heading at all.
const PORT_WITH_ONE_PRODUCT = 'cxx'
const KINDS = ['destinations']
const PAINT = ['backgroundColor', 'color', 'cursor', 'textDecorationLine', 'outlineStyle', 'boxShadow', 'opacity', 'transform', 'borderTopColor']
const INTERACTIVE = 'a, button, input, select, textarea, summary, [tabindex], [role], [contenteditable]'

/** The rules and markup the menus shipped with before headings: product rows styled as links. */
const LEGACY_CSS = `
.header-picker__group + .header-picker__group { margin-top: .4rem !important; }
.header-picker__group-title { display: flex; align-items: center; gap: .6rem; margin: .5rem .6rem .25rem; line-height: 1.35; }
.header-picker__group-title img { flex: none; width: 1.5rem; height: 1.5rem; object-fit: contain; }
.header-picker__group-title strong { display: block; font-size: .8125rem; font-weight: 500; }
.header-picker__group-title small { display: block; font-size: .6875rem; color: var(--color-muted); }
.header-picker__group > .header-picker__option { margin-inline-start: 0 !important; }
`

const legacyMarkup = () => {
  const element = (tag, text) => Object.assign(document.createElement(tag), text === undefined ? {} : { textContent: text })
  for (const group of document.querySelectorAll('[data-picker-group][role="group"]')) {
    const label = document.getElementById(group.getAttribute('aria-labelledby')).textContent
    group.removeAttribute('aria-labelledby')
    group.setAttribute('aria-label', label)
    const title = element('p')
    title.className = 'header-picker__group-title'
    const art = Object.assign(element('img'), { width: 24, height: 24, alt: '' })
    const text = element('span')
    text.append(element('strong', label), element('small', 'API reference and guides'))
    title.append(art, text)
    group.firstElementChild.replaceWith(title)
  }
}

const channel = (value) => {
  const v = value / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
/** Parse `rgb()`, `rgba()` or `color(srgb …)` as a computed style reports it. */
const rgbOf = (css) => {
  const parts = css.match(/-?\d*\.?\d+/g)?.map(Number) ?? []
  assert(parts.length >= 3, `unreadable colour ${css}`)
  const scale = css.startsWith('color(') ? 255 : 1
  return { rgb: parts.slice(0, 3).map((part) => part * scale), alpha: parts[3] ?? 1 }
}
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Everything a menu's groups and headings look like once open. */
function readMenu(root, interactive) {
  const style = (element, names) => Object.fromEntries(names.map((name) => [name, getComputedStyle(element)[name]]))
  const panel = root.querySelector('[data-picker-panel]')
  const panelRect = panel.getBoundingClientRect()
  return {
    panel: { left: panelRect.left, right: panelRect.right, background: getComputedStyle(panel).backgroundColor },
    overflow: document.documentElement.scrollWidth - innerWidth,
    // A row is a label and one line under it; a paragraph in a menu belongs on a page.
    blocks: [...panel.querySelectorAll('p')].filter((block) => !block.hasAttribute('data-picker-status'))
      .map((block) => ({ text: block.textContent.replace(/\s+/g, ' ').trim(), cls: block.className })),
    rowText: [...root.querySelectorAll('a[data-picker-option]')].map((row) => ({
      name: row.querySelector('.header-picker__name').textContent, smalls: row.querySelectorAll('small').length,
      paragraphs: row.querySelectorAll('p').length, detail: row.querySelector('small')?.textContent.length ?? 0,
    })),
    groups: [...root.querySelectorAll('[data-picker-group]')].map((group) => {
      const labelId = group.getAttribute('aria-labelledby')
      const heading = labelId ? document.getElementById(labelId) : null
      const rows = [...group.querySelectorAll('a[data-picker-option]')]
      const first = rows[0]
      const name = first.querySelector('.header-picker__name')
      const box = (element) => { const { left, right, top, bottom } = element.getBoundingClientRect(); return { left, right, top, bottom } }
      return {
        role: group.getAttribute('role'),
        ariaLabel: group.getAttribute('aria-label'),
        labelledBy: labelId,
        headingFound: Boolean(heading),
        headingInGroup: Boolean(heading && group.contains(heading)),
        headingTag: heading?.tagName,
        headingText: heading?.textContent,
        headingTabIndex: heading?.tabIndex,
        headingHasTabindexAttribute: heading?.hasAttribute('tabindex'),
        headingInteractive: Boolean(heading && (heading.matches(interactive) || heading.querySelector(interactive) || heading.closest('a, button, summary'))),
        headingStyle: heading && { ...style(heading, ['fontSize', 'fontWeight', 'textTransform', 'letterSpacing', 'color', 'cursor']), clipped: heading.scrollWidth > heading.clientWidth + 1 },
        nameStyle: style(name, ['fontSize', 'fontWeight', 'textTransform', 'letterSpacing', 'color', 'cursor']),
        rowCursor: getComputedStyle(first).cursor,
        heading: heading && box(heading),
        firstRow: box(first),
        lastRow: box(rows.at(-1)),
        iconLeft: first.querySelector('.header-picker__icon').getBoundingClientRect().left,
        hrefs: rows.map((row) => row.getAttribute('href')),
      }
    }),
  }
}

async function checkStatic(page, picker, where, scheme, expectTitled) {
  const menu = await picker.evaluate(readMenu, INTERACTIVE)
  const { groups } = menu
  assert(menu.overflow <= 1, `${where}: the open menu leaves the page without horizontal scroll`)
  assert(menu.panel.left >= -0.5 && menu.panel.right <= (await page.evaluate(() => innerWidth)) + 0.5, `${where}: the open menu stays inside the viewport`)
  for (const row of menu.rowText) {
    assert(row.paragraphs === 0 && row.smalls === 1 && row.detail <= 60, `${where}: ${row.name} shows its label and one short line, not a paragraph (${row.smalls} lines, ${row.detail} characters)`)
  }
  for (const block of menu.blocks) {
    assert(block.text.length <= 48, `${where}: a text block in the menu holds ${block.text.length} characters: "${block.text.slice(0, 60)}"`)
  }
  const titled = groups.length > 1
  assert.equal(titled, expectTitled, `${where}: a list of ${expectTitled ? 'several kinds has' : 'one kind has no'} headings`)
  if (!titled) {
    assert.equal(groups[0].role, null, `${where}: a single group has no group role to name`)
    assert.equal(groups[0].headingFound, false, `${where}: a single group has no heading`)
    return
  }
  const contrastRatios = []
  groups.forEach((group, index) => {
    const label = `${where}, group ${index + 1}`
    assert(group.role === 'group' && group.labelledBy && group.headingFound && !group.ariaLabel,
      `${label}: the group is labelled by its heading (role=${group.role}, aria-labelledby=${group.labelledBy}, aria-label=${group.ariaLabel})`)
    assert(group.headingInGroup, `${label}: the heading is inside its group, so filtering takes it with the group`)
    assert(group.headingText.trim().length > 0 && !/\s{2,}/.test(group.headingText), `${label}: the heading is one plain label (${group.headingText})`)
    assert(!group.headingInteractive && !group.headingHasTabindexAttribute && group.headingTabIndex === -1, `${label}: the heading is not focusable or interactive`)
    const { headingStyle: head, nameStyle: item } = group
    assert(head.cursor !== 'pointer' && group.rowCursor === 'pointer', `${label}: the heading has no pointer cursor (heading ${head.cursor}, row ${group.rowCursor})`)
    assert(Number.parseFloat(head.fontSize) <= Number.parseFloat(item.fontSize) - 1, `${label}: heading typography is smaller than item typography (${head.fontSize} vs ${item.fontSize})`)
    assert(head.textTransform !== item.textTransform, `${label}: heading typography differs in case (${head.textTransform} vs ${item.textTransform})`)
    assert(head.color !== item.color, `${label}: heading typography differs in colour (${head.color})`)
    assert(!head.clipped, `${label}: the heading is not clipped`)
    // The heading owns the rows after it: rows sit inset from its text, close to it, and a larger gap precedes it.
    assert(group.iconLeft - group.heading.left >= 4, `${label}: rows are inset under the heading (${group.iconLeft - group.heading.left}px)`)
    assert(group.firstRow.top >= group.heading.bottom - 1, `${label}: the heading precedes its rows`)
    if (index > 0) {
      const before = group.heading.top - groups[index - 1].lastRow.bottom
      const after = group.firstRow.top - group.heading.bottom
      assert(before >= 4 && before > after, `${label}: the gap before a heading (${before}px) exceeds the gap after it (${after}px)`)
    }
    const text = rgbOf(head.color)
    const background = rgbOf(menu.panel.background)
    assert.equal(background.alpha, 1, `${label}: the panel background is opaque`)
    contrastRatios.push(contrast(text.rgb, background.rgb))
  })
  assert(Math.min(...contrastRatios) >= 4.5, `${where} (${scheme}): heading text meets 4.5:1 contrast (${Math.min(...contrastRatios).toFixed(2)})`)
}

const paintOf = (element, names) => Object.fromEntries(names.map((name) => [name, getComputedStyle(element)[name]]))

async function checkInteraction(page, picker, where) {
  const headings = picker.locator('[data-picker-group] [id^="header-picker-"]')
  const groups = await picker.locator('[data-picker-group]').count()
  const url = page.url()
  for (let index = 0; index < groups; index++) {
    const heading = picker.locator('[data-picker-group]').nth(index).locator('[id^="header-picker-"]')
    const before = await heading.evaluate(paintOf, PAINT)
    await heading.hover()
    assert.deepEqual(await heading.evaluate(paintOf, PAINT), before, `${where}: hovering a heading changes nothing (no hover state)`)
    await page.mouse.down()
    assert.deepEqual(await heading.evaluate(paintOf, PAINT), before, `${where}: pressing a heading changes nothing (no active state)`)
    await page.mouse.up()
    assert.equal(await picker.evaluate((element) => element.open), true, `${where}: clicking a heading leaves the menu open`)
    assert.equal(page.url(), url, `${where}: a heading is not a link`)
    assert(await heading.evaluate((element) => !element.contains(document.activeElement)), `${where}: clicking a heading does not focus it`)
  }
  // The control: a row does show a hover state, so the comparison above could have caught one.
  const row = picker.locator('a[data-picker-option]').first()
  const rowBefore = await row.evaluate(paintOf, PAINT)
  await row.hover()
  assert.notDeepEqual(await row.evaluate(paintOf, PAINT), rowBefore, `${where}: a row's hover state is measurable`)
  await page.mouse.move(0, 0)
  assert.equal(await headings.count(), groups, `${where}: one heading per group`)
}

async function checkKeyboard(page, picker, where) {
  const hrefs = await picker.locator('a[data-picker-option]').evaluateAll((rows) => rows.map((row) => row.getAttribute('href')))
  const search = picker.locator('[data-picker-search]')
  if (!await search.count()) return
  const focused = () => page.evaluate(() => {
    const active = document.activeElement
    return { row: active.matches('a[data-picker-option]'), href: active.getAttribute?.('href'), heading: Boolean(active.closest?.('[id^="header-picker-"]')) }
  })
  await search.focus()
  const tabbed = []
  for (const _ of hrefs) {
    await page.keyboard.press('Tab')
    const state = await focused()
    assert(!state.heading && state.row, `${where}: Tab lands on rows, never a heading`)
    tabbed.push(state.href)
  }
  assert.deepEqual(tabbed, hrefs, `${where}: Tab visits every row in order and no heading`)
  await search.focus()
  const arrowed = []
  for (const _ of hrefs) {
    await page.keyboard.press('ArrowDown')
    const state = await focused()
    assert(!state.heading && state.row, `${where}: ArrowDown skips headings`)
    arrowed.push(state.href)
  }
  assert.deepEqual(arrowed, hrefs, `${where}: ArrowDown walks the rows past each heading`)
  await page.keyboard.press('ArrowDown')
  assert.equal((await focused()).href, hrefs[0], `${where}: ArrowDown wraps to the first row`)
  await page.keyboard.press('ArrowUp')
  assert.equal((await focused()).href, hrefs.at(-1), `${where}: ArrowUp wraps to the last row`)
}

async function checkFilter(page, picker, where, titled) {
  const search = picker.locator('[data-picker-search]')
  if (!await search.count()) return
  const visibility = () => picker.evaluate((root) => [...root.querySelectorAll('[data-picker-group]')].map((group) => {
    const heading = group.getAttribute('aria-labelledby') && document.getElementById(group.getAttribute('aria-labelledby'))
    return {
      rows: [...group.querySelectorAll('a[data-picker-option]')].filter((row) => row.checkVisibility()).length,
      heading: heading ? heading.checkVisibility() : null,
      name: heading?.textContent,
    }
  }))
  // The last group's host name is in no row of an earlier group.
  const lastRowLabel = await picker.locator('[data-picker-group]').last().locator('small').first().textContent()
  await search.fill(lastRowLabel)
  const filtered = await visibility()
  if (titled) {
    filtered.forEach(({ rows, heading, name }) => assert.equal(heading, rows > 0, `${where}: filtering "${lastRowLabel}" shows "${name}" only while its group has matches`))
    assert(filtered.some(({ rows }) => rows === 0) && filtered.some(({ rows }) => rows > 0), `${where}: the filter hides some groups and keeps another`)
    for (const { rows, name } of filtered) {
      assert.equal(await picker.getByRole('group', { name, exact: true }).count(), rows > 0 ? 1 : 0, `${where}: assistive technology hears "${name}" only while it has matches`)
    }
  }
  await search.fill('zzz-no-such-destination')
  const none = await visibility()
  assert(none.every(({ rows, heading }) => rows === 0 && heading !== true), `${where}: a filter with no match hides every heading`)
  assert(await picker.locator('[data-picker-empty]').isVisible(), `${where}: the empty state shows when every group is hidden`)
  await search.fill('')
  const restored = await visibility()
  assert(restored.every(({ rows, heading }) => rows > 0 && (!titled || heading === true)), `${where}: clearing the filter restores every heading`)
  if (titled) {
    for (const { name } of restored) assert.equal(await picker.getByRole('group', { name, exact: true }).count(), 1, `${where}: the group "${name}" is announced once`)
  }
}

/**
 * Check the section headings of the packages disclosure on Python, Java and
 * .NET (several kinds of destination) and C++ (one kind).
 */
export async function checkHeaderMenuSections(browser, base, options = {}) {
  const { ports = [...PORTS_WITH_PRODUCTS, PORT_WITH_ONE_PRODUCT], widths = [1440, 390], schemes = ['light', 'dark'],
    kinds = KINDS, behavior = true, sabotage } = options
  let menus = 0
  for (const scheme of schemes) {
    const context = await browser.newContext({ colorScheme: scheme, reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.setDefaultTimeout(process.env.CI ? 20000 : 10000)
    // The first load of each port compiles its page in the development server.
    page.setDefaultNavigationTimeout(60000)
    try {
      for (const port of ports) {
        for (const width of widths) {
          await page.setViewportSize({ width, height: 900 })
          // The development server can replace a page while it optimizes dependencies; load it again once.
          for (const attempt of [1, 2]) {
            try {
              await page.goto(`${base}/${port}/latest/`, { waitUntil: 'load' })
              await page.waitForFunction(() => document.fonts.status === 'loaded')
              await page.waitForSelector('details[data-header-picker][data-enhanced]', { state: 'attached' })
              break
            } catch (error) {
              if (attempt === 2) throw error
            }
          }
          assert.equal(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches), scheme === 'dark', `${port}: the ${scheme} scheme is in effect`)
          if (sabotage?.css) await page.addStyleTag({ content: sabotage.css })
          if (sabotage?.script) await page.evaluate(sabotage.script)
          const placement = width >= 768 ? 'bar' : 'menu'
          if (placement === 'menu') await page.locator('.site-header__menu > summary').click()
          for (const kind of kinds) {
            const picker = page.locator(`details[data-header-picker="${kind}"][data-placement="${placement}"]`)
            if (!await picker.count()) continue
            const where = `${port} ${kind} at ${width}px (${scheme})`
            await picker.locator(':scope > summary').click()
            await picker.locator('[data-picker-panel]').waitFor({ state: 'visible' })
            const expectTitled = port !== PORT_WITH_ONE_PRODUCT
            await checkStatic(page, picker, where, scheme, expectTitled)
            if (behavior && width === 1440 && scheme === 'light') {
              if (expectTitled) await checkInteraction(page, picker, where)
              await checkKeyboard(page, picker, where)
              await checkFilter(page, picker, where, expectTitled)
            }
            await picker.locator(':scope > summary').click()
            await picker.locator('[data-picker-panel]').waitFor({ state: 'hidden' })
            menus += 1
          }
        }
      }
    } finally {
      await context.close()
    }
  }
  console.log(`Header menu sections: ${menus} menus on ${ports.join(', ')} show non-interactive kind headings; ${behavior ? 'Tab and arrows skip them, hover and press change nothing, filtering hides empty groups' : 'structure and typography only'}`)
}

/** The check must fail on origin/main's menus and on each way a heading could become a row again. */
export async function checkHeaderMenuSectionsFail(browser, base) {
  const only = { ports: ['py'], kinds: ['destinations'], widths: [1440], schemes: ['light'] }
  const controls = [
    ['origin/main markup and CSS', { script: legacyMarkup, css: LEGACY_CSS }, /group is labelled by its heading/],
    ['a focusable heading', { script: () => document.querySelectorAll('[data-picker-group] > p').forEach((p) => p.setAttribute('tabindex', '0')) }, /heading is not focusable or interactive/],
    ['a heading with a pointer cursor', { css: '.header-picker__heading { cursor: pointer !important }' }, /no pointer cursor/],
    ['a heading with a hover state', { css: '.header-picker__heading:hover { background: #f00 !important }' }, /hovering a heading changes nothing/],
    ['item typography on a heading', { css: '.header-picker__heading { font-size: .8125rem !important; text-transform: none !important; color: inherit !important }' }, /heading typography is smaller/],
    ['rows flush with their heading', { css: '.header-picker__group > .header-picker__option { margin-inline-start: 0 !important } .header-picker__heading { margin-inline: 1.2rem !important }' }, /rows are inset under the heading/],
    ['a paragraph under a kind heading', {
      script: () => document.querySelectorAll('[data-picker-group]').forEach((group) => group.querySelector('a').before(Object.assign(document.createElement('p'), { textContent: 'Maintained as a working example of core library usage and deployment. Example APIs, tools and configuration may change without a compatibility or product support commitment.' }))),
    }, /a text block in the menu holds/],
    ['headings that filtering leaves behind', {
      script: () => document.querySelectorAll('[data-picker-group]').forEach((group) => group.style.setProperty('display', 'block', 'important')),
    }, /only while its group has matches/],
  ]
  for (const [name, sabotage, failure] of controls) {
    await assert.rejects(() => checkHeaderMenuSections(browser, base, { ...only, sabotage }), failure, `the check fails with ${name}`)
  }
  console.log('Header menu sections: the check fails on origin/main markup and CSS, a paragraph in a menu, and focusable, pointer, hover, plain-typography, flush and unfiltered headings')
}
