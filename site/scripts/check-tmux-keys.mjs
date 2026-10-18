import assert from 'node:assert/strict'

/** Contrast of a rendered element's text against what is painted behind it. */
function contrastOf(selector) {
  const element = document.querySelector(selector)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const paint = (color) => {
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = color
    context.fillRect(0, 0, 1, 1)
  }
  const luminance = () => {
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data.map((value) => {
      const channel = value / 255
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const backgrounds = []
  for (let parent = element; parent; parent = parent.parentElement) backgrounds.unshift(getComputedStyle(parent).backgroundColor)
  context.fillStyle = '#fff'
  context.fillRect(0, 0, 1, 1)
  for (const color of backgrounds) {
    context.fillStyle = color
    context.fillRect(0, 0, 1, 1)
  }
  const background = luminance()
  paint(getComputedStyle(element).color)
  const values = [luminance(), background].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

/** What a page marks as keys: each outermost kbd with the caps inside it. */
function keysOf(selector) {
  return [...document.querySelectorAll(`${selector} kbd`)]
    .filter((key) => !key.parentElement.closest('kbd'))
    .map((key) => ({
      text: key.textContent.replace(/\s+/g, ' ').trim(),
      caps: [...key.children].filter((child) => child.tagName === 'KBD').map((cap) => cap.textContent),
    }))
}

/** The pages the check reads; the runner compiles them before timing begins. */
export const TMUX_KEY_PAGES = [
  '/tmux/latest/manual/bind-key/', '/tmux/latest/manual/full/', '/tmux/guides/attaching-to-tmux/', '/tmux/guides/sending-keys/',
]

/**
 * tmux key notation renders as key caps: one nested kbd for a sequence, a kbd
 * for a single key, and commands beside them stay links.
 */
export async function checkTmuxKeys(browser, base) {
  for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ colorScheme, reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.setDefaultTimeout(process.env.CI ? 20000 : 10000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const open = async (path) => {
      const response = await page.goto(`${base}${path}`)
      assert(response?.ok(), `${path}: HTTP ${response?.status()}`)
      await page.waitForFunction(() => document.fonts.status === 'loaded')
    }
    try {
      await open(TMUX_KEY_PAGES[0])
      const manual = await page.evaluate(() => ({
        keys: [...document.querySelectorAll('.tmux-manual kbd')]
          .filter((key) => !key.parentElement.closest('kbd'))
          .map((key) => ({ text: key.textContent, caps: [...key.children].map((cap) => `${cap.tagName}:${cap.textContent}`) })),
        literals: [...document.querySelectorAll('.tmux-manual code.Li')].map((code) => code.textContent),
        links: [...document.querySelectorAll('.tmux-manual a[href$="/new-window/"] > code.Ic')].map((code) => code.textContent),
      }))
      assert.deepEqual(manual.keys.map((key) => key.text), ['c', 'C-b c', 'c', 'c'], `${colorScheme}: bind-key keys`)
      assert.deepEqual(manual.keys[1].caps, ['KBD:C-b', 'KBD:c'], `${colorScheme}: C-b c is a kbd around one kbd per key`)
      assert.deepEqual(manual.literals, [], `${colorScheme}: no key stays a code literal`)
      assert.deepEqual(manual.links, ['new-window', 'new-window'], `${colorScheme}: new-window stays a command link`)
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 })
        const label = `${colorScheme} ${width}`
        const cap = await page.evaluate(() => {
          const key = document.querySelector('.tmux-manual kbd > kbd')
          const style = getComputedStyle(key)
          const rect = key.getBoundingClientRect()
          return {
            bottom: style.borderBottomWidth, top: style.borderTopWidth, outer: getComputedStyle(key.parentElement).borderTopWidth,
            size: parseFloat(style.fontSize), face: style.fontFamily, fits: rect.right <= innerWidth && rect.left >= 0,
            overflow: document.documentElement.scrollWidth - innerWidth,
          }
        })
        assert.equal(cap.bottom, '2px', `${label}: a cap has a raised bottom edge`)
        assert.equal(cap.top, '1px', `${label}: a cap has an outline`)
        assert.equal(cap.outer, '0px', `${label}: the sequence draws no outline of its own`)
        assert(cap.size >= 12 && cap.fits && cap.overflow <= 1, `${label}: caps stay legible and inside the viewport`)
        assert(cap.face.includes('IBM Plex Mono'), `${label}: caps use the code face`)
        const contrast = await page.evaluate(contrastOf, '.tmux-manual kbd > kbd')
        assert(contrast >= 4.5, `${label}: cap contrast ${contrast}`)
      }
      if (colorScheme === 'dark') continue

      await open(TMUX_KEY_PAGES[1])
      const bindings = await page.evaluate(() => ({
        keys: [...document.querySelectorAll('#default-key-binding-c kbd, #default-key-binding-d kbd')].map((key) => key.textContent),
        term: document.querySelector('#default-key-binding-c')?.tagName,
        names: [...document.querySelectorAll('#KEY_BINDINGS ~ p kbd')].map((key) => key.textContent).slice(0, 6),
      }))
      assert.deepEqual(bindings.keys, ['c', 'd'], 'default bindings list keys')
      assert.equal(bindings.term, 'DT', 'entry anchors stay on their terms')
      assert.deepEqual(bindings.names, ['A', 'Z', 'C-', '^', 'S-', 'M-'], 'KEY BINDINGS names the modifiers')

      await open(TMUX_KEY_PAGES[2])
      assert.deepEqual(await page.evaluate(keysOf, 'article'), [{ text: 'C-b d', caps: ['C-b', 'd'] }], 'guide detach keys')

      await open(TMUX_KEY_PAGES[3])
      const guide = await page.evaluate(() => ({
        keys: [...document.querySelectorAll('article kbd')].map((key) => key.textContent),
        typed: [...document.querySelectorAll('article code')].filter((code) => code.textContent === 'Enter').length,
        overflow: document.documentElement.scrollWidth - innerWidth,
      }))
      assert.deepEqual(guide.keys, ['Enter', 'C-c', 'Up'], 'key names in the sending keys guide')
      // The word typed into a pane is literal text, not a key.
      assert(guide.typed >= 3, 'typed text stays code')
      assert(guide.overflow <= 1, 'the guide fits a phone')
    } finally {
      await context.close()
    }
    assert.deepEqual(errors, [], `tmux keys ${colorScheme}: no page errors`)
  }
  console.log('tmux key caps: manual bindings, tables and guides PASS')
}
