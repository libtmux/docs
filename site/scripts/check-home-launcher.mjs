import assert from 'node:assert/strict'
import { PORTS } from '../src/lib/ports.ts'
import HOME_PROOF from '../test/fixtures/home-examples.json' with { type: 'json' }
import { createHash } from 'node:crypto'
import { checkHomeHover } from './check-home-hover.mjs'
import { checkHomeTaskReset, chooseHomeTask } from './check-home-task-reset.mjs'
import { checkColorScheme } from './check-color-scheme.mjs'
import { checkHomeExampleOptions } from './check-home-example-options.mjs'

/** Only the homepage trigger changes artwork; reset retains the code glyph. */
export async function checkHomeLanguageIcon(page, port = null) {
  const trigger = page.locator('[data-home-launcher] [data-page-port-switcher] > summary')
  const icons = trigger.locator('img:visible')
  assert.equal(await icons.count(), port ? 1 : 0, 'Only the selected language icon is visible')
  assert.equal(
    await trigger.locator('[data-home-default-icon]').isVisible(),
    !port,
    'An unset language keeps the code glyph',
  )
  const geometry = await trigger.evaluate((element) => {
    const icon = element.querySelector('.home-language-icon').getBoundingClientRect()
    const label = [...element.querySelectorAll('.page-port-name, .page-port-short-name')]
      .find((node) => node.checkVisibility())
      .getBoundingClientRect()
    const button = element.getBoundingClientRect()
    const clear = element.closest('.clearable-picker').querySelector('.picker-clear')
    const caretElement = element.querySelector('.doc-picker-caret')
    const caret = caretElement.getBoundingClientRect()
    const clearBox = clear.getBoundingClientRect()
    const sizer = element.querySelector('.page-port-label-sizer')
    return {
      height: button.height,
      iconHeight: icon.height,
      iconRight: icon.right,
      labelLeft: label.left,
      clearFits:
        clear.hidden ||
        (label.right < clearBox.left &&
          clearBox.right <= button.right &&
          Math.abs(clearBox.x + clearBox.width / 2 - caret.x - caret.width / 2) < 1),
      caretVisible: getComputedStyle(caretElement).visibility !== 'hidden',
      sizerHidden: getComputedStyle(sizer).visibility === 'hidden' && sizer.getBoundingClientRect().height === 0,
      centerOffset: Math.abs(icon.y + icon.height / 2 - (button.y + button.height / 2)),
    }
  })
  assert.equal(geometry.height, 36, `The trigger keeps the same height for every language: ${JSON.stringify(geometry)}`)
  assert.equal(geometry.iconHeight, 24, 'Every language uses the same icon box')
  assert(geometry.clearFits, 'Clear occupies the chevron slot without covering the language label')
  assert.equal(geometry.caretVisible, !port, 'The clear button replaces the chevron only for an explicit language')
  assert(geometry.sizerHidden, 'Width measurement never exposes extra language labels')
  assert.equal(
    (await trigger.innerText()).trim(),
    port ? PORTS.find((entry) => entry.slug === port).name : page.viewportSize().width <= 736 ? 'Port' : 'Language',
    'The trigger shows only its current label',
  )
  const solution = await page
    .locator('[data-home-launcher] .home-launcher-solution:not([hidden]) .surface-picker > summary')
    .boundingBox()
  const solutionIcon = await page
    .locator('[data-home-launcher] .home-launcher-solution:not([hidden]) .surface-picker > summary > .surface-artwork')
    .boundingBox()
  assert.equal(solution.height, geometry.height, 'The two launcher buttons have equal heights')
  assert.equal(solutionIcon.height, geometry.iconHeight, 'Language and solution icons use the same size')
  assert(
    geometry.centerOffset < 1 && geometry.iconRight < geometry.labelLeft,
    'The icon sits beside and centered with its label',
  )
  if (port) {
    assert.equal(await icons.getAttribute('data-home-language-icon'), port)
    assert((await icons.getAttribute('src')).endsWith(`/brand/languages/${port}/icon.svg`))
    assert(
      await icons.evaluate((img) => img.complete && img.naturalWidth > 0),
      'The selected language SVG is already loaded',
    )
    const image = await icons.boundingBox()
    const box = await trigger.locator('.home-language-icon').boundingBox()
    assert(Math.abs(image.width - 24) < 0.1, 'The image fits the icon box width')
    assert(Math.abs(image.height - 24) < 0.1, 'Non-square artwork fits the icon box height')
    assert(
      Math.abs(image.x - box.x) < 1 && Math.abs(image.y - box.y) <= 2,
      'The image fits beside the label, allowing a small optical correction',
    )
  }
  const menuSources = await page
    .locator('[data-home-launcher] .port-artwork')
    .evaluateAll((images) => images.map((img) => img.getAttribute('src')))
  assert(
    menuSources.length === PORTS.length && menuSources.every((src) => !src.includes('/brand/languages/')),
    'Menu options keep their libtmux artwork',
  )
}

/** Keep compact labels and example options inside their available row. */
export async function checkHomeResponsiveLayout(page, width, port = null) {
  await page.setViewportSize({ width, height: 789 })
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
  })
  const launcher = page.locator('[data-home-launcher]')
  const compact = width <= 736
  assert.equal(await launcher.locator('.page-port-name').isVisible(), !compact)
  assert.equal(await launcher.locator('.page-port-short-name').isVisible(), compact)
  if (!port && compact) assert.equal(await launcher.locator('.page-port-short-name').innerText(), 'Port')
  if (port && compact)
    assert.equal(
      await launcher.locator('.page-port-short-name').innerText(),
      PORTS.find((entry) => entry.slug === port).name,
      'Compact layouts retain the full language name',
    )
  const solution = launcher.locator('.home-launcher-solution:not([hidden])')
  assert.equal(await solution.locator('.home-solution-name-full').isVisible(), !compact)
  assert.equal(await solution.locator('.home-solution-name-short').isVisible(), compact)
  assert.equal(await solution.locator('.surface-current').innerText(), compact ? 'Solution' : 'Choose a solution')
  await checkHomeLanguageIcon(page, port)
  const layout = await page.evaluate(() => {
    const bounds = (node) => node.getBoundingClientRect()
    const launcher = document.querySelector('[data-home-launcher]')
    const language = bounds(launcher.querySelector('[data-page-port-switcher] > summary'))
    const solution = bounds(launcher.querySelector('.home-launcher-solution:not([hidden]) summary'))
    const heading = document.querySelector('.home-examples > [data-home-language]:not([hidden]) .home-example-heading')
    const title = bounds(heading.querySelector('h2'))
    const options = bounds(heading.querySelector('fieldset'))
    return {
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      pickerRow: Math.abs(language.y - solution.y) < 1,
      pickerRight: solution.right,
      headerHeight: bounds(document.querySelector('.site-header__bar')).height,
      available: heading.clientWidth,
      required: title.width + options.width + parseFloat(getComputedStyle(heading).columnGap),
      headingInline: Math.abs(title.y + title.height / 2 - options.y - options.height / 2) < 1,
    }
  })
  assert(!layout.overflow && layout.pickerRight <= width, `${width}: the header fits without page overflow`)
  assert(layout.pickerRow, `${width}: Port and Solution stay on the same row`)
  if (width >= 561) assert(layout.headerHeight <= 53, `${width}: the entire header fits on one row`)
  if (layout.required <= layout.available) {
    assert(layout.headingInline, `${width}: example title and options share a row when they fit`)
  }
}

/** Exercise the real homepage, including the prompt controlled by its picker. */
export async function checkHomeLauncher(browser, base) {
  const context = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const language = page.locator('[data-home-launcher] [data-page-port-switcher]')
  const solution = page.locator('.home-launcher-solution:not([hidden])')
  const prompt = page.locator('.lm-agent-prompt')
  const reset = page.locator('[data-home-launcher] .picker-clear[data-home-reset]')
  const logo = page.locator('.site-header__mark img')
  const choose = async (port) => {
    const previousWidth = (await language.locator('summary').boundingBox()).width
    await language.locator('summary').click()
    await language.locator(`a[data-port="${port}"]`).click()
    await page.waitForFunction((port) => document.querySelector('.lm-agent-prompt')?.dataset.activePort === port, port)
    assert(await page.locator(`.home-examples [data-home-language="${port}"]`).isVisible())
    assert.equal(await solution.getAttribute('data-home-language'), port)
    assert.equal(new URL(page.url()).searchParams.get('port'), port, 'The address carries the chosen language')
    assert(await reset.isVisible(), 'A chosen language can be reset')
    assert.equal(await logo.count(), 0, 'The top header keeps only the wordmark')
    await checkHomeLanguageIcon(page, port)
    assert.equal(
      (await language.locator('summary').boundingBox()).width,
      previousWidth,
      'Changing language leaves the adjacent solution selector in place',
    )
    const cards = await page
      .locator(`.home-intro [data-home-language="${port}"] .home-solutions > a`)
      .evaluateAll((links) =>
        links.map((link) => ({
          display: getComputedStyle(link).display,
          border: getComputedStyle(link).borderTopWidth,
          label: getComputedStyle(link.querySelector('strong')).display,
          description: getComputedStyle(link.querySelector('small')).display,
        })),
      )
    assert(
      cards.length > 0 &&
        cards.every(
          (card) =>
            card.display === 'flex' && card.border === '1px' && card.label === 'block' && card.description === 'block',
        ),
      `${port}: solution cards retain their layout and borders`,
    )
  }
  try {
    await page.goto(`${base}/`)
    await page.locator('[data-home-launcher] [data-page-port-switcher][data-enhanced]').waitFor()
    assert.equal(await prompt.locator('[role="tablist"]').count(), 0, 'Homepage has one language picker')
    assert.equal(await page.getByRole('heading', { name: /^(Language libraries|Read the docs)$/ }).count(), 0)
    assert.equal(await reset.isVisible(), false, 'The default example is not a saved choice')
    await checkHomeLanguageIcon(page)
    for (const width of [944, 840, 778, 763, 736, 659, 628, 596, 561, 560, 518, 390, 320, 280]) {
      await checkHomeResponsiveLayout(page, width)
    }
    await page.setViewportSize({ width: 1280, height: 777 })
    assert.equal(await logo.count(), 0, 'The top header has no duplicate artwork')
    for (const { slug } of PORTS) {
      await choose(slug)
      const links = await solution.locator('a').evaluateAll((links) => links.map((link) => link.getAttribute('href')))
      assert(
        links.length > 0 && links.every((href) => href.startsWith(`${new URL(base).pathname}/${slug}/`)),
        `${slug}: owned solution destinations`,
      )
      if (['kotlin', 'scala', 'fsharp'].includes(slug)) assert.equal(links.length, 1, `${slug}: core library only`)
      assert.match(
        await prompt.locator(`[data-port="${slug}"] [data-prompt-text]`).innerText(),
        new RegExp(`/en/${slug}/`),
      )
      await checkHomeResponsiveLayout(page, 840, slug)
      await checkHomeResponsiveLayout(page, 280, slug)
      await page.setViewportSize({ width: 1280, height: 777 })
    }
    await choose('ruby')
    const rubyLink = solution.locator('a[href$="/ruby/latest/mcp/"]')
    await solution.locator('summary').click()
    await rubyLink.click()
    await page.waitForURL('**/ruby/latest/mcp/')
    await page.goto(`${base}/`)
    await page.waitForFunction(() => document.querySelector('.lm-agent-prompt')?.dataset.activePort === 'ruby')
    assert.equal(await solution.getAttribute('data-home-language'), 'ruby', 'Saved language restores both controls')
    await checkHomeLanguageIcon(page, 'ruby')
    await page.goto(`${base}/?port=fsharp&prompt=session-switcher&from=shared#example`)
    await page.waitForFunction(() => document.querySelector('.lm-agent-prompt')?.dataset.activePort === 'fsharp')
    assert.equal(await language.locator('.page-port-name').textContent(), 'F#', 'The URL overrides the saved language')
    await checkHomeLanguageIcon(page, 'fsharp')
    assert.equal(await prompt.locator('[data-select="topic"]').inputValue(), 'session-switcher')
    await choose('go')
    assert.equal(
      new URL(page.url()).searchParams.get('prompt'),
      'session-switcher',
      'Language changes preserve the task',
    )
    assert.equal(
      new URL(page.url()).searchParams.get('from'),
      'shared',
      'Language changes preserve unrelated parameters',
    )
    assert.equal(new URL(page.url()).hash, '#example')
    await prompt.locator('[data-action="reroll"]').click()
    const rerolled = await prompt.locator('[data-select="topic"]').inputValue()
    assert.notEqual(rerolled, 'session-switcher')
    assert.equal(new URL(page.url()).searchParams.get('port'), 'go', 'Task changes preserve the language')
    await page.reload()
    await page.waitForFunction(() => document.querySelector('.lm-agent-prompt')?.dataset.activePort === 'go')
    assert.equal(
      await prompt.locator('[data-select="topic"]').inputValue(),
      rerolled,
      'Reload restores the language and task',
    )
    await language.locator('summary').click()
    const resetGap = await language.locator('.doc-picker-title-actions').evaluate((actions) => {
      const button = actions.querySelector('button').getBoundingClientRect()
      const count = actions.querySelector('.doc-picker-count').getBoundingClientRect()
      return count.left - button.right
    })
    assert(resetGap >= 11.5, 'Reset is separated from the language count')
    await language.locator('[data-home-reset]').click()
    assert.equal(new URL(page.url()).searchParams.has('port'), false, 'The picker reset removes the port parameter')
    assert.equal(new URL(page.url()).searchParams.get('prompt'), rerolled, 'Reset preserves the task')
    assert.equal(new URL(page.url()).searchParams.get('from'), 'shared')
    assert.equal(new URL(page.url()).hash, '#example')
    assert.equal(await page.evaluate(() => localStorage.getItem('libtmux-docs.package-install.port')), null)
    assert.equal(await reset.isVisible(), false)
    assert.equal(await logo.count(), 0, 'Reset keeps the wordmark without duplicate artwork')
    await checkHomeLanguageIcon(page)
    assert.equal(await language.locator('[aria-current]').count(), 0, 'Reset leaves no selected language')
    assert(
      await language.locator('summary').evaluate((element) => document.activeElement === element),
      'Reset keeps focus on the language picker',
    )
    await page.reload()
    await page.waitForFunction(
      () => document.querySelector('[data-home-launcher] .page-port-name')?.textContent === 'Language',
    )
    assert.equal(await reset.isVisible(), false, 'The cleared choice stays cleared on reload')
    await checkHomeLanguageIcon(page)
    assert.equal(await prompt.getAttribute('data-active-port'), PORTS[0].slug)
    await choose('fsharp')
    await reset.click()
    assert.equal(
      new URL(page.url()).searchParams.has('port'),
      false,
      'The header reset also removes the port parameter',
    )
    await page.goto(`${base}/?port=constructor&prompt=setup`)
    await page.waitForFunction(
      () => document.querySelector('[data-home-launcher] .page-port-name')?.textContent === 'Language',
    )
    assert.equal(new URL(page.url()).searchParams.has('port'), false, 'Unknown languages do not become a selection')
    await page.goto(`${base}/?port=fsharp&prompt=setup#first`)
    await page.waitForFunction(() => document.querySelector('.lm-agent-prompt')?.dataset.activePort === 'fsharp')
    await page.evaluate(() => {
      location.hash = 'second'
    })
    await choose('go')
    await chooseHomeTask(page, 'session-switcher')
    await page.goBack()
    await page.waitForFunction(
      () =>
        document.querySelector('.lm-agent-prompt')?.dataset.activePort === 'fsharp' &&
        document.querySelector('.lm-agent-prompt [data-select="topic"]')?.value === 'setup',
    )
    assert.equal(new URL(page.url()).hash, '#first', 'Back restores the matching language and task')
    await checkHomeLanguageIcon(page, 'fsharp')
    // The popstate handlers restore choices before Astro swaps this page.
    await page.evaluate(() => {
      window.__homeNavigationComplete = false
      document.addEventListener(
        'astro:page-load',
        () => {
          window.__homeNavigationComplete = true
        },
        { once: true },
      )
    })
    await page.goForward()
    await page.waitForFunction(() => window.__homeNavigationComplete)
    await page.waitForFunction(
      () =>
        document.querySelector('.lm-agent-prompt')?.dataset.activePort === 'go' &&
        document.querySelector('.lm-agent-prompt [data-select="topic"]')?.value === 'session-switcher',
    )
    assert.equal(new URL(page.url()).hash, '#second', 'Forward restores the matching language and task')
    await checkHomeLanguageIcon(page, 'go')
    await choose('py')
    const topic = prompt.locator('[data-select="topic"]')
    await chooseHomeTask(page, 'setup')
    const original = await prompt.locator('[data-port="py"] [data-prompt-text]').innerText()
    const tasks = await topic.locator('option').evaluateAll((options) => options.map((option) => option.value))
    await chooseHomeTask(
      page,
      tasks.find((value) => value !== 'setup'),
    )
    const text = await prompt.locator('[data-port="py"] [data-prompt-text]').innerText()
    assert.notEqual(text, original, 'Task selection still recomposes the prompt')
    await page.evaluate(() =>
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.__homeCopiedPrompt = text
          },
        },
      }),
    )
    await prompt.locator('[data-port="py"] [data-action="copy"]').click()
    assert.equal(await page.evaluate(() => window.__homeCopiedPrompt), text, 'Copy preserves all prompt bytes')
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.themeMode = theme
      }, theme)
      const colors = await page.evaluate(() => {
        const code = document.querySelector('.home-examples [data-home-language="py"] .expressive-code pre')
        const prompt = document.querySelector('.lm-agent-prompt__code')
        return [getComputedStyle(code).backgroundColor, getComputedStyle(prompt).backgroundColor]
      })
      assert.equal(colors[0], colors[1], `${theme}: code and prompt use the same background`)
      for (const width of [1920, 1440, 1135, 906, 390, 320]) {
        await page.setViewportSize({ width, height: 777 })
        assert(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          `${theme}/${width}: no page overflow`,
        )
        assert(
          (await language.isVisible()) && (await solution.isVisible()),
          `${theme}/${width}: both header pickers visible`,
        )
      }
    }
    await choose('rs')
    await page.setViewportSize({ width: 1093, height: 777 })
    for (const proof of HOME_PROOF.examples) {
      await choose(proof.port)
      const panel = page.locator(`.home-examples > [data-home-language="${proof.port}"]`)
      const rendered = await panel.evaluate((element) => ({
        files: [...element.querySelectorAll('.home-example-run [data-home-file]')].map((file) => ({
          name: file.dataset.homeFile,
          code: file.querySelector('[data-code]').getAttribute('data-code').replaceAll('\x7f', '\n'),
        })),
        commands: [...element.querySelectorAll('[data-home-command] [data-code]')].map((button) =>
          button.getAttribute('data-code').replaceAll('\x7f', '\n'),
        ),
      }))
      const hash = (text) => createHash('sha256').update(text).digest('hex')
      assert.deepEqual(rendered.commands, proof.shellRecipe, `${proof.port}: exact setup and run copy payloads`)
      for (const view of ['concise', 'errors', 'cleanup', 'full']) {
        await panel.locator('[data-example-errors]').setChecked(view === 'errors' || view === 'full')
        await panel.locator('[data-example-cleanup]').setChecked(view === 'cleanup' || view === 'full')
        const selected = panel.locator(`[data-home-view="${view}"]`)
        assert.equal(
          await panel.locator('[data-home-view]:visible').count(),
          1,
          `${proof.port}/${view}: exactly one complete program is shown`,
        )
        assert(await selected.isVisible(), `${proof.port}/${view}: the selected program is shown`)
        const binding = view === 'full' ? proof : proof.variants[view]
        const main = await selected.locator('[data-code]').getAttribute('data-code')
        const codeText = main.replaceAll('\x7f', '\n')
        assert.equal(hash(codeText), binding.excerptSha256, `${proof.port}/${view}: exact visible program`)
        await page.evaluate(() => {
          window.__homeCopiedPrompt = null
        })
        await selected.locator('[data-code]').click()
        assert.equal(
          await page.evaluate(() => window.__homeCopiedPrompt),
          codeText,
          `${proof.port}/${view}: Copy matches the visible program`,
        )
        const files = [{ name: await selected.getAttribute('data-home-file'), code: codeText }, ...rendered.files]
        const byName = (a, b) => a.name.localeCompare(b.name)
        assert.deepEqual(
          files.map((file) => ({ name: file.name, sha256: hash(file.code) })).sort(byName),
          binding.files.map((file) => ({ name: file.name, sha256: file.clipboardSha256 })).sort(byName),
          `${proof.port}/${view}: complete native-verified file copy payloads`,
        )
        const pre = selected.locator('pre')
        const width = await pre.evaluate(async (element) => {
          // Container-query sizes settle after a previously hidden panel is painted.
          await new Promise(requestAnimationFrame)
          await new Promise(requestAnimationFrame)
          await document.fonts.ready
          await new Promise(requestAnimationFrame)
          return {
            available: element.clientWidth,
            content: element.scrollWidth,
            font: getComputedStyle(element.querySelector('code')).fontSize,
            gutter: getComputedStyle(element).scrollbarGutter,
            container: getComputedStyle(element).containerType,
            columns: element.closest('[data-home-view]').style.getPropertyValue('--home-code-columns'),
            lines: [...element.querySelectorAll('.code')]
              .map((line) => {
                const range = document.createRange()
                range.selectNodeContents(line)
                return {
                  text: line.textContent,
                  width: range.getBoundingClientRect().width,
                  font: getComputedStyle(line).font,
                  padding: getComputedStyle(line).padding,
                }
              })
              .sort((a, b) => b.width - a.width)
              .slice(0, 2),
          }
        })
        assert(
          width.content <= width.available + 1,
          `${proof.port}/${view}: no horizontal scrollbar at 1093px ${JSON.stringify(width)}`,
        )
      }
    }
    await choose('rs')
    const code = page.locator('.home-examples > [data-home-language="rs"] [data-home-view="full"] pre code')
    const fontSizes = []
    for (const width of [906, 1135, 1920]) {
      await page.setViewportSize({ width, height: 777 })
      const layout = await page.evaluate(() => {
        const intro = document.querySelector('.home-intro').getBoundingClientRect()
        const examples = document.querySelector('.home-examples').getBoundingClientRect()
        const font = getComputedStyle(
          document.querySelector('.home-examples [data-home-language="rs"] [data-home-view="full"] pre code'),
        ).fontSize
        return { intro: intro.width, examples: examples.width, font: parseFloat(font) }
      })
      assert(layout.intro <= 320.5, `${width}: intro stops at 20rem`)
      assert(layout.examples > layout.intro, `${width}: code receives remaining width`)
      assert(layout.font >= 13 && layout.font <= 15, `${width}: readable font bounds`)
      fontSizes.push(layout.font)
    }
    assert(fontSizes[0] < fontSizes[2], 'Code grows with its container')
    await page.locator('.home-examples').evaluate((element) => {
      element.style.width = '360px'
    })
    assert.equal(
      await code.evaluate((element) => getComputedStyle(element).fontSize),
      '13px',
      'Sizing follows the container at the same viewport',
    )
    await code
      .locator('.ec-line')
      .first()
      .evaluate((line) => {
        line.textContent = 'unusuallyLongSymbol'.repeat(12)
      })
    assert(
      await code.locator('..').evaluate((pre) => pre.scrollWidth > pre.clientWidth),
      'An indivisible symbol remains scrollable',
    )
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'Long symbols do not widen the page',
    )
    await page.reload()
    await language.locator('[data-port="rs"]').waitFor({ state: 'attached' })
    await page.setViewportSize({ width: 906, height: 777 })
    await language.locator('summary').focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Escape')
    assert.equal(await language.getAttribute('open'), null, 'Escape closes the picker')
    assert(
      await language.locator('summary').evaluate((element) => document.activeElement === element),
      'Escape restores focus',
    )
    assert.deepEqual(errors, [], 'Homepage has no runtime errors')
  } finally {
    await context.close()
  }
  const blockedStorage = await browser.newContext()
  try {
    // Astro's development toolbar reads storage unguarded; it is absent from published pages.
    await blockedStorage.route('**/astro/runtime/client/dev-toolbar/entrypoint.js', (route) =>
      route.fulfill({ contentType: 'application/javascript', body: 'export {}' }),
    )
    await blockedStorage.addInitScript(() =>
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('Storage blocked', 'SecurityError')
        },
      }),
    )
    const page = await blockedStorage.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${base}/?port=fsharp&prompt=session-switcher`)
    await page.waitForFunction(() => document.querySelector('.lm-agent-prompt')?.dataset.activePort === 'fsharp')
    const launcher = page.locator('[data-home-launcher]')
    assert.equal(await launcher.locator('.page-port-name').textContent(), 'F#', 'Shared language works without storage')
    await checkHomeLanguageIcon(page, 'fsharp')
    assert.equal(await page.locator('.lm-agent-prompt [data-select="topic"]').inputValue(), 'session-switcher')
    await launcher.locator('.picker-clear[data-home-reset]').click()
    await checkHomeLanguageIcon(page)
    assert.equal(new URL(page.url()).searchParams.has('port'), false)
    await page.reload()
    await page.waitForFunction(
      () => document.querySelector('[data-home-launcher] .page-port-name')?.textContent === 'Language',
    )
    assert.deepEqual(errors, [], 'Shared links and reset work without storage')
  } finally {
    await blockedStorage.close()
  }
  const noScript = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 777 } })
  try {
    const page = await noScript.newPage()
    await page.goto(`${base}/`)
    const picker = page.locator('[data-home-launcher] [data-page-port-switcher]')
    const example = page.locator('[data-home-example="py"]')
    for (const view of ['concise', 'errors', 'cleanup', 'full']) {
      await example.locator('[data-example-errors]').setChecked(view === 'errors' || view === 'full')
      await example.locator('[data-example-cleanup]').setChecked(view === 'cleanup' || view === 'full')
      assert.equal(await example.locator('[data-home-view]:visible').count(), 1, 'No-JS shows one selected program')
      assert(await example.locator(`[data-home-view="${view}"]`).isVisible(), `No-JS supports ${view}`)
    }
    await picker.locator('summary').click()
    await checkHomeLanguageIcon(page)
    assert.equal(
      await picker.locator('a[data-port]:visible').count(),
      PORTS.length,
      'No-JS still exposes real language links',
    )
    assert(await picker.locator('.tmux-area a').isVisible(), 'No-JS retains the separate tmux destination')
    assert(
      await page.locator('.lm-agent-prompt__panel[data-default] [data-prompt-text]').isVisible(),
      'Default prompt remains readable without JavaScript',
    )
    await picker.locator('a[data-port="ruby"]').click()
    await page.waitForURL('**/ruby/latest/')
  } finally {
    await noScript.close()
  }
  await checkHomeHover(browser, base)
  await checkHomeTaskReset(browser, base)
  await checkColorScheme(browser, base)
  await checkHomeExampleOptions(browser, base)
  console.log(
    'Homepage: 13 languages, 52 complete selectable programs/copy, owned solutions, shared URLs, reset, blocked storage, prompt tasks/copy, shared themes, container sizing, keyboard and no-JS PASS',
  )
}
