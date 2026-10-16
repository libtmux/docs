import assert, { AssertionError } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { Window, type Element, type HTMLElement } from 'happy-dom'
import { describe, expect, it } from 'vitest'
import * as nativeLayoutChecks from '../scripts/check-native-layout.mjs'

interface Region {
  left: number; right: number; top: number; bottom: number; width: number; height: number
  padding: string; gap: string
}
interface Measurement {
  viewport: number; pageWidth: number
  header: Region; row: Region | null; left: Region | null; right: Region | null
  signatures: Region[]
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
      element.setAttribute('style', `padding:${region.padding};gap:${region.gap};border:0 solid;`)
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

function sample(viewport: number): Measurement {
  return structuredClone(measured.find((record) => record.viewport === viewport)!)
}

function resize(region: Region, width: number) {
  region.width = width
  region.right = region.left + width
}

function shift(region: Region, dx: number, dy: number) {
  region.left += dx; region.right += dx; region.top += dy; region.bottom += dy
}

describe('hosted native signature geometry', () => {
  it('accepts the observed first-line metadata beside a 1440px Scala header', async () => {
    await runHostedGeometry(sample(1440))
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
