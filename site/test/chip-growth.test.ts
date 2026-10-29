import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { judgeChipGrowth, railProblems } from '../scripts/check-badge-centring.mjs'

/**
 * A Related APIs chip grows with a name that wraps. The stylesheet rules that make it so are read from `kind-marks.css`,
 * and the browser gate's judgement is exercised on boxes written down by hand, so each can be seen to fail without a browser.
 */
const marks = readFileSync(new URL('../src/styles/kind-marks.css', import.meta.url), 'utf8')

const CHIPS = ':is(.api-elsewhere-value, .api-command-related, .tmux-usage, nav.api-related)'
/** The mark of a chip: a mention's badge, which leads a name in running text, is not its cap. */
const MARK = '.api-nav__kind:where(:not(.api-link-kind))'
/** The declarations of the rule whose selector is `selector`, comments removed. */
function declarations(css: string, selector: string): Record<string, string> | undefined {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const [, head, body] of plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (head!.trim().replace(/\s+/g, ' ') !== selector) continue
    return Object.fromEntries(body!.split(';').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
      const colon = entry.indexOf(':')
      return [entry.slice(0, colon).trim(), entry.slice(colon + 1).trim()]
    }))
  }
  return undefined
}

/** What a reader sees go wrong in a chip whose name wraps; empty means the stylesheet rules each out. */
function styleProblems(css: string): string[] {
  const chip = declarations(css, `${CHIPS} a:has(> ${MARK})`)
  const mark = declarations(css, `${CHIPS} a > ${MARK}`)
  const name = declarations(css, `${CHIPS} a > ${MARK} + code`)
  if (!chip || !mark || !name) return ['the chip, its mark or its name has no rule']
  const problems: string[] = []
  if ('height' in chip) problems.push('the chip has a fixed height, so a name that wraps spills out of it')
  if (chip['min-height'] !== 'var(--sp-h)') problems.push('a one-line chip does not keep its snapped height')
  if (mark['align-self'] !== 'flex-start') problems.push('the mark is not held to the first line')
  if (!(mark.height ?? '').startsWith('calc(var(--sp-h)')) problems.push('the mark does not keep the height of one line')
  if (name['align-self'] !== 'flex-end') problems.push("the name's last line does not keep its gap from the bottom edge")
  if (!(name.margin?.split(' 0 ')[0] ?? '').startsWith('calc(var(--sp-h)')) problems.push('the first line of a name is not reserved the space of a one-line chip')
  if (!(Number(name['line-height']) >= 1.2)) problems.push('the lines of a wrapped name touch')
  return problems
}

describe('the chip stylesheet', () => {
  it('grows the chip with its name, keeps the mark on the first line and keeps the height of a one-line chip', () => {
    expect(styleProblems(marks)).toEqual([])
  })

  it.each([
    ['a chip held to one line', 'min-height: var(--sp-h);', 'height: var(--sp-h);', 'the chip has a fixed height'],
    ['a mark that stretches down the chip', 'align-self: flex-start;', 'align-self: stretch;', 'the mark is not held to the first line'],
    ['lines that touch', 'line-height: 1.3;', 'line-height: 1;', 'the lines of a wrapped name touch'],
  ])('catches %s', (_label, from, to, problem) => {
    expect(marks).toContain(from)
    expect(styleProblems(marks.replace(from, to))).toEqual(expect.arrayContaining([expect.stringContaining(problem)]))
  })
})

interface Box { top: number; bottom: number; left: number; right: number }
const box = (top: number, height: number, left = 0, width = 150): Box => ({ top, bottom: top + height, left, right: left + width })
interface Chip { text: string; box: Box; mark: Box; lines: { top: number; bottom: number; right: number }[]; border: number; line: number; rail: Box; clipped: boolean }

/** A chip with a one-line name at `top`: a 1px border, the mark as its 18px cap and the name centred on it. */
const oneLine = (top: number, over: Partial<Chip> = {}): Chip => ({
  text: `name${top}`, box: box(top, 20), mark: box(top + 1, 18, 1, 24), lines: [{ top: top + 3, bottom: top + 17, right: 120 }], border: 1, line: 20, rail: box(-100, 1000, 0, 200), clipped: false, ...over,
})
/** A chip whose name wrapped onto three lines: it grew, and the mark stayed one line tall on the first. */
const wrapped = (top: number, over: Partial<Chip> = {}): Chip => ({
  ...oneLine(top), text: `wrapped${top}`, box: box(top, 47.2),
  lines: [{ top: top + 2.9, bottom: top + 16.9, right: 120 }, { top: top + 16.5, bottom: top + 30.5, right: 120 }, { top: top + 30.2, bottom: top + 44.2, right: 120 }], ...over,
})

describe('the chip-growth check of the browser gate', () => {
  it('passes a one-line chip and a chip that grew around a wrapped name', () => {
    expect(judgeChipGrowth([oneLine(0), wrapped(26), oneLine(79.2)])).toEqual([])
  })

  it('names a chip held to one line, whose name starts above it', () => {
    const pinned = wrapped(0, { box: box(0, 20), lines: [{ top: -18, bottom: -4, right: 120 }, { top: -7.5, bottom: 6.5, right: 120 }, { top: 3, bottom: 17, right: 120 }] })
    expect(judgeChipGrowth([pinned])).toEqual([
      'wrapped0: the name starts 19.0px above the chip\'s top edge',
      'wrapped0: the chip is still one line tall, 20.0px, for a name of 3 lines',
      'wrapped0: the first line of the name is 21.0px above the centre of the mark',
    ])
  })

  it('names a name that runs past the bottom edge or the right edge, and a chip that clips it', () => {
    expect(judgeChipGrowth([wrapped(0, { box: box(0, 40) })])).toEqual(['wrapped0: the name runs 5.2px past the chip\'s bottom edge'])
    expect(judgeChipGrowth([oneLine(0, { lines: [{ top: 3, bottom: 17, right: 160 }] })])).toEqual(["name0: the name runs past the chip's right edge"])
    expect(judgeChipGrowth([oneLine(0, { clipped: true })])).toEqual(['name0: the chip clips its name'])
  })

  it('names a mark that stretches down the chip, or leaves its corner, and a first line off the mark', () => {
    expect(judgeChipGrowth([wrapped(0, { mark: box(1, 45.2, 1, 24) })])).toEqual([
      'wrapped0: the mark is 45.2px tall, not the 18.0px of one line', 'wrapped0: the first line of the name is 13.7px above the centre of the mark',
    ])
    expect(judgeChipGrowth([oneLine(0, { mark: box(7, 18, 1, 24) })])).toEqual(['name0: the mark left the top of the chip', 'name0: the first line of the name is 6.0px above the centre of the mark'])
    const lost = wrapped(0, { lines: [{ top: 1, bottom: 15, right: 120 }, { top: 14.6, bottom: 28.6, right: 120 }, { top: 28.3, bottom: 42.3, right: 120 }] })
    expect(judgeChipGrowth([lost])).toEqual(['wrapped0: the first line of the name is 2.0px above the centre of the mark'])
  })

  it('names a chip on top of the one above it, and a chip that leaves its column', () => {
    expect(judgeChipGrowth([oneLine(0), oneLine(15)])).toEqual(['name15: overlaps name0 by 5.0px'])
    expect(judgeChipGrowth([oneLine(0, { rail: box(-10, 100, 0, 100) })])).toEqual(['name0: the chip runs out of the Related APIs column'])
  })
})

const windows: Window[] = []
afterEach(async () => { vi.unstubAllGlobals(); for (const win of windows.splice(0)) await win.happyDOM.abort() })

interface Spec { chip: Box; mark: Box; name: Box; line?: number; clipped?: boolean }
/** The rail check reads the same boxes from the page, so here each one is placed by hand on a chip in a `nav.api-related`. */
async function rail(specs: Spec[]) {
  const win = new Window()
  windows.push(win)
  const { document } = win
  document.body.innerHTML = '<nav class="api-related"></nav>'
  const place = (element: object, at: Box) => Object.defineProperty(element, 'getBoundingClientRect', {
    value: () => ({ top: at.top, left: at.left, bottom: at.bottom, right: at.right, width: at.right - at.left, height: at.bottom - at.top }),
  })
  for (const [index, spec] of specs.entries()) {
    const link = document.createElement('a')
    link.innerHTML = `<span class="api-nav__kind">m</span><code>name${index}</code>`
    link.setAttribute('style', `min-height: ${spec.line ?? 20}px; border-top-width: 1px; border-left-width: 1px`)
    document.querySelector('nav')!.append(link)
    place(link, spec.chip)
    place(link.querySelector('.api-nav__kind')!, spec.mark)
    place(link.querySelector('code')!, spec.name)
    Object.defineProperty(link, 'offsetParent', { value: document.querySelector('nav') })
    if (spec.clipped) Object.defineProperty(link, 'scrollWidth', { value: spec.chip.right - spec.chip.left + 40 })
  }
  vi.stubGlobal('document', document)
  vi.stubGlobal('getComputedStyle', win.getComputedStyle.bind(win))
  return (await railProblems({ evaluate: async (read: () => unknown) => read() })).problems
}
const one = (top: number): Spec => ({ chip: box(top, 20), mark: box(top + 1, 18, 1, 24), name: box(top + 6, 8, 30, 100) })
const grown = (top: number): Spec => ({ chip: box(top, 47.2), mark: box(top + 1, 18, 1, 24), name: box(top + 3, 41, 30, 100), line: 20 })

describe('the related-chips check of the browser gate', () => {
  it('passes a one-line chip and a chip that grew, whose mark stays one line tall', async () => {
    expect(await rail([one(0), one(26), one(52)])).toEqual([])
    expect(await rail([one(0), grown(26), one(79.2)])).toEqual([])
  })

  it('names the padding a chip grows around, since the mark is no longer in its corner', async () => {
    const padded = (top: number): Spec => ({ chip: box(top, 32.8, 0, 160), mark: box(top + 7.4, 18, 6.6, 24), name: box(top + 13, 8, 35, 100) })
    expect(await rail([padded(0), padded(38.8)])).toEqual([
      "mname0: the mark is not flush with the chip's top edge", "mname0: the mark is not flush with the chip's left edge",
      "mname1: the mark is not flush with the chip's top edge", "mname1: the mark is not flush with the chip's left edge",
    ])
  })

  it('names a name running out of its chip, a mark shorter than a line and a clipped chip', async () => {
    const squeezed: Spec = { chip: box(0, 20, 0, 48), mark: box(1, 18, 1, 24), name: box(6, 8, 30, 100), clipped: true }
    expect(await rail([squeezed, one(26)])).toEqual(["mname0: the chip's box does not contain its name", 'mname0: the chip clips its content'])
    expect(await rail([{ ...one(0), mark: box(1, 6, 1, 24) }, one(26)])).toEqual(["mname0: the mark does not fill the chip's height"])
  })
})
