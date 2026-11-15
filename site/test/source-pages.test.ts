import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { API_MODELS } from '../src/lib/api-models'
import { hasSourceView, sourceFilesFor } from '../src/lib/api-source-pages'
import { sourceIndex, sourceRoutes } from '../src/lib/source-declarations'
import { sourceLines } from '../src/lib/source-html'

describe('source page routes', () => {
  it('generates a page for every pinned Go file although Go has no generated sources', () => {
    const model = API_MODELS.go!
    expect(model.generatedSources).toBeUndefined()
    const routes = sourceRoutes('go', model)
    expect(routes.length).toBe(sourceFilesFor('go').length)
    expect(new Set(routes.map((route) => route.params.path)).size).toBe(routes.length)
    const capture = routes.find((route) => route.params.path === 'tmux/pane_capture.go')!
    expect(capture.props.origin).toEqual({ repo: model.repo, revision: model.revision })
    const method = capture.props.declarations.find((declaration) => declaration.id === 'tmux.Pane.Capture')!
    expect(method).toMatchObject({ title: 'Pane.Capture', kind: 'method', line: 126, from: 113, to: 132 })
  })

  it('gives every cited file of a port a page, so a link to it never dangles', () => {
    for (const port of ['go', 'rs', 'ts', 'perl', 'erlang']) {
      const model = API_MODELS[port]!
      const pages = new Set(sourceRoutes(port, model).map((route) => route.params.path))
      for (const symbol of model.symbols) {
        if (symbol.source?.file && !pages.has(symbol.source.file)) throw new Error(`${port}: ${symbol.source.file} has no source page`)
      }
    }
  })

  it('serves the files a model embeds from the model, with no repository to link', () => {
    const model = API_MODELS.kotlin!
    const embedded = Object.keys(model.generatedSources ?? {})
    expect(embedded.length).toBeGreaterThan(0)
    const routes = sourceRoutes('kotlin', model)
    for (const file of embedded) {
      const route = routes.find((candidate) => candidate.params.path === file)
      expect(route?.props.origin, file).toBeUndefined()
      expect(route?.props.content, file).toBe(model.generatedSources![file])
    }
  })
})

describe('the pane\'s symbol index and source control', () => {
  it('maps a symbol slug to its file, range, heading and kind', () => {
    const index = sourceIndex('go', API_MODELS.go!)
    expect(index['tmux-pane-capture']).toEqual(['tmux/pane_capture.go', 126, 113, 132, 'Pane.Capture', 'method'])
    // Every symbol the Go model cites a file for is indexed, so a reload or a followed type can open it.
    const cited = API_MODELS.go!.symbols.filter((symbol) => symbol.slug && symbol.source?.file && symbol.source.line)
    expect(Object.keys(index).length).toBe(new Set(cited.map((symbol) => symbol.slug)).size)
  })

  it('offers a source view only where a page exists to load', () => {
    const capture = API_MODELS.go!.symbols.find((symbol) => symbol.slug === 'tmux-pane-capture')!
    expect(hasSourceView('go', capture)).toBe(true)
    expect(hasSourceView('go', { ...capture, source: { ...capture.source, file: 'tmux/not_a_file.go' } })).toBe(false)
    expect(hasSourceView('go', { ...capture, source: { file: capture.source.file } })).toBe(false)
    expect(hasSourceView('go', { ...capture, slug: undefined })).toBe(false)
    expect(hasSourceView(undefined, capture)).toBe(false)
    expect(hasSourceView('not-a-port', capture)).toBe(false)
  })
})

describe('sourceLines', () => {
  it('numbers each line, escapes markup, links gutter marks and names the ranges a fragment can target', async () => {
    const { html, css, lines } = await sourceLines('package a\n\n// x < y\nfunc A() {\n}\n', 'go',
      new Map([[4, { href: '/ref/a/', title: 'Documented as a.A', kind: 'function' }]]), [{ from: 3, to: 5 }])
    expect(lines).toBe(5)
    expect(html.match(/<span id="L\d+" data-n="\d+">/g)).toHaveLength(5)
    expect(html).toContain('x &lt; y')
    expect(html).toContain('<a href="/ref/a/" title="Documented as a.A"')
    expect(html).toContain('id="L3-L5"')
    expect(css, 'the tint is the code block\'s, never the numbers\'').toContain('.lm-src:has(#L3-L5:target)>span:nth-child(n+3):nth-child(-n+5)>code{background:var(--color-highlight-on-target)}')
  })

  it('writes one class per colour pair rather than a style on every token', async () => {
    const { html, css } = await sourceLines('a := 1\nb := 2\n', 'go')
    expect(html).not.toContain('style=')
    expect(css).toMatch(/^\.lm-src \.t0\{--shiki-light:#/)
  })
})

describe('the source view\'s numbers and marks (record 0058)', () => {
  const css = readFileSync(new URL('../src/styles/source.css', import.meta.url), 'utf8')
  const rule = (selector: string) => new RegExp(`\\n${selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1]

  it('hangs the marks and the numbers 12px in from the column\'s edge, the view\'s own line padding', () => {
    expect(rule('.lm-src > span'), 'a rule for a numbered line').toMatch(/padding: 0 0 0 12px/)
    expect(rule('.lm-src > span')).toMatch(/grid-template-columns: 22px calc\(6ch \+ 12px\) minmax\(0, 1fr\)/)
  })

  it('moves the code block right by the rail\'s width and 24px, and gives it the code ground and a hairline', () => {
    const lines = rule('.lm-src')!
    expect(lines, 'the rail is a mark, a gap, the number and a gap, 12px each side').toMatch(/--lm-src-edge:\s*calc\(46px \+ 6ch\)/)
    expect(lines, 'the code ground starts at the edge, so the column is the page\'s').toMatch(/background:[^;]*var\(--lm-src-bg\)[^;]*var\(--lm-src-edge\)/)
    expect(lines, 'a hairline marks the edge').toMatch(/var\(--color-background-border\)[^;]*var\(--lm-src-edge\)/)
    expect(rule('.lm-src > span > code'), 'the code keeps 12px either side').toMatch(/padding: 0 12px/)
  })

  it('keeps the target line\'s tint inside the code block, never under the marks and numbers', () => {
    expect(rule('.lm-src > span.hl > code')).toMatch(/background: var\(--color-highlight-on-target\)/)
    expect(rule('.lm-src > span:target > code')).toMatch(/background: var\(--color-highlight-on-target\)/)
    expect(rule('.lm-src > span.hl'), 'the row itself takes no tint').toBeUndefined()
    expect(rule('.lm-src > span:target')).toBeUndefined()
  })

  it('leaves the pane\'s scrolling column on the page\'s ground and its lines on the page\'s columns', () => {
    expect(rule('.lm-pane__body')).toMatch(/background: var\(--background-color\)/)
    expect(rule('.lm-pane__body .lm-src > span'), 'the pane overrides only the scroll margin').not.toMatch(/grid-template-columns/)
  })
})
