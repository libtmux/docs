import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  arrange,
  highlight,
  LAYOUTS,
  LEXER_RULE_IDS,
  lexBash,
  parseSize,
  renderLayout,
  splitPanes,
  TmuxLayoutError,
} from '../src/lib/tmux-layout'

/** Pygments' output for the Python module, which this renderer must reproduce. */
const pygments = JSON.parse(readFileSync(new URL('./fixtures/tmux-layout-pygments.json', import.meta.url), 'utf8')) as {
  highlight: Record<string, string>
  render: { layout: string; panes: string[][]; size: [number, number]; svg: string }[]
}

const SCREEN = { width: 80, height: 24 }

describe('arrange', () => {
  const cases: [string, string, number][] = [
    ['even-vertical-3', 'even-vertical', 3],
    ['even-horizontal-2', 'even-horizontal', 2],
    ['main-vertical-3', 'main-vertical', 3],
    ['main-horizontal-3', 'main-horizontal', 3],
    ['tiled-4', 'tiled', 4],
    ['tiled-3-spans-last-row', 'tiled', 3],
    ['single-pane', 'even-vertical', 1],
  ]

  it.each(cases)('%s tiles the screen exactly', (_, layout, count) => {
    const rects = arrange(layout, count, SCREEN.width, SCREEN.height)
    expect(rects).toHaveLength(count)
    // Non-overlapping panes that fill the screen sum to its area.
    expect(rects.reduce((area, rect) => area + rect.w * rect.h, 0)).toBeCloseTo(SCREEN.width * SCREEN.height)
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(-1e-6)
      expect(rect.y).toBeGreaterThanOrEqual(-1e-6)
      expect(rect.x + rect.w).toBeLessThanOrEqual(SCREEN.width + 1e-6)
      expect(rect.y + rect.h).toBeLessThanOrEqual(SCREEN.height + 1e-6)
    }
  })

  it('splits even layouts into equal panes', () => {
    expect(arrange('even-vertical', 3, 80, 24).map((rect) => Math.round(rect.h))).toEqual([8, 8, 8])
    expect(arrange('even-horizontal', 2, 80, 24).map((rect) => rect.w)).toEqual([40, 40])
  })

  it('gives a main layout half the screen to its first pane', () => {
    const [first, second] = arrange('main-vertical', 3, 80, 24)
    expect([first!.w, second!.x]).toEqual([40, 40])
    const [top, below] = arrange('main-horizontal', 3, 80, 24)
    expect([top!.h, below!.y]).toEqual([12, 12])
  })

  it('lets the last row of a tiled layout span the screen among its own panes', () => {
    const rects = arrange('tiled', 3, 80, 24)
    expect(rects.map((rect) => rect.w)).toEqual([40, 40, 80])
    expect(rects[2]!.y).toBe(12)
  })

  it('rejects an unknown layout and an empty window', () => {
    expect(() => arrange('spiral', 2, 80, 24)).toThrow(TmuxLayoutError)
    expect(() => arrange('spiral', 2, 80, 24)).toThrow(/unknown layout/)
    expect(() => arrange('tiled', 0, 80, 24)).toThrow(/at least one pane/)
  })

  it('names the layouts tmux arranges', () => {
    expect(LAYOUTS).toEqual(['even-vertical', 'even-horizontal', 'main-vertical', 'main-horizontal', 'tiled'])
  })
})

describe('highlight', () => {
  it.each([
    ['single-quoted-string', "echo 'hi there'", 'class="s1"'],
    ['comment', '# a note', 'class="c1"'],
  ])('wraps %s tokens in Pygments-classed tspans', (_, command, expected) => {
    const html = highlight(command)
    expect(html).toContain(expected)
    expect(html).toContain('<tspan')
  })

  it('leaves a command builtin in the default colour', () => {
    expect(highlight('echo hello')).not.toContain('class="nb"')
    expect(highlight('pwd')).not.toContain('class="nb"')
  })

  it('escapes markup instead of emitting it', () => {
    const html = highlight('echo <a>')
    expect(html).not.toContain('<a>')
    expect(html).toContain('&lt;a&gt;')
    expect(highlight("echo 'hi'")).toContain('&#x27;hi&#x27;')
  })

  it('keeps a backslash escape apart from the word it precedes', () => {
    expect(highlight('ls -al | grep \\.log')).toContain('<tspan class="se">\\.</tspan>log')
  })

  it('reads each command the way Pygments does', () => {
    for (const [command, expected] of Object.entries(pygments.highlight)) expect(highlight(command), command).toBe(expected)
  })

  it('lexes a nested expansion through the lexer states', () => {
    expect(lexBash('echo "a $(date) b"').map(([css]) => css)).toEqual(['nb', 'w', 's2', 's2', 'k', '', 'k', 's2', 's2', 'w'])
  })
})

describe('lexer coverage', () => {
  /** The rules that lexing `commands` never matched. */
  const unusedRules = (commands: Iterable<string>) => {
    const used = new Set<string>()
    for (const command of commands) lexBash(command, used)
    return LEXER_RULE_IDS.filter((id) => !used.has(id))
  }

  it('gives every rule its own id', () => {
    expect(new Set(LEXER_RULE_IDS).size).toBe(LEXER_RULE_IDS.length)
  })

  it('has a fixture command that reaches every lexer rule', () => {
    const commands = [...Object.keys(pygments.highlight), ...pygments.render.flatMap(({ panes }) => panes.flat())]
    expect(unusedRules(commands), 'rules no probe in the fixture matches; add one to the generator').toEqual([])
  })

  it('reports a rule that no command reaches', () => {
    const without = unusedRules(['echo hi'])
    const withShebang = unusedRules(['echo hi', '#!/bin/sh'])
    expect(without.length).toBeGreaterThan(0)
    // The shebang probe credits the shebang rule and nothing else.
    expect(without.filter((id) => !withShebang.includes(id))).toHaveLength(1)
    expect(unusedRules([])).toEqual(LEXER_RULE_IDS)
  })
})

describe('splitPanes and parseSize', () => {
  it('splits content on --- lines and keeps each pane its commands', () => {
    expect(splitPanes(['echo a', '---', 'echo b'])).toEqual([['echo a'], ['echo b']])
    expect(splitPanes(['echo a', 'echo b', '---', 'echo c'])).toEqual([['echo a', 'echo b'], ['echo c']])
  })

  it('drops blank lines and panes with no commands', () => {
    expect(splitPanes(['echo a', '', '---', 'echo b'])).toEqual([['echo a'], ['echo b']])
    expect(splitPanes(['---', 'echo a', '---', '  ', '---'])).toEqual([['echo a']])
  })

  it('reads a WxH size in either case', () => {
    expect(parseSize('64x18')).toEqual([64, 18])
    expect(parseSize('80X24')).toEqual([80, 24])
  })

  it('rejects a malformed size', () => {
    expect(() => parseSize('not-a-size')).toThrow(/invalid size/)
  })
})

describe('renderLayout', () => {
  it('draws one window, one rect per pane and highlighted prompts', () => {
    const svg = renderLayout([['echo a'], ['echo b']], 'even-vertical', [40, 12])
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('class="gp-tmux-layout"')
    expect(svg.match(/class="window"/g)).toHaveLength(1)
    expect(svg.match(/class="pane"/g)).toHaveLength(2)
    expect(svg).toContain('class="gp"')
    expect(svg.endsWith('</svg>')).toBe(true)
  })

  it('draws one divider between two panes', () => {
    expect(renderLayout([['a'], ['b']], 'even-horizontal', [40, 12]).match(/class="divider"/g)).toHaveLength(1)
  })

  it('clips a compact pane instead of rescaling its text', () => {
    const svg = renderLayout(
      [['cd /var/log', 'ls -al | grep \\.log'], ['echo hello'], ['echo hello'], ['echo hello']],
      'tiled',
      [30, 12],
    )
    expect(svg).toContain('<clipPath')
    expect(svg).toContain('clip-path="url(#tmux-layout-')
    expect(svg).not.toContain('scale(')
    expect(svg).not.toContain('transform="translate')
    expect(svg).toContain('x="6" y="18"')
    expect(svg).toContain('>ls<')
    expect(svg).toContain('>grep<')
    expect(svg).toContain('\\.</tspan>log')
  })

  it('stacks a pane\'s commands one line apart', () => {
    const svg = renderLayout([['one', 'two']], 'even-vertical', [20, 8])
    expect(svg).toContain('x="6" y="18"')
    expect(svg).toContain('x="6" y="35"')
  })

  it('skips a line that highlights to nothing', () => {
    expect(renderLayout([['']], 'even-vertical', [20, 8]).match(/class="cmd"/g)).toBeNull()
  })

  it('gives two diagrams that differ different clip ids, and equal ones the same', () => {
    const id = (svg: string) => /id="([^"]+)-clip-0"/.exec(svg)![1]
    const first = renderLayout([['a'], ['b']], 'even-vertical', [20, 8])
    expect(id(first)).toBe(id(renderLayout([['a'], ['b']], 'even-vertical', [20, 8])))
    expect(id(first)).not.toBe(id(renderLayout([['a'], ['c']], 'even-vertical', [20, 8])))
    expect(renderLayout([['a']], 'even-vertical', [20, 8], { id: 'chosen' })).toContain('id="chosen-clip-0"')
  })

  it('names the diagram for a reader who cannot see it, only when asked', () => {
    const panes = [['echo a'], ['echo b']]
    const plain = renderLayout(panes, 'even-vertical', [40, 12], { id: 'probe' })
    expect(plain).not.toMatch(/aria-label|<title>/)
    const named = renderLayout(panes, 'even-vertical', [40, 12], { id: 'probe', label: 'Window 0, "main" & more: 2 panes, even-vertical' })
    expect(named).toContain('role="img" aria-label="Window 0, &quot;main&quot; &amp; more: 2 panes, even-vertical"')
    expect(named).toContain('<title>Window 0, &quot;main&quot; &amp; more: 2 panes, even-vertical</title><defs>')
    // The label adds a name and changes nothing else, so the parity fixture's output stays as tmuxp writes it.
    expect(named.replace(/ aria-label="[^"]*"/, '').replace(/<title>[^<]*<\/title>/, '')).toBe(plain)
    expect(renderLayout(panes, 'even-vertical', [40, 12], { id: 'probe', label: '' })).toBe(plain)
  })

  it('draws every layout and command as the Python module does', () => {
    for (const { layout, panes, size, svg } of pygments.render) {
      expect(renderLayout(panes, layout, size, { id: 'tmux-layout-1' }), layout).toBe(svg)
    }
  })
})

describe('stylesheet', () => {
  const read = (name: string) => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), 'utf8')
  const sheet = read('tmux-layout.css')
  const siteTokens = ['gp-sphinx-tokens.css', 'api-kinds.css', 'global.css'].map(read).join('\n')

  // Classes the lexer gives the commands a workspace holds, other than the plain-text ones.
  const painted = new Set(Object.values(pygments.highlight).flatMap((html) => [...html.matchAll(/class="([^"]+)"/g)].map((match) => match[1]!)))

  it('colours only with site tokens, so one sheet serves both colour schemes', () => {
    expect(sheet).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(sheet).not.toMatch(/\b(?:rgb|hsl|oklch)a?\(/)
    expect(sheet).not.toMatch(/prefers-color-scheme|data-theme/)
    for (const [, token] of sheet.matchAll(/var\((--[\w-]+)/g)) {
      if (token === '--font-ibm-plex-mono' || token!.startsWith('--gp-tmux-layout-')) continue
      expect(siteTokens, token).toContain(`${token}:`)
    }
  })

  it('styles the classes it draws and the ones the lexer emits for a shell command', () => {
    for (const name of ['gp-tmux-layout-wrapper', 'gp-tmux-layout', 'pane', 'divider', 'window', 'gp']) {
      expect(sheet, name).toContain(`.${name}`)
    }
    const inked = ['s', 's1', 's2', 'sb', 'si', 'c1', 'ch', 'k', 'nv', 'm', 'se', 'gp']
    const plain = ['o', 'p', 'w', 'err']
    for (const name of painted) {
      if (plain.includes(name)) continue
      expect(inked, name).toContain(name)
      expect(sheet, name).toMatch(new RegExp(`\\.${name}\\b`))
    }
  })
})
