import { readFileSync } from 'node:fs'
import { createRenderer } from 'astro-expressive-code'
import { select, selectAll, toHtml } from 'astro-expressive-code/hast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { Window } from 'happy-dom'
import { beforeAll, describe, expect, it } from 'vitest'
import ecConfig from '../ec.config.mjs'
import {
  LONG_PROGRAM_LINES,
  PROGRAM_CAP_LINES,
  citeMeta,
  excerptMeta,
  formatLines,
  lineCap,
  lineNumbers,
  parseLines,
  rangeFragment,
  roleLabel,
} from '../src/lib/code-frame.mjs'
import { parseFenceAttributes } from '../src/lib/example-excerpt.ts'
import { remarkPortCode } from '../src/plugins/remark-port-code.mjs'

const go = (count: number, first = 1) =>
  Array.from({ length: count }, (_, index) => `x${first + index} := ${first + index}`).join('\n')

describe('line ranges', () => {
  it('reads one range, several ranges and a single line', () => {
    expect(parseLines('59-78')).toEqual([{ start: 59, end: 78 }])
    expect(parseLines('12-40,55-60')).toEqual([{ start: 12, end: 40 }, { start: 55, end: 60 }])
    expect(parseLines('7')).toEqual([{ start: 7, end: 7 }])
  })

  it.each(['', 'a-b', '9-3', '0-4', '3-', '1-2,x'])('rejects %j instead of showing a wrong range', (spec) => {
    expect(parseLines(spec)).toEqual([])
  })

  it('writes the range the way the design names it', () => {
    expect(formatLines([{ start: 59, end: 78 }])).toBe('lines 59–78')
    expect(formatLines([{ start: 7, end: 7 }])).toBe('line 7')
    expect(formatLines([{ start: 12, end: 40 }, { start: 55, end: 60 }])).toBe('lines 12–40, 55–60')
    expect(roleLabel('excerpt', [{ start: 59, end: 78 }])).toEqual({ name: 'Excerpt', detail: 'lines 59–78' })
    expect(roleLabel('program', [])).toEqual({ name: 'Complete program', detail: '' })
    expect(roleLabel('other', [])).toBeUndefined()
  })

  it('numbers every row of a range and leaves the blank row between ranges unnumbered', () => {
    expect(lineNumbers([{ start: 59, end: 61 }], 3)).toEqual([59, 60, 61])
    expect(lineNumbers([{ start: 12, end: 13 }, { start: 55, end: 56 }], 5)).toEqual([12, 13, undefined, 55, 56])
  })

  it('numbers nothing when the rows do not match the range, rather than mislabel them', () => {
    expect(lineNumbers([{ start: 59, end: 78 }], 3)).toBeUndefined()
    expect(lineNumbers([], 3)).toBeUndefined()
  })
})

describe('the lines of a program that an excerpt cites (record 0054)', () => {
  it('writes a range the way a URL fragment names it', () => {
    expect(rangeFragment({ start: 63, end: 72 })).toBe('L63-L72')
    expect(rangeFragment({ start: 7, end: 7 })).toBe('L7')
  })

  it('lists the cited ranges once each, in source order', () => {
    expect(citeMeta([{ start: 59, end: 78 }, { start: 6, end: 6 }, { start: 59, end: 78 }])).toBe('6,59-78')
    expect(citeMeta([])).toBeUndefined()
  })
})

describe('line cap', () => {
  it('ignores a cap within three lines of the total, so one or two lines never hide behind a button', () => {
    expect(lineCap(40, 36)).toBe(36)
    expect(lineCap(40, 37)).toBe(0)
    expect(lineCap(18, 16)).toBe(0)
    expect(lineCap(86, 16)).toBe(16)
  })

  it('shows every line unless a cap is asked for', () => {
    expect(lineCap(500, 0)).toBe(0)
    expect(lineCap(500, Number.NaN)).toBe(0)
  })
})

describe('excerpt meta', () => {
  it('names the file, the frame, the role and the source lines', () => {
    const meta = excerptMeta({ title: 'main.go', ranges: [{ start: 59, end: 78 }] })
    expect(parseFenceAttributes(meta)).toEqual({ title: 'main.go', frame: 'code', role: 'excerpt', lines: '59-78' })
  })

  it('writes each range of a joined excerpt, and leaves the frame to a caller that sets its own file name', () => {
    expect(parseFenceAttributes(excerptMeta({ ranges: [{ start: 12, end: 40 }, { start: 55, end: 55 }] })))
      .toEqual({ role: 'excerpt', lines: '12-40,55' })
  })
})

describe('Expressive Code frames', () => {
  let render: (code: string, meta: string, language?: string) => Promise<ReturnType<typeof toHtml> & string>
  let rendered: (code: string, meta: string, language?: string) => Promise<any>
  let baseStyles: string
  let script: string

  beforeAll(async () => {
    const renderer = await createRenderer(ecConfig)
    baseStyles = renderer.baseStyles
    script = renderer.jsModules.filter((module: string) => module.includes('data-cap-toggle')).join('\n')
    rendered = async (code, meta, language = 'go') => (await renderer.ec.render({ code, language, meta })).renderedGroupAst
    render = async (code, meta, language) => toHtml(await rendered(code, meta, language))
  })

  /** The page with the frame drawn and the frame scripts run, at `url`. */
  const open = async (code: string, meta: string, url = 'https://libtmux.org/en/example/') => {
    const window = new Window({ url })
    window.document.body.innerHTML = await render(code, meta)
    window.eval(script)
    const document = window.document as unknown as Document
    return { window, document, button: document.querySelector<HTMLButtonElement>('.cap button')!, frame: document.querySelector<HTMLElement>('.frame')! }
  }

  describe('role label', () => {
    it('says Excerpt with the source lines in the header, after the file name', async () => {
      const ast = await rendered(go(3), 'title="main.go" frame="code" role="excerpt" lines="59-61"')
      const header = select('figcaption.header', ast)!
      expect(select('.title', header)!.children).toEqual([{ type: 'text', value: 'main.go' }])
      const role = select('.role', header)!
      expect(toHtml(role)).toBe('<span class="role" data-pagefind-ignore=""><b>Excerpt</b> · lines 59–61</span>')
      expect(select('figure.frame', ast)!.properties.dataRole).toBe('excerpt')
    })

    it('says Complete program, with no line numbers unless an excerpt cites it: a program is for copying', async () => {
      const ast = await rendered(go(5), 'title="main.go" frame="code" role="program"')
      expect(toHtml(select('.role', ast)!)).toBe('<span class="role" data-pagefind-ignore=""><b>Complete program</b></span>')
      expect(select('figure.frame', ast)!.properties.dataRole).toBe('program')
      expect(selectAll('.gutter', ast)).toHaveLength(0)
    })

    it('leaves a frame without a role as it was', async () => {
      const ast = await rendered(go(3), 'title="main.go"')
      expect(select('.role', ast)).toBeUndefined()
      expect(select('figure.frame', ast)!.properties.dataRole).toBeUndefined()
      expect(selectAll('.gutter', ast)).toHaveLength(0)
      expect(select('.cap', ast)).toBeUndefined()
    })

    it('ignores a role it does not know and a role on a frame with no file name', async () => {
      expect(select('.role', await rendered(go(3), 'title="a.go" role="nonsense"'))).toBeUndefined()
      expect(select('.role', await rendered(go(3), 'role="excerpt" lines="1-3"'))).toBeUndefined()
    })
  })

  describe('source line numbers', () => {
    it('numbers an excerpt from its first source line and leaves the numbers out of Copy', async () => {
      const code = go(3, 59)
      const ast = await rendered(code, 'title="main.go" frame="code" role="excerpt" lines="59-61"')
      expect(selectAll('.ec-line .gutter .ln', ast).map((ln) => toHtml(ln.children))).toEqual(['59', '60', '61'])
      expect(selectAll('.ln', ast).every((ln) => ln.properties.ariaHidden === 'true')).toBe(true)
      expect(selectAll('.gutter', ast).every((gutter) => gutter.properties.dataPagefindIgnore === ''), 'search skips the numbers').toBe(true)
      expect(select('.copy button[data-code]', ast)!.properties.dataCode).toBe(code.replace(/\n/g, '\x7f'))
    })

    it('keeps the number column one width on every row', async () => {
      const ast = await rendered(go(3, 98), 'title="main.go" frame="code" role="excerpt" lines="98-100"')
      expect(select('pre', ast)!.properties.style).toContain('--ln-width: 3ch')
    })

    it('numbers each range of a joined excerpt and skips the blank row between them', async () => {
      const ast = await rendered('a\nb\n\nc\nd', 'title="main.go" frame="code" role="excerpt" lines="12-13,55-56"')
      expect(selectAll('.ec-line', ast).map((row) => select('.ln', row) ? toHtml(select('.ln', row)!.children) : '')).toEqual(['12', '13', '', '55', '56'])
    })

    it('shows no numbers when the range does not describe the rows', async () => {
      const ast = await rendered(go(3), 'title="main.go" frame="code" role="excerpt" lines="59-78"')
      expect(selectAll('.gutter', ast)).toHaveLength(0)
      expect(toHtml(select('.role', ast)!)).toContain('lines 59–78')
    })
  })

  describe('a complete program that an excerpt cites (record 0054)', () => {
    const cited = 'title="main.go" frame="code" role="program" cite="2-3,5"'

    it('numbers every line from 1, and gives the first line of each cited range its fragment', async () => {
      const code = go(6)
      const ast = await rendered(code, cited)
      expect(selectAll('.ec-line .gutter .ln', ast).map((ln) => toHtml(ln.children))).toEqual(['1', '2', '3', '4', '5', '6'])
      expect(selectAll('.ec-line', ast).map((row) => row.properties.id ?? '')).toEqual(['', 'L2-L3', '', '', 'L5', ''])
      expect(selectAll('.gutter', ast).every((gutter) => gutter.properties.dataPagefindIgnore === ''), 'search skips the numbers').toBe(true)
      expect(select('.copy button[data-code]', ast)!.properties.dataCode).toBe(code.replace(/\n/g, '\x7f'))
      expect(toHtml(select('.role', ast)!)).toBe('<span class="role" data-pagefind-ignore=""><b>Complete program</b></span>')
    })

    it('keeps the number column one width on every row', async () => {
      const ast = await rendered(go(120), 'title="main.go" frame="code" role="program" height="full" cite="100-105"')
      expect(select('pre', ast)!.properties.style).toContain('--ln-width: 3ch')
    })

    it('numbers a program only when it is one: a cite on an excerpt or on a frame with no role changes nothing', async () => {
      expect(selectAll('.gutter', await rendered(go(3), 'title="a.go" frame="code" cite="1-2"'))).toHaveLength(0)
      expect(selectAll('.ec-line', await rendered(go(3), 'title="a.go" frame="code" role="excerpt" lines="5-7" cite="1-2"')).map((row) => row.properties.id ?? '')).toEqual(['', '', ''])
    })

    it('links the excerpt\'s range to those lines, and leaves the range plain where nothing leads there', async () => {
      const ast = await rendered(go(3, 59), 'title="main.go" frame="code" role="excerpt" lines="59-61" program="main.go"')
      expect(toHtml(select('.role', ast)!)).toBe('<span class="role" data-pagefind-ignore=""><b>Excerpt</b> · <a href="#L59-L61" title="Lines 59–61 of the complete program main.go">lines 59–61</a></span>')
      const plain = await rendered(go(3, 59), 'title="main.go" frame="code" role="excerpt" lines="59-61"')
      expect(select('.role a', plain)).toBeUndefined()
    })

    it('highlights the lines of a range on arrival, and again when the fragment changes', async () => {
      const { window, document } = await open(go(6), cited, 'https://libtmux.org/en/example/#L2-L3')
      const hit = () => [...document.querySelectorAll('.ec-line[data-hit] .ln')].map((ln) => ln.textContent)
      expect(hit()).toEqual(['2', '3'])
      window.location.hash = '#L5'
      window.dispatchEvent(new window.Event('hashchange'))
      expect(hit()).toEqual(['5'])
      window.location.hash = '#api-section'
      window.dispatchEvent(new window.Event('hashchange'))
      expect(hit()).toEqual([])
    })

    it('highlights the lines a range link names when the router follows it without changing the hash', async () => {
      const { document } = await open(go(6), cited)
      const link = document.createElement('a')
      link.setAttribute('href', '#L2-L3')
      document.body.append(link)
      link.click()
      expect([...document.querySelectorAll('.ec-line[data-hit] .ln')].map((ln) => ln.textContent)).toEqual(['2', '3'])
    })

    it('opens a capped program that holds a highlighted line', async () => {
      const { document } = await open(go(60), 'title="main.go" frame="code" role="program" cite="50-52"', 'https://libtmux.org/en/example/#L50-L52')
      expect(document.querySelector('.frame')!.hasAttribute('data-expanded')).toBe(true)
      expect(document.querySelector('.cap button')!.getAttribute('aria-expanded')).toBe('true')
      expect([...document.querySelectorAll('.ec-line[data-hit] .ln')].map((ln) => ln.textContent)).toEqual(['50', '51', '52'])
    })

    it('highlights nothing for a fragment that is not a line range', async () => {
      const { document } = await open(go(6), cited, 'https://libtmux.org/en/example/#L2x')
      expect(document.querySelectorAll('[data-hit]')).toHaveLength(0)
    })

    it('marks the highlighted rows with the page\'s target colour and a forced-colours outline', () => {
      expect(baseStyles).toMatch(/\.ec-line\[data-hit\][^{]*\{[^}]*background:\s*var\(--color-highlight-on-target/)
      expect(baseStyles).toMatch(/forced-colors:\s*active\)\s*\{[^@]*\.ec-line\[data-hit\][^{]*\{[^}]*outline/)
    })
  })

  describe('copy button', () => {
    it('is on every frame unless the fence turns it off for a component that brings its own', async () => {
      expect(select('.copy button[data-code]', await rendered(go(3), 'frame="none"'))).toBeDefined()
      const off = await rendered(go(3), 'frame="none" copy="off"')
      expect(select('.copy', off), 'one copy control per frame').toBeUndefined()
      expect(select('pre', off)).toBeDefined()
    })
  })

  describe('height', () => {
    it('caps a long frame, says how many lines it shows and offers the rest', async () => {
      const code = go(86)
      const ast = await rendered(code, `title="main.go" frame="code" height="16"`)
      const figure = select('figure.frame', ast)!
      expect(figure.properties.dataCap).toBe('16')
      const bar = select('.cap', ast)!
      expect(bar.properties.dataPagefindIgnore, 'search skips the bar').toBe('')
      expect(toHtml(select('.cap-count', bar)!)).toBe('<span class="cap-count">16 of 86 lines</span>')
      const button = select('button', bar)!
      expect(toHtml(button.children)).toBe('Show all 86 lines')
      expect(button.properties.ariaExpanded).toBe('false')
      expect(button.properties.disabled).toBe(true)
      const pre = select('pre', ast)!
      expect(pre.properties.id).toBeTruthy()
      expect(button.properties.ariaControls).toEqual([pre.properties.id])
      expect(select('.copy button[data-code]', ast)!.properties.dataCode).toBe(code.replace(/\n/g, '\x7f'))
    })

    it('shows every line by default', async () => {
      const ast = await rendered(go(200), 'title="main.go" frame="code"')
      expect(select('.cap', ast)).toBeUndefined()
      expect(select('figure.frame', ast)!.properties.dataCap).toBeUndefined()
    })

    it('ignores a cap within three lines of the total', async () => {
      expect(select('.cap', await rendered(go(18), 'title="main.go" frame="code" height="16"'))).toBeUndefined()
      expect(select('.cap', await rendered(go(19), 'title="main.go" frame="code" height="16"'))).toBeUndefined()
      expect(select('.cap', await rendered(go(20), 'title="main.go" frame="code" height="16"'))).toBeDefined()
    })

    it('caps a long complete program and never an excerpt', async () => {
      const long = go(LONG_PROGRAM_LINES)
      const program = await rendered(long, 'title="main.go" frame="code" role="program"')
      expect(select('figure.frame', program)!.properties.dataCap).toBe(String(PROGRAM_CAP_LINES))
      expect(toHtml(select('.cap-count', program)!)).toContain(`${PROGRAM_CAP_LINES} of ${LONG_PROGRAM_LINES} lines`)
      const short = await rendered(go(LONG_PROGRAM_LINES - 1), 'title="main.go" frame="code" role="program"')
      expect(select('.cap', short)).toBeUndefined()
      const excerpt = await rendered(go(90, 1), 'title="main.go" frame="code" role="excerpt" lines="1-90"')
      expect(select('.cap', excerpt)).toBeUndefined()
    })

    it('lets the author show a long program in full', async () => {
      const ast = await rendered(go(120), 'title="main.go" frame="code" role="program" height="full"')
      expect(select('.cap', ast)).toBeUndefined()
    })

    it('applies the cap and the bar only where scripting is on, and prints every line', () => {
      const scripted = /@media \(scripting:\s*enabled\)\s*\{[^@]*\.frame\[data-cap\] pre\s*\{[^}]*max-height/.exec(baseStyles)
      expect(scripted, 'the cap sits inside a scripting media query, so a reader without JavaScript sees every line').not.toBeNull()
      const print = /@media print\s*\{([^@]*?\.cap[^@]*)\}/.exec(baseStyles)
      expect(print, 'a print rule').not.toBeNull()
      expect(print![1]).toMatch(/max-height:\s*none/)
      expect(print![1]).toMatch(/\.cap\s*\{\s*display:\s*none/)
      expect(print![1]).toMatch(/pre-wrap/)
    })
  })

  describe('Show all lines button', () => {
    it('is disabled until the script is ready, then expands and collapses the frame', async () => {
      const { button, frame, document } = await open(go(86), 'title="main.go" frame="code" height="16"')
      expect(button.disabled).toBe(false)
      expect(button.hasAttribute('data-cap-pending')).toBe(false)
      button.click()
      expect(button.getAttribute('aria-expanded')).toBe('true')
      expect(button.textContent).toBe('Show fewer lines')
      expect(frame.hasAttribute('data-expanded')).toBe(true)
      expect(document.querySelector('.cap-count')!.hasAttribute('hidden')).toBe(true)
      button.click()
      expect(button.getAttribute('aria-expanded')).toBe('false')
      expect(button.textContent).toBe('Show all 86 lines')
      expect(frame.hasAttribute('data-expanded')).toBe(false)
      expect(document.querySelector('.cap-count')!.hasAttribute('hidden')).toBe(false)
    })

    it('does not touch the lines Copy takes', async () => {
      const code = go(86)
      const { button, document } = await open(code, 'title="main.go" frame="code" height="16"')
      button.click()
      expect(document.querySelector('.copy button')!.getAttribute('data-code')).toBe(code.replace(/\n/g, '\x7f'))
    })
  })
})

describe('what the fences of a page ask the frame for', () => {
  const body = readFileSync(new URL('./fixtures/code-frame-page.md', import.meta.url), 'utf8')

  /** The mdast code nodes after the plugin has run, with their info strings. */
  const codes = (markdown: string) => {
    const tree = fromMarkdown(markdown) as { children: { type: string; lang?: string; meta?: string | null; value: string }[] }
    const plugin = remarkPortCode.call({ parse: (text: string) => fromMarkdown(text) } as never)
    plugin(tree as never, { path: '/site/page.md', value: markdown, data: {} } as never)
    return tree.children.filter((node) => node.type === 'code')
  }
  const attributes = (node: { meta?: string | null }) => parseFenceAttributes(node.meta)

  it('labels an excerpt of a block on the page with its file, its role and the lines it quotes', () => {
    const [first] = codes(body)
    expect(attributes(first!)).toEqual({ title: 'main.go', frame: 'code', role: 'excerpt', lines: '7-8', program: 'main.go' })
    expect(first!.meta).not.toMatch(/excerpt=|from=|\bto=/)
  })

  it('labels the block an excerpt quotes as the complete program', () => {
    const program = codes(body).find((node) => attributes(node).title === 'main.go' && attributes(node).role === 'program')
    expect(program).toBeDefined()
    expect(attributes(program!)).toMatchObject({ frame: 'code', role: 'program' })
  })

  it('tells the complete program which of its lines the excerpts cite, so it numbers them (record 0054)', () => {
    const program = codes(body).find((node) => attributes(node).title === 'main.go' && attributes(node).role === 'program')!
    expect(attributes(program).cite).toBe('6,7-8')
  })

  it('leaves a titled block nothing quotes, and a plain fence, as they are', () => {
    const nodes = codes(body)
    expect(attributes(nodes.find((node) => attributes(node).title === 'go.mod')!)).toEqual({ title: 'go.mod' })
    expect(nodes.find((node) => node.lang === 'console')!.meta ?? '').toBe('')
  })

  it('keeps a title the author gave an excerpt and a role the author chose', () => {
    const nodes = codes(body)
    const titled = nodes.find((node) => attributes(node).title === 'step.go')!
    expect(attributes(titled)).toMatchObject({ title: 'step.go', role: 'excerpt', lines: '6', program: 'main.go' })
    const chosen = nodes.find((node) => attributes(node).title === 'config.yaml')!
    // Nothing quotes it, so it is not cited and stays unnumbered.
    expect(attributes(chosen)).toEqual({ title: 'config.yaml', role: 'program', frame: 'code' })
  })

  it('names a whole cached file, and the lines of an excerpt of one, from the example cache', () => {
    const nodes = codes('```go file="examples/pane-io/main.go"\n```\n\n```go file="examples/pane-io/main.go" from="server, err := tmux.NewServer" to="return run(ctx, server)"\n```\n')
    expect(attributes(nodes[0]!)).toMatchObject({ title: 'main.go', frame: 'code', role: 'program' })
    const { lines, role, title, program } = attributes(nodes[1]!)
    expect(role).toBe('excerpt')
    expect(title).toBe('main.go')
    expect(program).toBe('main.go')
    expect(attributes(nodes[0]!).cite).toBe(lines)
    expect(lines).toMatch(/^\d+-\d+$/)
    const [start, end] = lines!.split('-').map(Number)
    expect(nodes[1]!.value.split('\n')).toHaveLength(end! - start! + 1)
  })

  it('links no range, and numbers no program, where the page holds no complete program of the excerpt\'s file', () => {
    const [excerpt] = codes('```go file="examples/pane-io/main.go" from="server, err := tmux.NewServer" to="return run(ctx, server)"\n```\n')
    expect(attributes(excerpt!).role).toBe('excerpt')
    expect(attributes(excerpt!).program).toBeUndefined()
  })
})
