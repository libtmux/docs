import assert from 'node:assert/strict'

/** Controls beside a signature may sit this far from the centre of its first line. */
const LEVEL_TOLERANCE = 1

/** Centres further apart than this belong to different rows of wrapped controls. */
const STACKED_ROW_GAP = 8

/** Measure the code width left by first-line or stacked declaration metadata. */
export async function checkNativeSignatureGeometry(header) {
  const geometry = await header.evaluate((element) => {
    const pixels = (value) => value === 'normal' ? 0 : Number.parseFloat(value)
    const read = (region) => {
      if (!region) return null
      const rect = region.getBoundingClientRect()
      const style = element.ownerDocument.defaultView.getComputedStyle(region)
      return {
        left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        width: rect.width, height: rect.height,
        insets: {
          left: pixels(style.paddingLeft) + pixels(style.borderLeftWidth),
          right: pixels(style.paddingRight) + pixels(style.borderRightWidth),
          top: pixels(style.paddingTop) + pixels(style.borderTopWidth),
          bottom: pixels(style.paddingBottom) + pixels(style.borderBottomWidth),
        },
        rowGap: pixels(style.rowGap), columnGap: pixels(style.columnGap),
        lineHeight: pixels(style.lineHeight),
      }
    }
    const row = element.querySelector(':scope > .gp-sphinx-api-layout')
    return {
      header: read(element), row: read(row),
      code: read(row?.querySelector(':scope > .gp-sphinx-api-layout-left')),
      controls: read(row?.querySelector(':scope > .gp-sphinx-api-layout-right')),
      firstSignature: read(row?.querySelector('.api-native-signature')),
    }
  })
  // Allow subpixel layout rounding, not an unused strip of code width.
  const tolerance = 1 / 16
  const near = (a, b) => Math.abs(a - b) <= tolerance
  const content = (region) => ({
    left: region.left + region.insets.left, right: region.right - region.insets.right,
    top: region.top + region.insets.top, bottom: region.bottom - region.insets.bottom,
  })
  const contained = (inner, outer) => inner.left >= outer.left - tolerance && inner.right <= outer.right + tolerance
    && inner.top >= outer.top - tolerance && inner.bottom <= outer.bottom + tolerance
  for (const [name, region] of Object.entries(geometry)) {
    assert(region, `Native signature ${name} region is present`)
    assert(Object.values(region.insets).every(Number.isFinite)
      && [region.left, region.right, region.top, region.bottom, region.width, region.height].every(Number.isFinite)
      && region.width > 0 && region.height > 0
      && near(region.width, region.right - region.left) && near(region.height, region.bottom - region.top),
    `Native signature ${name} has measurable bounds and insets`)
  }
  const { row, code, controls, firstSignature } = geometry
  const headerContent = content(geometry.header)
  const rowContent = content(row)
  assert(contained(row, headerContent), 'Native signature row is contained in the padded header')
  assert(near(row.left, headerContent.left) && near(row.right, headerContent.right),
    'Native signature row uses the available header width')
  assert(contained(code, rowContent), 'Native signature code is contained in its layout row')
  assert(contained(controls, rowContent), 'Native signature metadata is contained in its layout row')
  assert(contained(firstSignature, content(code)), 'Native first signature is contained in the code region')
  assert(near(code.left, rowContent.left) && near(code.top, rowContent.top),
    'Native signature code begins at the layout row origin')
  assert(near(controls.right, rowContent.right), 'Native signature metadata reaches the layout row edge')
  assert(Number.isFinite(row.rowGap) && row.rowGap >= 0 && Number.isFinite(row.columnGap) && row.columnGap >= 0,
    'Native signature row has measurable gaps')
  const below = controls.top >= code.bottom - tolerance
  const beside = controls.left >= code.right - tolerance
  assert(below || beside, 'Native signature code and metadata do not overlap')
  if (!below) {
    assert(near(firstSignature.top, code.top) && controls.top >= code.top - tolerance
      && controls.bottom <= firstSignature.bottom + tolerance,
    'Native signature metadata stays on the first line')
    assert(firstSignature.lineHeight > 0, 'Native first signature has a measurable line height')
    const firstLine = content(firstSignature).top + firstSignature.lineHeight / 2
    assert(Math.abs(controls.top + controls.height / 2 - firstLine) <= LEVEL_TOLERANCE,
      'Native signature metadata centres on the first line')
  }
  const availableCodeWidth = rowContent.right - rowContent.left - (below ? 0 : controls.width + row.columnGap)
  assert(near(code.width, availableCodeWidth), 'Native signature uses the available code width')
  assert(near(below ? controls.top - code.bottom : controls.left - code.right, below ? row.rowGap : row.columnGap),
    'Native signature metadata follows the computed layout gap')
  await checkNativeSignatureLines(header)
  return { ...geometry, mode: below ? 'stacked' : 'inline', availableCodeWidth }
}

/**
 * Locate a declaration's first signature line and the vertical centre of each
 * control in its right-hand group. The first line box starts at the content
 * edge of the block that owns the first painted glyph and is one used
 * line-height tall; a heading with `line-height: normal` has no declared
 * height, so its first glyph's box stands in.
 */
export async function measureDeclarationControls(header) {
  return header.evaluate((element) => {
    const document = element.ownerDocument
    const pixels = (value) => Number.parseFloat(value)
    const row = element.querySelector(':scope > .gp-sphinx-api-layout')
    const code = row?.querySelector(':scope > .gp-sphinx-api-layout-left')
    const group = row?.querySelector(':scope > .gp-sphinx-api-layout-right')
    if (!code || !group?.checkVisibility()) return null
    const walker = document.createTreeWalker(code, document.defaultView.NodeFilter.SHOW_TEXT)
    let glyph = null
    for (let node; !glyph && (node = walker.nextNode());) {
      const start = node.textContent.search(/\S/)
      if (start < 0 || node.parentElement.closest('[popover]') || !node.parentElement.checkVisibility()) continue
      const range = document.createRange()
      range.setStart(node, start)
      range.setEnd(node, start + 1)
      const box = range.getBoundingClientRect()
      if (box.width && box.height) glyph = { node, box }
    }
    if (!glyph) return null
    const view = document.defaultView
    let owner = glyph.node.parentElement
    while (view.getComputedStyle(owner).display.startsWith('inline')) owner = owner.parentElement
    const style = view.getComputedStyle(owner)
    const lineHeight = pixels(style.lineHeight)
    const height = Number.isFinite(lineHeight) ? lineHeight : glyph.box.height
    const top = owner.getBoundingClientRect().top + pixels(style.paddingTop) + pixels(style.borderTopWidth)
    const controls = []
    for (const child of group.children) {
      if (!child.checkVisibility()) continue
      for (const control of child.matches('.gp-sphinx-api-slot') ? child.children : [child]) {
        if (!control.checkVisibility()) continue
        const box = control.getBoundingClientRect()
        controls.push({ name: control.textContent.trim().slice(0, 16) || control.className, centre: box.top + box.height / 2 })
      }
    }
    const codeBox = code.getBoundingClientRect()
    const groupBox = group.getBoundingClientRect()
    return {
      id: element.getAttribute('data-symbol-id') ?? element.id,
      mode: groupBox.top < codeBox.bottom - 1 && groupBox.bottom > codeBox.top + 1 ? 'beside' : 'stacked',
      line: { top, height, centre: top + height / 2 }, controls,
    }
  })
}

/**
 * Controls beside the code share the centre of its first line, however many
 * lines follow. Controls that wrap below or above the code share the centre of
 * whichever row of controls they sit on.
 */
export function assertDeclarationControlsLevel(measurement, label, tolerance = LEVEL_TOLERANCE) {
  assert(measurement?.controls.length > 0, `${label}: declaration has code and visible controls`)
  const { mode, line, controls } = measurement
  assert(Number.isFinite(line.centre) && controls.every((control) => Number.isFinite(control.centre)),
    `${label}: first line and controls have measurable centres`)
  if (mode === 'beside') {
    for (const control of controls) {
      const offset = control.centre - line.centre
      assert(Math.abs(offset) <= tolerance,
        `${label}: control "${control.name}" centre is ${offset.toFixed(2)}px from the first signature line`)
    }
    return
  }
  // Wrapped controls form rows, and each row is level on its own.
  const rows = []
  for (const { centre } of [...controls].sort((a, b) => a.centre - b.centre)) {
    const row = rows.at(-1)
    if (row && centre - row.at(-1) <= STACKED_ROW_GAP) row.push(centre)
    else rows.push([centre])
  }
  for (const row of rows) {
    const spread = row.at(-1) - row[0]
    assert(spread <= tolerance, `${label}: stacked controls share their row centre, spread ${spread.toFixed(2)}px`)
  }
}

export async function checkDeclarationControlsLevel(header, label) {
  const measurement = await measureDeclarationControls(header)
  assertDeclarationControlsLevel(measurement, label)
  return measurement
}

/** Each sample pairs a page with the declaration shape it contributes. */
const DECLARATION_SAMPLES = [
  ['ts/latest/reference/server-server-sessions/', 'TypeScript one-line formatted method'],
  ['ts/latest/reference/pane-pane-sethook/', 'TypeScript method that fits beside controls at 500px'],
  ['ts/latest/reference/client-client-tostring/', 'TypeScript short method that fits beside controls at 390px'],
  ['go/latest/reference/tmux-server-newsessionconnection/', 'Go multi-line method'],
  ['py/latest/reference/libtmux-hooks-hooksmixin-set_hook/', 'Python wrapped method'],
  ['py/latest/reference/libtmux-server/', 'Python class'],
  ['julia/latest/reference/libtmux-capture_bytes/', 'Julia multi-line function'],
  ['csharp/latest/reference/libtmux-tmuxbuffers-setasync/', 'C# multi-line method'],
  ['kotlin/latest/reference/io-github-libtmux-kotlin-batch/', 'Kotlin type'],
  ['scala/latest/reference/io-github-libtmux-scaladsl-server-windows/', 'Scala overloaded method'],
  ['rs/latest/mcp/tools/get_pane_info/', 'MCP tool and its type definitions'],
]

/**
 * Sample declarations across ports at desktop and narrow widths. A header
 * whose controls fall to a row of their own has no first line to follow, so
 * the sample must still catch controls beside the code at every width it
 * names, or the check would pass without measuring anything.
 */
export async function checkDeclarationControlAlignment(browser, base, widths = [1440, 768, 500, 390]) {
  const page = await browser.newPage({ javaScriptEnabled: false })
  const beside = new Map(widths.map((width) => [width, 0]))
  const measured = []
  try {
    for (const [path, label] of DECLARATION_SAMPLES) {
      await page.goto(`${base}/${path}`, { waitUntil: 'load' })
      await page.evaluate(() => document.fonts.ready)
      const headers = page.locator('dt.gp-sphinx-api-header')
      const count = Math.min(await headers.count(), 6)
      assert(count > 0, `${label}: page has declaration headers`)
      for (const width of widths) {
        await page.setViewportSize({ width, height: 1000 })
        for (let index = 0; index < count; index++) {
          const measurement = await checkDeclarationControlsLevel(headers.nth(index), `${label} #${index + 1} at ${width}px`)
          if (measurement.mode === 'beside') beside.set(width, beside.get(width) + 1)
          measured.push({ label, width, index, ...measurement })
          if (width === widths[0] && index === 0) {
            assert.equal(measurement.mode, 'beside', `${label}: desktop controls sit beside the first line`)
          }
        }
      }
    }
    for (const width of widths) {
      assert(beside.get(width) > 0, `${width}px: some sampled controls sit beside a first line`)
    }
  } finally {
    await page.close()
  }
  return { beside, measured }
}

/** A formatter's logical line must occupy one painted row, even when it scrolls. */
export async function checkNativeSignatureLines(header) {
  const signatures = await header.evaluate((element) => {
    const document = element.ownerDocument
    return [...element.querySelectorAll('.api-native-signature--formatted')].map((signature) => {
      const walk = document.createTreeWalker(signature, document.defaultView.NodeFilter.SHOW_TEXT)
      const lines = [{ text: '', tops: [] }]
      let node
      while ((node = walk.nextNode())) {
        if (node.parentElement.closest('[popover]') || !node.parentElement.checkVisibility({ visibilityProperty: true })) continue
        for (let offset = 0; offset < node.textContent.length;) {
          const char = String.fromCodePoint(node.textContent.codePointAt(offset))
          const end = offset + char.length
          if (char === '\n') lines.push({ text: '', tops: [] })
          else {
            const line = lines.at(-1)
            line.text += char
            if (!/\s/.test(char)) {
              const range = document.createRange()
              range.setStart(node, offset)
              range.setEnd(node, end)
              const rect = range.getBoundingClientRect()
              if (rect.width && rect.height) line.tops.push(rect.top)
            }
          }
          offset = end
        }
      }
      return { text: lines.map((line) => line.text).join('\n'), rows: lines.map((line, index) => ({
        line: index + 1, text: line.text, glyphs: line.tops.length,
        topSpread: line.tops.length ? Math.max(...line.tops) - Math.min(...line.tops) : 0,
      })) }
    })
  })
  for (const [index, signature] of signatures.entries()) {
    assert(signature.text.trim(), `Formatted signature ${index + 1} has visible text`)
    for (const line of signature.rows) {
      if (!line.text.trim()) continue
      assert(line.glyphs > 0, `Formatted signature ${index + 1} line ${line.line} has painted text`)
      assert(Number.isFinite(line.topSpread) && line.topSpread <= 1,
        `Formatted signature ${index + 1} line ${line.line} stays on one painted row: ${line.text}`)
    }
  }
  return signatures
}

/** Bind native parameter anchors to their displayed overload and local fields. */
export async function checkNativeSignatureLinks(header, symbol) {
  assert(symbol?.signatures.length > 0, 'Native signature owner is present in the model')
  const { parameterId } = await import('../../packages/api-model/src/link.ts')
  const displayed = await header.evaluate((element) => ({
    owner: element.getAttribute('data-symbol-id'),
    signatures: [...element.querySelectorAll('.api-native-signature')].map((signature) =>
      [...signature.querySelectorAll('a')].map((link) => ({
        name: link.textContent, href: link.getAttribute('href'), parameter: link.classList.contains('api-parameter-name'),
      }))),
    targets: [...element.ownerDocument.querySelectorAll('[id]')].map((target) => target.id),
  }))
  assert.equal(displayed.owner, symbol.id, 'Native signature owner matches the displayed declaration')
  assert.equal(displayed.signatures.length, symbol.signatures.length, 'Every native overload is displayed')
  for (const [index, links] of displayed.signatures.entries()) {
    const parameters = links.filter((link) => link.parameter)
    assert.deepEqual(parameters.map((link) => link.name), symbol.signatures[index].params.map((parameter) => parameter.name),
      `Native parameter links match overload ${index + 1}`)
    for (const link of parameters) {
      const target = parameterId(symbol, link.name)
      assert.equal(link.href, `#${encodeURIComponent(target)}`, `Native parameter ${link.name} has its exact local destination`)
      assert.equal(displayed.targets.filter((id) => id === target).length, 1,
        `Native parameter ${link.name} resolves to one local target`)
    }
  }
  return displayed.signatures.flat()
}

/** Keep one page picker and visible native header controls. */
export async function checkNativeHeader(page) {
  assert.equal(await page.locator('[data-lt-shell]').count(), 0)
  assert.equal(await page.locator('[data-page-port-switcher]').count(), 1)
  const controls = await page.locator('.site-header').evaluate((container) => {
    const links = [...container.querySelectorAll('summary, a, button')]
      .filter((link) => link.checkVisibility({ visibilityProperty: true }))
    const bounds = links.map((link) => link.getBoundingClientRect())
    return {
      count: links.length,
      visible: bounds.every((rect) => rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= innerWidth),
      covered: links.filter((link, i) => {
        const rect = bounds[i]
        return !link.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
      }).map((link) => link.getAttribute('aria-label') ?? link.textContent.trim()),
    }
  })
  assert(controls.count >= 3, 'Native page, search and menu controls remain available')
  assert(controls.visible, 'Native header controls fit the viewport')
  assert.deepEqual(controls.covered, [], 'Native header controls are reachable')
}

const observedPages = new WeakSet()

/** Hold required enhancement, then inspect complete native first appearance. */
export async function checkNativeFirstPaint(page, url) {
  if (!observedPages.has(page)) {
    observedPages.add(page)
    await page.addInitScript(() => {
      window.__nativePaint = { document: crypto.randomUUID(), frames: [], first: null }
      const sample = () => {
        const heading = document.querySelector('article h1')
        const state = window.__nativePaint
        if (heading && getComputedStyle(document.body).visibility === 'visible') {
          const { x, y, width, height } = heading.getBoundingClientRect()
          state.frames.push({ x, y, width, height })
          if (!state.first) {
            state.first = {
              ready: document.documentElement.dataset.pageReadiness,
              fonts: [heading, document.querySelector('article code')].filter(Boolean).every((element) => {
                const s = getComputedStyle(element)
                const family = s.fontFamily.split(',')[0]
                const name = family.replace(/^['"]|['"]$/g, '')
                return family.includes('IBM Plex') && [...document.fonts].some((face) =>
                  face.family === name && face.status === 'loaded')
                  && document.fonts.check(`${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${family}`)
              }),
            }
          }
        }
        if (state.frames.length < 2) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
  }
  let release
  const delayedScript = new Promise((resolve) => { release = resolve })
  const pendingRoutes = []
  const routeScript = (route) => {
    const pending = delayedScript.then(() => route.continue())
    pendingRoutes.push(pending)
    return pending
  }
  await page.route('**/_astro/*.js', routeScript)
  try {
    const required = page.waitForRequest((request) => request.resourceType() === 'script'
      && /\/_astro\/[^/]+\.js$/.test(new URL(request.url()).pathname))
    void required.catch(() => {})
    let response = await page.goto(url, { waitUntil: 'commit' })
    if (!response) response = await page.reload({ waitUntil: 'commit' })
    assert(response?.ok(), `Native page: HTTP ${response?.status()}`)
    await required
    await page.locator('article h1').waitFor({ state: 'attached' })
    const held = await page.evaluate(() => ({ ...window.__nativePaint,
      readiness: document.documentElement.dataset.pageReadiness }))
    assert.equal(held.readiness, 'pending', 'Required native enhancement remains pending')
    assert.equal(held.first, null, 'Native content stays gated while required enhancement is held')
    release()
    const observation = await page.waitForFunction(() => {
      const result = window.__nativePaint
      return result.first && result.frames.length >= 2 ? structuredClone(result) : false
    })
    const result = await observation.jsonValue()
    assert.equal(result.document, held.document, 'Held and revealed native observations share a document')
    assert.equal(result.first.ready, 'ready')
    assert(result.first.fonts, 'Selected native heading and code faces are loaded IBM Plex at first reveal')
    assert.deepEqual(result.frames[1], result.frames[0], `Native first paint stays still at ${page.viewportSize().width}px`)
    await checkNativeHeader(page)
    assert.equal(await page.locator('.site-header').count(), 1)
  } finally {
    release()
    await Promise.all(pendingRoutes)
    await page.unroute('**/_astro/*.js', routeScript)
  }
}

/**
 * Measure how far each member body's first and last rendered content sits
 * from the body's border box. The walk descends through wrappers that paint
 * nothing on that edge, so space a wrapper cannot absorb still counts.
 */
export function measureMemberBodies(page) {
  return page.evaluate(() => {
    const px = (value) => Number.parseFloat(value) || 0
    const rendered = (element) => element.checkVisibility() && element.getBoundingClientRect().height > 0
    const label = (element) => element.tagName.toLowerCase()
      + [...element.classList].map((name) => `.${name}`).join('')
    // A display: contents element has no box of its own; its children stand in.
    const boxes = (parent) => [...parent.children].flatMap((child) =>
      getComputedStyle(child).display === 'contents' ? boxes(child) : [child])
      .filter((child) => rendered(child) && !['absolute', 'fixed'].includes(getComputedStyle(child).position))
    const painted = (style, side) => px(style[`padding${side}`]) > 0 || px(style[`border${side}Width`]) > 0
      || style.backgroundImage !== 'none' || !/^rgba\(.*, 0\)$|^transparent$/.test(style.backgroundColor)
    const edge = (body, side) => {
      let node = body
      let found = null
      for (;;) {
        const children = boxes(node)
        const child = side === 'Top' ? children[0] : children.at(-1)
        if (!child) return found
        // Inline content sits in line boxes, so its parent is the edge.
        if (getComputedStyle(child).display.startsWith('inline')) return found ?? child
        // Text beside the child element sits on the edge itself.
        const text = [...node.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim())
        if (text.some((n) => side === 'Top' ? child.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_PRECEDING
          : child.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)) return found
        found = child
        if (painted(getComputedStyle(child), side)) return found
        node = child
      }
    }
    return [...document.querySelectorAll('dl.py > dd')].filter(rendered).map((body) => {
      const style = getComputedStyle(body)
      const rect = body.getBoundingClientRect()
      const first = edge(body, 'Top')
      const last = edge(body, 'Bottom')
      return {
        children: [...body.children].map(label),
        padding: { top: px(style.paddingTop), bottom: px(style.paddingBottom) },
        first: first && label(first), last: last && label(last),
        top: first && first.getBoundingClientRect().top - rect.top - px(style.borderTopWidth),
        bottom: last && rect.bottom - px(style.borderBottomWidth) - last.getBoundingClientRect().bottom,
      }
    })
  })
}

/**
 * Pages that give each port a member body of every common shape: only "In other
 * ports", parameters first, a description or example last, Methods, a type,
 * a command and an MCP object. The second field names a direct child the page
 * must still render, so a content change cannot quietly retire the sample.
 */
const MEMBER_BODY_PAGES = [
  ['go/latest/reference/tmux-server-configfile/', 'details.api-elsewhere'],
  ['go/latest/reference/tmux-window-setotherpanewidth/', 'div.gp-sphinx-api-parameters'],
  ['julia/latest/reference/libtmux-snapshot-1gv6/', 'div.gp-sphinx-api-methods'],
  ['julia/latest/reference/libtmux-kill_window/', 'div.gp-sphinx-api-description'],
  ['ruby/latest/reference/libtmux-closederror-entity/', 'div.gp-sphinx-api-description'],
  ['ruby/latest/workspace/reference/libtmux-workspace-configerror/', 'p.gp-sphinx-api-facts'],
  ['py/latest/reference/libtmux-server-new_session/', 'div.gp-sphinx-api-examples'],
  ['py/latest/reference/libtmux-common-has_lt_version/', 'div.gp-sphinx-api-parameters'],
  ['ts/latest/reference/server-server-configfile/', 'details.api-elsewhere'],
  ['ts/latest/reference/types-newsessionoptions/', 'div.gp-sphinx-api-description'],
  ['swift/latest/reference/pane-index/', 'details.api-elsewhere'],
  ['csharp/latest/reference/libtmux-window-height/', 'details.api-elsewhere'],
  ['csharp/latest/reference/libtmux-server-searchclientsasync/', 'div.gp-sphinx-api-parameters'],
  ['java/latest/reference/io-github-libtmux-windowlayout-windowlayout/', 'div.gp-sphinx-api-examples'],
  ['java/latest/mcp/reference/io-github-libtmux-mcp-main-main/', 'div.gp-sphinx-api-examples'],
  ['ts/latest/mcp/tools/capture_pane/', 'div.api-doc'],
  ['powershell/latest/reference/libtmux-get-tmuxserver/', 'div.gp-sphinx-api-command'],
]

/** A body's padding alone sets its inset: top and bottom match each other and the padding. */
export async function checkMemberBodyInsets(browser, base) {
  const tolerance = 1
  const page = await browser.newPage({ reducedMotion: 'reduce' })
  page.setDefaultTimeout(process.env.CI ? 20000 : 10000)
  const failures = []
  let measured = 0
  try {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      for (const [path, shape] of MEMBER_BODY_PAGES) {
        await page.goto(`${base}/${path}`, { waitUntil: 'load' })
        await page.evaluate(() => document.fonts.ready)
        const bodies = await measureMemberBodies(page)
        assert(bodies.some((body) => body.children.includes(shape)), `${path}: still renders ${shape}`)
        for (const body of bodies) {
          measured += 1
          const { top, bottom, padding } = body
          const near = (a, b) => Math.abs(a - b) <= tolerance
          if (!(near(top, padding.top) && near(bottom, padding.bottom) && near(top, bottom))) {
            failures.push(`${path} at ${width}px (${body.first} to ${body.last}): `
              + `top inset ${top}px, bottom inset ${bottom}px, padding ${padding.top}px/${padding.bottom}px`)
          }
        }
      }
    }
  } finally {
    await page.close()
  }
  assert.deepEqual(failures, [], 'Member body padding alone sets the top and bottom inset')
  return measured
}
