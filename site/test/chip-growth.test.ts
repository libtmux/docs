import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { judgeChipGrowth } from '../scripts/check-badge-centring.mjs'

/**
 * A linked API name in a run (In other ports, the tmux C API and command lists) is a kind mark and a
 * dotted-underlined name, and nothing else: no chip around the pair, no surface under the name, no border, at rest or on
 * hover (record 0025 and record 0049 of the design system). The stylesheet rules that say so are read from `kind-marks.css`,
 * and the browser gate's judgement is exercised on boxes written down by hand, so each can be seen to fail without a browser.
 */
const marks = readFileSync(new URL('../src/styles/kind-marks.css', import.meta.url), 'utf8')

const LINKED = ':is(.api-elsewhere-value, .api-command-related, .tmux-usage, nav.api-related)'
/** The mark of a linked name: a mention's badge, which leads a name in running text, is not it. */
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

/**
 * `css` without comments, with `from` replaced by `to` inside the rule whose selector is `selector` and nowhere else. A
 * declaration such as `border: 0` also sits in other rules of the sheet, so a replacement across the sheet could change one
 * that the check never reads.
 */
function mutate(css: string, selector: string, from: string, to: string): string {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1]!.trim().replace(/\s+/g, ' ') !== selector) continue
    expect(match[2], `the rule ${selector} holds ${from}`).toContain(from)
    const start = match.index + match[0].indexOf('{') + 1
    return plain.slice(0, start) + match[2]!.replace(from, to) + plain.slice(start + match[2]!.length)
  }
  throw new Error(`no rule ${selector}`)
}

/** What a reader sees go wrong in a linked name; empty means the stylesheet rules each out. */
function styleProblems(css: string): string[] {
  const link = declarations(css, `${LINKED} a:has(> ${MARK})`)
  const mark = declarations(css, `${LINKED} a > ${MARK}`)
  const name = declarations(css, `${LINKED} a > ${MARK} + code`)
  if (!link || !mark || !name) return ['the link, its mark or its name has no rule']
  const problems: string[] = []
  if (link.border !== '0') problems.push('the link draws a border')
  if (link.background !== 'none') problems.push('the link draws a surface')
  if (link.padding !== '0') problems.push('the link pads a box around its pair')
  if ('height' in link || 'min-height' in link) problems.push('the link has a fixed height, so a name that wraps spills out of it')
  if ('overflow' in link) problems.push('the link clips what wraps out of it')
  if (mark['align-self'] !== 'baseline') problems.push('the mark is not held to the name\'s first line')
  if (name.background !== 'none' || name.border !== '0' || name.padding !== '0') problems.push('the name sits on a chip of its own')
  if (name['text-decoration'] !== 'underline dotted') problems.push('the name has no dotted underline')
  if (!(Number(name['line-height']) >= 1.2)) problems.push('the lines of a wrapped name touch')
  // Hover and focus change the underline and the mark; nothing about the link draws a surface or a border.
  const hover = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, head]) => /:hover|:focus-visible/.test(head!) && head!.includes('a:has(> .api-nav__kind') && /api-elsewhere-value|tmux-usage/.test(head!) && !/\.api-nav__kind\s*$/.test(head!.trim()))
  if (hover.some(([, , body]) => /background|border|box-shadow|outline/.test(body!))) problems.push('hover or focus draws a chip around the link')
  return problems
}

describe('the linked-name stylesheet', () => {
  it('draws no chip: the mark and the dotted underline are the link\'s only cues, at rest and on hover', () => {
    expect(styleProblems(marks)).toEqual([])
  })

  it.each([
    ['a border back on the link', `${LINKED} a:has(> ${MARK})`, 'border: 0', 'border: 1px solid red', 'the link draws a border'],
    ['a surface back under the link', `${LINKED} a:has(> ${MARK})`, 'background: none', 'background: #eee', 'the link draws a surface'],
    ['a link held to one line', `${LINKED} a:has(> ${MARK})`, 'padding: 0', 'padding: 0; min-height: 1.6em', 'the link has a fixed height'],
    ['a mark that sinks to the bottom of a wrapped name', `${LINKED} a > ${MARK}`, 'align-self: baseline', 'align-self: flex-end', 'the mark is not held to'],
    ['a name on a chip of its own', `${LINKED} a > ${MARK} + code`, 'padding: 0', 'padding: 0 .45em', 'the name sits on a chip of its own'],
    ['a name with no underline', `${LINKED} a > ${MARK} + code`, 'text-decoration: underline dotted', 'text-decoration: none', 'the name has no dotted underline'],
    ['lines that touch', `${LINKED} a > ${MARK} + code`, 'line-height: 1.4', 'line-height: 1', 'the lines of a wrapped name touch'],
  ])('catches %s', (_label, selector, from, to, problem) => {
    expect(styleProblems(mutate(marks, selector, from, to))).toEqual(expect.arrayContaining([expect.stringContaining(problem)]))
  })

  it('catches a hover rule that draws a chip', () => {
    const hovered = `${marks}\n${LINKED} a:has(> ${MARK}):is(:hover, :focus-visible) { background: #eee; border-color: red; }\n`
    expect(styleProblems(hovered)).toContain('hover or focus draws a chip around the link')
  })
})

interface Box { top: number; bottom: number; left: number; right: number }
const box = (top: number, height: number, left = 0, width = 150): Box => ({ top, bottom: top + height, left, right: left + width })
interface Chip { text: string; box: Box; mark: Box; lines: { top: number; bottom: number; right: number }[]; rail: Box; clipped: boolean }

/** A link with a one-line name at `top`: the 18px mark and the name centred on it. */
const oneLine = (top: number, over: Partial<Chip> = {}): Chip => ({
  text: `name${top}`, box: box(top, 18), mark: box(top, 18, 0, 18), lines: [{ top: top + 2, bottom: top + 16, right: 120 }], rail: box(-100, 1000, 0, 200), clipped: false, ...over,
})
/** A link whose name wrapped onto three lines: it grew, and the mark stayed beside the first. */
const wrapped = (top: number, over: Partial<Chip> = {}): Chip => ({
  ...oneLine(top), text: `wrapped${top}`, box: box(top, 46),
  lines: [{ top: top + 2, bottom: top + 16, right: 120 }, { top: top + 16, bottom: top + 30, right: 120 }, { top: top + 30, bottom: top + 44, right: 120 }], ...over,
})

describe('the linked-name growth check of the browser gate', () => {
  it('passes a one-line link and a link that grew around a wrapped name', () => {
    expect(judgeChipGrowth([oneLine(0), wrapped(26), oneLine(78)])).toEqual([])
  })

  it('names a link held to one line, whose name runs out of it', () => {
    const pinned = wrapped(0, { box: box(0, 18), lines: [{ top: -18, bottom: -4, right: 120 }, { top: -4, bottom: 10, right: 120 }, { top: 10, bottom: 24, right: 120 }] })
    expect(judgeChipGrowth([pinned])).toEqual([
      'wrapped0: the name starts 18.0px above the link\'s top edge',
      'wrapped0: the name runs 6.0px past the link\'s bottom edge',
      'wrapped0: the first line of the name is 20.0px above the centre of the mark',
    ])
  })

  it('names a name that runs past the bottom edge or the right edge, and a link that clips it', () => {
    expect(judgeChipGrowth([wrapped(0, { box: box(0, 40) })])).toEqual(['wrapped0: the name runs 4.0px past the link\'s bottom edge'])
    expect(judgeChipGrowth([oneLine(0, { lines: [{ top: 2, bottom: 16, right: 160 }] })])).toEqual(["name0: the name runs past the link's right edge"])
    expect(judgeChipGrowth([oneLine(0, { clipped: true })])).toEqual(['name0: the link clips its name'])
  })

  it('names a first line that is off the mark', () => {
    expect(judgeChipGrowth([oneLine(0, { mark: box(7, 18, 0, 18) })])).toEqual(['name0: the first line of the name is 7.0px above the centre of the mark'])
    const lost = wrapped(0, { lines: [{ top: 12, bottom: 26, right: 120 }, { top: 26, bottom: 40, right: 120 }, { top: 40, bottom: 54, right: 120 }] })
    expect(judgeChipGrowth([lost])).toEqual(["wrapped0: the name runs 8.0px past the link's bottom edge", 'wrapped0: the first line of the name is 10.0px below the centre of the mark'])
  })

  it('names a link on top of the one above it, and a link that leaves its column', () => {
    expect(judgeChipGrowth([oneLine(0), oneLine(14)])).toEqual(['name14: overlaps name0 by 4.0px'])
    expect(judgeChipGrowth([oneLine(0, { rail: box(-10, 100, 0, 100) })])).toEqual(['name0: the link runs out of the list'])
  })
})

