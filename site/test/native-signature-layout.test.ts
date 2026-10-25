import assert, { AssertionError } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { Window, type Element, type HTMLElement } from 'happy-dom'
import { describe, expect, it } from 'vitest'
import * as nativeLayoutChecks from '../scripts/check-native-layout.mjs'

interface Region {
  left: number; right: number; top: number; bottom: number; width: number; height: number
  padding: string; gap: string; lineHeight?: number
}
interface Measurement {
  viewport: number; pageWidth: number
  header: Region; row: Region | null; left: Region | null; right: Region | null
  signatures: Region[]
}
interface LineMeasurement {
  text: string; innerText: string
  rows: { line: number; text: string; glyphs: number; topSpread: number }[]
}

const measured = JSON.parse(readFileSync(new URL('./fixtures/scala-signature-geometry.json', import.meta.url), 'utf8'))
  .records as Measurement[]

/** Replay measured browser rectangles; happy-dom supplies selectors and computed insets. */
async function runHostedGeometry(measurement: Measurement) {
  const win = new Window()
  try {
    win.document.body.innerHTML = '<dl><dt><div class="gp-sphinx-api-layout"><div class="gp-sphinx-api-layout-left"><span class="api-native-signature"></span></div><div class="gp-sphinx-api-layout-right"></div></div></dt></dl>'
    const header = win.document.querySelector('dt')!
    const regions = [
      [header, measurement.header],
      [header.querySelector('.gp-sphinx-api-layout'), measurement.row],
      [header.querySelector('.gp-sphinx-api-layout-left'), measurement.left],
      [header.querySelector('.gp-sphinx-api-layout-right'), measurement.right],
      [header.querySelector('.api-native-signature'), measurement.signatures[0]],
    ] as const
    for (const [element, region] of regions) {
      if (!element) continue
      if (!region) { element.remove(); continue }
      element.setAttribute('style', `padding:${region.padding};gap:${region.gap};border:0 solid;`
        + (region.lineHeight ? `line-height:${region.lineHeight}px;` : ''))
      const [rowGap, columnGap = rowGap] = region.gap.split(' ')
      const style = (element as HTMLElement).style
      style.rowGap = rowGap
      style.columnGap = columnGap
      Object.defineProperty(element, 'getBoundingClientRect', { value: () => ({ ...region, x: region.left, y: region.top }) })
    }
    header.style.borderBottomWidth = '1px'
    const source = readFileSync(new URL('../scripts/check-dev.mjs', import.meta.url), 'utf8')
    const route = source.indexOf("await page.goto(`${base}/scala/latest/reference/io-github-libtmux-scaladsl-server-windows/`)")
    const loop = '    for (const width of [1440, 768, 390]) {'
    const start = source.indexOf(loop, route)
    const end = source.indexOf("\n    console.log('Scala overloads:", start)
    assert(route >= 0 && start > route && end > start, 'The real hosted Scala geometry observer is present')
    const body = source.slice(start + loop.length, end).trimEnd()
    assert(body.endsWith('}'), 'The hosted geometry loop has a complete body')
    const signature = {
      boundingBox: async () => ({ ...measurement.header, x: measurement.header.left, y: measurement.header.top }),
      locator: (selector: string) => ({ boundingBox: async () => selector.includes('layout-left') ? measurement.left : null }),
      evaluate: async (read: (element: Element) => unknown) => read(header),
    }
    await runInNewContext(`(async () => { ${body.slice(0, -1)} })()`, {
      assert, signature, width: measurement.viewport, ...nativeLayoutChecks,
      page: {
        setViewportSize: async () => {},
        evaluate: async (read: () => unknown) => runInNewContext(`(${read.toString()})()`, {
          document: { documentElement: { scrollWidth: measurement.pageWidth } }, innerWidth: measurement.viewport,
        }),
      },
    })
  } finally { await win.happyDOM.abort() }
}

/** The recorded Scala signature is one line inside 4px of padding. */
function observed(viewport: number): Measurement {
  const measurement = structuredClone(measured.find((record) => record.viewport === viewport)!)
  measurement.signatures[0].lineHeight = measurement.signatures[0].height - 8
  return measurement
}

/** Move metadata beside the code so it centres on the first signature line. */
function level(measurement: Measurement): Measurement {
  const { left, right, signatures: [signature] } = measurement
  if (left && right && signature && right.top < left.bottom) {
    shift(right, 0, signature.top + Number.parseFloat(signature.padding) + signature.lineHeight! / 2 - (right.top + right.height / 2))
  }
  return measurement
}

function sample(viewport: number): Measurement {
  return level(observed(viewport))
}

function resize(region: Region, width: number) {
  region.width = width
  region.right = region.left + width
}

function shift(region: Region, dx: number, dy: number) {
  region.left += dx; region.right += dx; region.top += dy; region.bottom += dy
}

describe('hosted native signature geometry', () => {
  it('accepts metadata centred on the first line beside a 1440px Scala header', async () => {
    await runHostedGeometry(sample(1440))
  })

  it('rejects the observed 1440px metadata that sat on the padded signature\'s top edge', async () => {
    const measurement = observed(1440)
    expect(measurement.right!.top).toBe(measurement.left!.top)
    await expect(runHostedGeometry(measurement)).rejects.toThrow(/centres on the first line/)
  })

  it.each([768, 390])('accepts the observed full-width code above metadata at %ipx', async (width) => {
    await runHostedGeometry(sample(width))
  })

  it('derives available width from the DOM padding rather than a fixed header inset', async () => {
    const measurement = sample(1440)
    measurement.header.padding = '8px 20px'
    shift(measurement.row!, 8, 0)
    resize(measurement.row!, measurement.row!.width - 16)
    shift(measurement.left!, 8, 0)
    resize(measurement.left!, measurement.left!.width - 16)
    shift(measurement.right!, -8, 0)
    shift(measurement.signatures[0], 8, 0)
    await runHostedGeometry(measurement)
  })

  it('uses the computed column gap beside metadata', async () => {
    const measurement = sample(1440)
    measurement.row!.gap = '10px 24px'
    resize(measurement.left!, measurement.left!.width - 8)
    await runHostedGeometry(measurement)
  })

  it('uses the computed row gap below code', async () => {
    const measurement = sample(768)
    measurement.row!.gap = '10px 24px'
    shift(measurement.right!, 0, 4)
    for (const region of [measurement.header, measurement.row!]) {
      region.height += 4
      region.bottom += 4
    }
    await runHostedGeometry(measurement)
  })

  it.each([1440, 768])('rejects even a fractional unused code strip at %ipx', async (width) => {
    const measurement = sample(width)
    resize(measurement.left!, measurement.left!.width - 0.125)
    await expect(runHostedGeometry(measurement)).rejects.toThrow(/available code width/)
  })

  it('rejects code that wastes available width in a stacked header', async () => {
    const measurement = sample(768)
    resize(measurement.left!, measurement.left!.width - 50)
    await expect(runHostedGeometry(measurement)).rejects.toThrow(AssertionError)
  })

  it('rejects code that wastes available width beside metadata', async () => {
    const measurement = sample(1440)
    resize(measurement.left!, measurement.left!.width - 20)
    await expect(runHostedGeometry(measurement)).rejects.toThrow(/available code width/)
  })

  it('rejects metadata overlapping a full-width stacked code region', async () => {
    const measurement = sample(768)
    shift(measurement.right!, 0, -measurement.right!.height)
    await expect(runHostedGeometry(measurement)).rejects.toThrow(/overlap/)
  })

  it('rejects metadata centered against the entire multiline code region', async () => {
    const measurement = sample(1440)
    shift(measurement.right!, 0, (measurement.left!.height - measurement.right!.height) / 2)
    await expect(runHostedGeometry(measurement)).rejects.toThrow(/first line/)
  })

  it('rejects a row outside the padded header content', async () => {
    const measurement = sample(768)
    shift(measurement.row!, -1, 0)
    await expect(runHostedGeometry(measurement)).rejects.toThrow(/contained/)
  })

  it('rejects code outside its layout row', async () => {
    const measurement = sample(768)
    shift(measurement.left!, -1, 0)
    await expect(runHostedGeometry(measurement)).rejects.toThrow(/contained/)
  })

  it('rejects metadata outside its layout row', async () => {
    const measurement = sample(768)
    shift(measurement.right!, 1, 0)
    await expect(runHostedGeometry(measurement)).rejects.toThrow(/contained/)
  })

  it.each(['row', 'left', 'right'] as const)('reports a missing %s region as an assertion', async (region) => {
    const measurement = sample(768)
    measurement[region] = null
    await expect(runHostedGeometry(measurement)).rejects.toThrow(AssertionError)
  })

  it('reports a missing first signature as an assertion', async () => {
    const measurement = sample(768)
    measurement.signatures = []
    await expect(runHostedGeometry(measurement)).rejects.toThrow(/firstSignature region is present/)
  })

  it('keeps document overflow independent of header geometry', async () => {
    const measurement = sample(768)
    measurement.pageWidth = measurement.viewport + 2
    await expect(runHostedGeometry(measurement)).rejects.toThrow('Scala overloads fit at 768px')
  })
})

describe('declaration controls beside a signature', () => {
  /** A 22.4px first line starting at 100px, followed by more lines of code. */
  const declaration = (mode: 'beside' | 'stacked', centres: number[]) => ({
    id: 'sample', mode, line: { top: 100, height: 22.4, centre: 111.2 },
    controls: centres.map((centre, index) => ({ name: ['method', 'async', '[source]', '¶'][index], centre })),
  })

  it('accepts controls on the centre of the first line of a multi-line signature', () => {
    nativeLayoutChecks.assertDeclarationControlsLevel(declaration('beside', [111.2, 111.2, 111.2, 111.2]), 'control')
  })

  it('accepts a centre exactly the tolerance away and rejects one beyond it', () => {
    nativeLayoutChecks.assertDeclarationControlsLevel(declaration('beside', [112.2]), 'edge')
    expect(() => nativeLayoutChecks.assertDeclarationControlsLevel(declaration('beside', [112.21]), 'edge'))
      .toThrow(/control "method" centre is 1\.01px from the first signature line/)
  })

  it('rejects controls sitting above the centre of a padded signature line', () => {
    expect(() => nativeLayoutChecks.assertDeclarationControlsLevel(declaration('beside', [106.7, 107.2]), 'ts'))
      .toThrow(/ts: control "method" centre is -4\.50px from the first signature line/)
  })

  it('rejects controls centred on the middle of the whole code block', () => {
    expect(() => nativeLayoutChecks.assertDeclarationControlsLevel(declaration('beside', [111.2, 245]), 'block'))
      .toThrow(/control "async" centre is 133\.80px/)
  })

  it('compares stacked controls with each other, not with the code above or below', () => {
    nativeLayoutChecks.assertDeclarationControlsLevel(declaration('stacked', [240.4, 240.9]), 'stacked')
    expect(() => nativeLayoutChecks.assertDeclarationControlsLevel(declaration('stacked', [240.4, 243.4]), 'stacked'))
      .toThrow(/stacked controls share their row centre, spread 3\.00px/)
  })

  it('compares controls that wrap onto several rows within each row', () => {
    nativeLayoutChecks.assertDeclarationControlsLevel(declaration('stacked', [240.4, 240.9, 270.8, 271.3]), 'wrapped')
    expect(() => nativeLayoutChecks.assertDeclarationControlsLevel(declaration('stacked', [240.4, 240.9, 270.8, 273.8]), 'wrapped'))
      .toThrow(/spread 3\.00px/)
  })

  it('rejects a declaration with no measurable controls', () => {
    expect(() => nativeLayoutChecks.assertDeclarationControlsLevel(null, 'missing')).toThrow(/visible controls/)
    expect(() => nativeLayoutChecks.assertDeclarationControlsLevel(declaration('beside', []), 'empty')).toThrow(/visible controls/)
    expect(() => nativeLayoutChecks.assertDeclarationControlsLevel(declaration('beside', [Number.NaN]), 'nan')).toThrow(/measurable centres/)
  })
})

const lineMeasurements = JSON.parse(readFileSync(new URL('./fixtures/formatted-signature-lines.json', import.meta.url), 'utf8'))
  .records as { port: string; before: LineMeasurement; prePrototype: LineMeasurement }[]

describe('formatter-owned painted rows', () => {
  it.each(lineMeasurements)('rejects observed $port soft wrapping despite unchanged text', async ({ before, prePrototype }) => {
    expect(before.text).toBe(prePrototype.text)
    expect(before.innerText).toBe(prePrototype.innerText)
    await expect(nativeLayoutChecks.checkNativeSignatureLines({ evaluate: async () => [before] })).rejects.toThrow(/one painted row/)
    await expect(nativeLayoutChecks.checkNativeSignatureLines({ evaluate: async () => [prePrototype] })).resolves.toEqual([prePrototype])
  })

  it('measures split inline text, ignores popovers and leaves blank source lines intact', async () => {
    const win = new Window()
    try {
      win.document.body.innerHTML = '<dt><span class="api-native-signature--formatted">call(\n    <a>Target</a> name,\n\n)</span><span class="api-native-signature">unformatted</span></dt>'
      const header = win.document.querySelector('dt')!
      const signature = header.querySelector('.api-native-signature--formatted')!
      const popover = win.document.createElement('div')
      popover.setAttribute('popover', 'auto')
      popover.textContent = 'Visible help is outside the declaration'
      signature.append(popover)
      let start: Node, offset = 0, wrapped = false
      Object.defineProperty(win.document, 'createRange', { value: () => ({
        setStart: (node: Node, at: number) => { start = node; offset = at },
        setEnd: () => {},
        getBoundingClientRect: () => ({ width: 8, height: 16,
          top: wrapped && start.textContent?.includes(' name,') && offset > 0 ? 42 : 20 }),
      }) })
      const read = { evaluate: async (inspect: (element: Element) => unknown) => inspect(header) }
      const measured = await nativeLayoutChecks.checkNativeSignatureLines(read)
      expect(measured).toHaveLength(1)
      expect(measured[0].text).toBe('call(\n    Target name,\n\n)')
      expect(measured[0].rows.map((row: { glyphs: number }) => row.glyphs)).toEqual([5, 11, 0, 1])
      wrapped = true
      await expect(nativeLayoutChecks.checkNativeSignatureLines(read)).rejects.toThrow(/line 2 stays on one painted row/)
    } finally { await win.happyDOM.abort() }
  })

  it('rejects nonempty lines whose text has no painted glyphs', async () => {
    const record = { text: 'Missing', rows: [{ line: 1, text: 'Missing', glyphs: 0, topSpread: 0 }] }
    await expect(nativeLayoutChecks.checkNativeSignatureLines({ evaluate: async () => [record] })).rejects.toThrow(/painted text/)
  })
})

/** The stylesheets a native Sphinx Python page receives: the published gp-sphinx layout sheet, then the shell's. */
describe('native Sphinx declarations', () => {
  const sheet = readFileSync(new URL('./fixtures/native-gp-sphinx-layout.css', import.meta.url), 'utf8')
  // happy-dom ignores rules inside @layer. Unwrapping each layer lets its rules compete by specificity, which is
  // stricter than a browser, where every unlayered shell rule beats every layered one.
  const unlayer = (css: string): string => {
    const start = css.indexOf('@layer gp-sphinx {')
    if (start < 0) return css
    const inner = start + '@layer gp-sphinx {'.length
    let depth = 1, end = inner
    for (; depth > 0 && end < css.length; end++) depth += css[end] === '{' ? 1 : css[end] === '}' ? -1 : 0
    return unlayer(css.slice(0, start) + css.slice(inner, end - 1) + css.slice(end))
  }
  // The published pages highlight a targeted declaration with this colour; the shell must not flatten it.
  const highlight = 'rgb(255, 255, 204)'
  const published = `${unlayer(sheet)}\ndl.py > dt:target { background: ${highlight}; }`
  const shellCss = (source = readFileSync(new URL('../src/styles/native-sphinx.css', import.meta.url), 'utf8')) => source
  const dt = (type: string, id: string, extra = '') => `<dt class="sig gp-sphinx-api-header" id="${id}"><div class="gp-sphinx-api-layout gp-sphinx-api-layout--desktop"><div class="gp-sphinx-api-layout-left"><div class="gp-sphinx-api-signature">f(\n  a,\n  b)</div><a class="headerlink gp-sphinx-api-link">&para;</a></div><div class="gp-sphinx-api-layout-right"><span class="gp-sphinx-api-badge-container"><span class="gp-sphinx-badge">${type}</span></span><span class="gp-sphinx-api-source-link"><a>[source]</a></span></div></div></dt>`
  const dl = (type: string, id: string, body = '') => `<dl class="py ${type} gp-sphinx-api-container">${dt(type, id)}<dd>${body}</dd></dl>`
  const page = dl('class', 'Outer', dl('method', 'Outer.run') + dl('class', 'Outer.Inner', dl('method', 'Outer.Inner.go'))) + dl('function', 'helper')
  const open = (shell: boolean, css = shellCss(), width = 1024, hash = '') => {
    const win = new Window({ width, url: `https://libtmux.org/api/${hash}` })
    win.document.documentElement.toggleAttribute('data-native-shell', shell)
    win.document.head.innerHTML = `<style>${published}\n${css}</style>`
    win.document.body.innerHTML = `<article><section id="m">${page}</section></article>`
    const style = (id: string, selector?: string) => {
      const row = win.document.getElementById(id)!
      return win.getComputedStyle(selector ? row.querySelector(selector)! : row)
    }
    return { win, style }
  }
  const controls = (shell: boolean, css?: string) => {
    const { win, style } = open(shell, css)
    try {
      const read = (selector: string) => style('Outer.run', selector)
      return {
        row: read('.gp-sphinx-api-layout--desktop').alignItems, code: read('.gp-sphinx-api-layout-left').alignItems,
        controls: read('.gp-sphinx-api-layout-right').alignItems, badge: read('.gp-sphinx-api-badge-container').alignSelf,
      }
    } finally { void win.happyDOM.abort() }
  }
  const sticky = (id: string, shell = true, css?: string, width?: number) => {
    const { win, style } = open(shell, css, width)
    try { const { position, top } = style(id); return { position, top } } finally { void win.happyDOM.abort() }
  }
  const computed = (id: string, hash = '', css?: string, rowHeight?: string) => {
    const { win, style } = open(true, css, 1024, hash)
    try {
      if (rowHeight) win.document.getElementById('Outer')!.closest('dl')!.style.setProperty('--native-class-row-height', rowHeight)
      const { backgroundColor, zIndex, scrollMarginTop } = style(id); return { backgroundColor, zIndex, scrollMarginTop } } finally { void win.happyDOM.abort() }
  }

  it('starts the permalink, source link and badges on the first signature line', () => {
    expect(controls(true)).toEqual({ row: 'flex-start', code: 'flex-start', controls: 'baseline', badge: 'center' })
  })

  it('keeps the published block-centred rows outside the native shell', () => {
    expect(controls(false)).toEqual({ row: 'center', code: 'center', controls: 'center', badge: '' })
  })

  it('fails when the shell no longer overrides the published row', () => {
    const without = shellCss().replace(/(--desktop \{\s*)align-items: flex-start;/, '$1')
    expect(without).not.toBe(shellCss())
    expect(controls(true, without).row).toBe('center')
  })

  it('pins a top-level class declaration under the site header', () => {
    expect(sticky('Outer')).toEqual({ position: 'sticky', top: 'calc(52px + 1px)' })
  })

  it.each(['Outer.run', 'Outer.Inner', 'Outer.Inner.go', 'helper'])('keeps the %s row in flow', (id) => {
    expect(sticky(id).position).not.toBe('sticky')
  })

  it('keeps the class row in flow outside the shell and on narrow screens', () => {
    expect(sticky('Outer', false).position).not.toBe('sticky')
    expect(sticky('Outer', true, undefined, 400).position).not.toBe('sticky')
    expect(sticky('Outer', true, undefined, 700).position).not.toBe('sticky')
  })

  it('fails when the class row rule is removed', () => {
    const without = shellCss().replace(/position: sticky;/, '')
    expect(without).not.toBe(shellCss())
    expect(sticky('Outer', true, without).position).not.toBe('sticky')
  })

  it('hides what scrolls beneath the pinned row and stays under the 40 of the site header', () => {
    const rule = shellCss().match(/dt\.gp-sphinx-api-header:not\(:target\) \{\s*background-color: color-mix\(in srgb, var\(--background-color\), var\(--text-color\) (\d+)%\);/)
    expect(rule, 'the pinned row mixes two opaque page colours').not.toBeNull()
    expect(Number(rule![1])).toBeGreaterThan(0)
    expect(Number(rule![1])).toBeLessThan(100)
    const { zIndex } = computed('Outer')
    expect(Number(zIndex)).toBeGreaterThan(0)
    expect(Number(zIndex)).toBeLessThan(40)
    expect(computed('Outer', '', shellCss().replace(/z-index: 5;/, 'z-index: 50;')).zIndex).toBe('50')
    expect(Number(computed('Outer', '', shellCss().replace(/z-index: 5;/, 'z-index: 50;')).zIndex)).toBeGreaterThanOrEqual(40)
  })

  describe('target highlight on the pinned row', () => {
    // happy-dom cannot resolve color-mix, so the fill is swapped for a plain colour.
    const plain = (css: string) => css.replace(/color-mix\([^;]*\)/g, 'rgb(10, 20, 30)')
    it('is kept while the row is the target and fills otherwise', () => {
      expect(computed('Outer', '#Outer', plain(shellCss())).backgroundColor).toBe(highlight)
      expect(computed('Outer', '', plain(shellCss())).backgroundColor).toBe('rgb(10, 20, 30)')
    })

    it('fails when the fill no longer excludes the target', () => {
      const flattened = shellCss().replace(/dt\.gp-sphinx-api-header:not\(:target\) \{\s*background-color/, 'dt.gp-sphinx-api-header {\n    background-color')
      expect(flattened).not.toBe(shellCss())
      expect(computed('Outer', '#Outer', plain(flattened)).backgroundColor).toBe('rgb(10, 20, 30)')
    })
  })

  it('lands anchored members below the measured row height', () => {
    expect(computed('Outer.run', '', undefined, '98px').scrollMarginTop).toBe('max(0px, calc(98px - 0.75rem))')
    expect(computed('Outer.Inner.go', '', undefined, '98px').scrollMarginTop).toBe('max(0px, calc(98px - 0.75rem))')
    expect(computed('helper', '', undefined, '98px').scrollMarginTop).not.toContain('98px')
    const fixed = shellCss().replace(/max\(0px, calc\(var\(--native-class-row-height, 0px\)[^;]*;/, '1.5rem;')
    expect(fixed).not.toBe(shellCss())
    expect(computed('Outer.run', '', fixed, '98px').scrollMarginTop).not.toContain('98px')
  })

  describe('row measuring script', () => {
    const script = readFileSync(new URL('../src/components/docs/NativeSphinxScript.astro', import.meta.url), 'utf8')
    const run = (source: string, heights: Record<string, number>) => {
      const win = new Window({ url: 'https://libtmux.org/api/' })
      const observed: { callback: () => void; rows: Element[] }[] = []
      Object.assign(win, {
        layoutBeforeAppearance: (work: () => void) => work(),
        ResizeObserver: class { rows: Element[] = []; constructor(callback: () => void) { observed.push({ callback, rows: this.rows }) }
          observe(row: Element) { this.rows.push(row) }; disconnect() {} },
      })
      win.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
        return new win.DOMRect(0, 0, 400, heights[this.id] ?? 0)
      }
      win.document.body.innerHTML = `<article><section>${page}</section></article>`
      win.eval(ts.transpileModule(source.replace(/^  import .*$/gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)
      return { win, observed, height: (id: string) => win.document.getElementById(id)!.closest('dl')!.style.getPropertyValue('--native-class-row-height') }
    }
    const body = script.match(/<script>([\s\S]*?)<\/script>/)![1]

    it('writes each top-level class row height on its class and follows resizes', () => {
      const heights = { Outer: 39.4, 'Outer.Inner': 70, 'Outer.run': 30, helper: 30 }
      const { win, observed, height } = run(body, heights)
      try {
        expect(height('Outer')).toBe('39.4px')
        expect(height('Outer.Inner')).toBe('')
        expect(height('helper')).toBe('')
        expect(observed).toHaveLength(1)
        expect(observed[0].rows.map((row) => row.id)).toEqual(['Outer'])
        heights.Outer = 98
        observed[0].callback()
        expect(height('Outer')).toBe('98px')
      } finally { void win.happyDOM.abort() }
    })

    it('fails when the script no longer measures the rows', () => {
      const broken = body.replace('--native-class-row-height', '--native-unmeasured')
      expect(broken).not.toBe(body)
      const { win, height } = run(broken, { Outer: 39.4 })
      try { expect(height('Outer')).toBe('') } finally { void win.happyDOM.abort() }
    })
  })
})
