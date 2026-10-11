import assert from 'node:assert/strict'

async function checkTaskFirstPaint(browser, base) {
  const versions = {
    schema: 1,
    ports: {
      ts: [
        { slug: 'latest', label: 'latest', kind: 'trunk', supported: true },
        { slug: 'next', label: 'next', kind: 'alias', supported: true },
        { slug: 'v0.1.0-alpha.12', label: 'v0.1.0-alpha.12', kind: 'prerelease', supported: true },
      ],
    },
  }
  for (const width of [853, 390, 280]) {
    const context = await browser.newContext({ viewport: { width, height: 789 }, reducedMotion: 'reduce' })
    let releaseWidget
    const widgetReady = new Promise((resolve) => {
      releaseWidget = resolve
    })
    try {
      await context.route('**/astro/runtime/client/dev-toolbar/entrypoint.js', (route) =>
        route.fulfill({ contentType: 'application/javascript', body: 'export {}' }),
      )
      await context.route('**/*AgentPrompt*', async (route) => {
        if (route.request().resourceType() === 'script') await widgetReady
        await route.continue()
      })
      await context.route('**/versions.json', (route) => route.fulfill({ json: versions }))
      const page = await context.newPage()
      page.setDefaultTimeout(10000)
      const response = await page.goto(`${base}/?port=ts&errors=1&cleanup=1`, { waitUntil: 'commit' })
      assert(response?.ok(), `Task first paint: HTTP ${response?.status()}`)
      const widget = page.locator('.lm-agent-prompt')
      const native = widget.locator('[data-task-native] select')
      await native.waitFor({ state: 'visible' })
      await page.evaluate(() => document.fonts.ready)
      assert.equal(
        (await native.boundingBox()).height,
        36,
        `${width}: the initial task selector reserves its enhanced height`,
      )
      const geometry = () =>
        widget.locator('.lm-agent-prompt__controls').evaluate((bar) => {
          const origin = bar.getBoundingClientRect()
          const elements = ['.lm-agent-prompt__task', '[data-action="reroll"]', '[data-summary]'].map((selector) => [
            selector,
            bar.querySelector(selector),
          ])
          elements.push([
            'task control',
            bar.querySelector(
              '[data-task-native]:not([hidden]) select, [data-task-enhanced]:not([hidden]) [data-task-menu] > summary',
            ),
          ])
          return Object.fromEntries(
            elements.map(([name, element]) => {
              if (!element.getClientRects().length) return [name, null]
              const box = element.getBoundingClientRect()
              return [name, { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height }]
            }),
          )
        })
      const before = await geometry()
      releaseWidget()
      await page.waitForLoadState('load')
      await page.waitForFunction(() => document.querySelector('.lm-agent-prompt')?.dataset.activePort === 'ts')
      await page.waitForLoadState('networkidle')
      assert.equal(
        await widget.locator('[data-version-control]').count(),
        0,
        'Published versions do not insert another homepage control',
      )
      assert.deepEqual(await geometry(), before, `${width}: initializing the task picker leaves the row in place`)
      const visiblePrompt = widget.locator('[data-port="ts"] [data-prompt-text]')
      assert.match(await visiblePrompt.innerText(), /\/ts\/latest\//, 'The homepage prompt uses the port default')
      if (width === 853) {
        await page.goto(`${base}/prompts/?port=ts`)
        const version = page.locator('.lm-agent-prompt [data-select="version"]')
        await version.waitFor({ state: 'visible' })
        await version.selectOption('v0.1.0-alpha.12')
        assert.match(
          await page.locator('.lm-agent-prompt [data-port="ts"] [data-prompt-text]').innerText(),
          /\/ts\/v0\.1\.0-alpha\.12\//,
          'Dedicated prompts retain version selection',
        )
      }
    } finally {
      releaseWidget()
      await context.close()
    }
  }
}

export async function chooseHomeTask(page, topic) {
  const menu = page.locator('[data-task-menu]')
  if (!(await menu.evaluate((element) => element.open))) await menu.locator('summary .doc-picker-caret').click()
  await menu.locator(`[data-task-option="${topic}"]`).click()
  await page.waitForFunction(
    (topic) => document.querySelector('.lm-agent-prompt [data-select="topic"]')?.value === topic,
    topic,
  )
  await menu.locator('summary').waitFor({ state: 'visible' })
  await page.evaluate(() => new Promise(requestAnimationFrame))
}

export async function checkHomeTaskReset(browser, base) {
  await checkTaskFirstPaint(browser, base)
  for (const blocked of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 914, height: 777 }, reducedMotion: 'reduce' })
    try {
      if (blocked) {
        await context.route('**/astro/runtime/client/dev-toolbar/entrypoint.js', (route) =>
          route.fulfill({ contentType: 'application/javascript', body: 'export {}' }),
        )
        await context.addInitScript(() =>
          Object.defineProperty(window, 'localStorage', {
            get() {
              throw new DOMException('Storage blocked', 'SecurityError')
            },
          }),
        )
      }
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`${base}/?port=ruby&from=a&from=b#prompt`)
      const widget = page.locator('.lm-agent-prompt')
      const select = widget.locator('[data-select="topic"]')
      const menu = widget.locator('[data-task-menu]')
      const control = menu.locator('summary')
      const reset = widget.locator('[data-action="reset-topic"]')
      await page.waitForFunction(() => document.querySelector('.lm-agent-prompt')?.dataset.activePort === 'ruby')
      await page.evaluate(() => {
        window.__taskNavigations = 0
        document.addEventListener('astro:before-preparation', () => {
          window.__taskNavigations++
        })
      })
      assert.equal(await reset.isVisible(), false, 'The default task is not an explicit selection')
      await chooseHomeTask(page, 'session-switcher')
      assert.equal(
        await page.evaluate(() => window.__taskNavigations),
        0,
        'Choosing a task updates the widget without starting page navigation',
      )
      assert(await reset.isVisible())
      assert.equal(new URL(page.url()).searchParams.get('prompt'), 'session-switcher')
      await page.reload()
      await page.waitForFunction(
        () => document.querySelector('.lm-agent-prompt [data-select="topic"]')?.value === 'session-switcher',
      )
      assert(await reset.isVisible(), 'A shared task offers Reset after reload')
      await reset.click()
      assert.equal(await select.inputValue(), 'setup')
      assert.equal(new URL(page.url()).searchParams.has('prompt'), false)
      assert.equal(new URL(page.url()).searchParams.get('port'), 'ruby')
      assert.deepEqual(new URL(page.url()).searchParams.getAll('from'), ['a', 'b'])
      assert.equal(new URL(page.url()).hash, '#prompt')
      assert.equal(await reset.isVisible(), false)
      assert(
        await control.evaluate((element) => element === document.activeElement),
        'Clear moves focus to the task selector',
      )
      if (!blocked)
        assert.equal(await page.evaluate(() => localStorage.getItem('libtmux-docs.agent-prompt.topic')), null)
      assert.match(await widget.locator('[data-port="ruby"] [data-prompt-text]').innerText(), /^Set up libtmux/)
      await page.reload()
      await page.waitForFunction(() => document.querySelector('.lm-agent-prompt')?.dataset.activePort === 'ruby')
      assert.equal(await select.inputValue(), 'setup')
      assert.equal(await reset.isVisible(), false, 'A cleared task stays cleared after reload')

      // Choosing the default explicitly and rerolling also expose Reset.
      await widget.locator('[data-action="reroll"]').click()
      assert(await reset.isVisible())
      await chooseHomeTask(page, 'setup')
      assert(await reset.isVisible())
      assert.equal(new URL(page.url()).searchParams.get('prompt'), 'setup')
      if (!blocked) {
        await page.goto(`${base}/?port=ruby`)
        await page.waitForFunction(
          () => !document.querySelector('.lm-agent-prompt [data-action="reset-topic"]')?.hidden,
        )
        assert.equal(await select.inputValue(), 'setup', 'A saved explicit default can be reset')
      }
      for (const width of [914, 850, 778, 659, 628, 596, 390, 320, 280]) {
        await page.setViewportSize({ width, height: 777 })
        await chooseHomeTask(page, 'session-supervisor')
        const geometry = await widget.locator('.lm-agent-prompt__controls').evaluate((bar) => {
          const bounds = (selector) => {
            const { x, y, width, height } = bar.querySelector(selector).getBoundingClientRect()
            return { x, y, width, height, center: y + height / 2 }
          }
          return {
            client: bar.clientWidth,
            scroll: bar.scrollWidth,
            bar: bar.getBoundingClientRect().toJSON(),
            select: bounds('[data-task-menu] > summary'),
            label: bounds('[data-task-current]'),
            reroll: bounds('[data-action="reroll"]'),
            reset: bounds('[data-action="reset-topic"]'),
            caret: bounds('[data-task-menu] > summary .doc-picker-caret'),
          }
        })
        assert(
          geometry.scroll <= geometry.client + 1,
          `${width}: task bar does not overflow ${JSON.stringify(geometry)}`,
        )
        assert(Math.abs(geometry.select.center - geometry.reset.center) < 1, `${width}: Reset stays on the task row`)
        assert(Math.abs(geometry.select.center - geometry.reroll.center) < 1, `${width}: reroll stays on the task row`)
        assert.equal(geometry.reroll.height, geometry.select.height, `${width}: reroll matches the selector height`)
        assert.equal(geometry.reroll.width, geometry.reroll.height, 'The reroll button is square')
        assert(geometry.select.width >= 100, `${width}: the selector remains usable ${JSON.stringify(geometry)}`)
        assert(
          geometry.reset.x > geometry.select.x && geometry.reset.x + geometry.reset.width <= geometry.caret.x,
          'Clear is inside the control before the chevron',
        )
        assert(
          geometry.label.x + geometry.label.width < geometry.reset.x,
          'The task label cannot extend underneath Clear',
        )
        assert(
          geometry.select.x + geometry.select.width - geometry.caret.x - geometry.caret.width < 11,
          'The chevron stays at the right edge',
        )
        assert(geometry.reset.width >= 24 && geometry.reset.height >= 24, 'Clear has a usable hit target')
        assert.equal(await reset.getAttribute('aria-label'), 'Clear task selection')
        assert(await control.getAttribute('title'), 'The full task description remains available when abbreviated')
        await reset.click()
      }
      // Task length and the presence of Clear must not move the reroll target.
      const tasks = await select.locator('option').evaluateAll((options) => options.map((option) => option.value))
      for (const width of [850, 628, 596, 280]) {
        await page.setViewportSize({ width, height: 777 })
        const read = () =>
          widget.locator('.lm-agent-prompt__controls').evaluate((bar) => {
            const select = bar.querySelector('[data-task-menu] > summary').getBoundingClientRect()
            const reroll = bar.querySelector('[data-action="reroll"]').getBoundingClientRect()
            return { width: select.width, x: reroll.x, height: bar.getBoundingClientRect().height }
          })
        const original = await read()
        for (const task of tasks) {
          await chooseHomeTask(page, task)
          assert.deepEqual(
            await read(),
            original,
            `${width}/${task}: selecting a task leaves control geometry unchanged`,
          )
        }
        await widget.locator('[data-action="reroll"]').click()
        assert.deepEqual(await read(), original, `${width}: reroll does not move its target`)
        await reset.click()
        assert.deepEqual(await read(), original, `${width}: clearing does not resize the selector`)
        if (width >= 628) {
          await chooseHomeTask(page, 'agent-orchestrator')
          const description = await widget.locator('[data-summary]').evaluate((element) => ({
            height: element.clientHeight,
            lineHeight: parseFloat(getComputedStyle(element).lineHeight),
            clamp: getComputedStyle(element).webkitLineClamp,
          }))
          assert.equal(description.clamp, '2')
          assert(
            Math.abs(description.height - 2 * description.lineHeight) < 1,
            'The description reserves two lines before truncation',
          )
          assert.equal((await read()).width, 224, 'The task selector has a fixed 14rem width when it fits')
        }
      }
      await control.focus()
      await page.keyboard.press('Enter')
      const search = menu.locator('[data-picker-search]')
      await search.fill('session freezer')
      assert.equal(await menu.locator('[data-task-option]:visible').count(), 1)
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      assert.equal(await select.inputValue(), 'session-freezer', 'Search and keyboard select the task')
      assert(await control.evaluate((element) => element === document.activeElement))
      await page.keyboard.press('Tab')
      assert(
        await reset.evaluate((element) => element === document.activeElement),
        'Clear follows the task selector in the tab order',
      )
      assert(
        await reset.evaluate((element) => parseFloat(getComputedStyle(element).outlineWidth) > 0),
        'Clear has a visible keyboard focus indicator',
      )
      await page.keyboard.press('Enter')
      assert.equal(new URL(page.url()).searchParams.has('prompt'), false, 'Keyboard clear removes the query parameter')
      await control.click()
      await page.keyboard.press('Escape')
      assert.equal(await menu.getAttribute('open'), null)
      assert(await control.evaluate((element) => element === document.activeElement), 'Escape restores focus')
      assert.deepEqual(errors, [])
    } finally {
      await context.close()
    }
  }
  console.log(
    'Task picker: fixed width across every task, stable reroll, two-line descriptions, clear placement, URL/storage, search, keyboard and single-row controls at 280–914px PASS',
  )
}
