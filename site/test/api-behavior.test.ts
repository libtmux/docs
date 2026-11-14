import { experimental_AstroContainer } from 'astro/container'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApiSymbol } from '@libtmux/api-model/reference'
import goSidecar from '../src/data/api/go.behavior.json'
import rsSidecar from '../src/data/api/rs.behavior.json'
import { API_MODELS, indexFor } from '../src/lib/api-models'
import { attachBehavior, type BehaviorSidecar } from '../src/lib/api-behavior'
import { sourcePageHref } from '../src/lib/api-source-pages'
import { loadAstroTemplate, withoutScope } from './astro-templates'

const windows: Window[] = []
afterEach(async () => { for (const win of windows.splice(0)) await win.happyDOM.abort() })

const symbolOf = (port: string, id: string): ApiSymbol => API_MODELS[port].symbols.find((entry) => (entry.publicId ?? entry.id) === id)!

describe('behaviour facts on the model', () => {
  it('are attached to Go and Rust only at the revision they were read from', () => {
    for (const [port, sidecar] of [['go', goSidecar], ['rs', rsSidecar]] as const) {
      expect(sidecar.revision, port).toBe(API_MODELS[port].revision)
      expect(API_MODELS[port].symbols.filter((symbol) => symbol.behavior).length, port).toBe(Object.keys(sidecar.symbols).length)
    }
    const stale = { ...(goSidecar as unknown as BehaviorSidecar), revision: 'f'.repeat(40) }
    const copy = { ...API_MODELS.go, symbols: API_MODELS.go.symbols.map((symbol) => ({ ...symbol, behavior: undefined })) }
    expect(attachBehavior(copy, stale)).toBe(0)
    expect(copy.symbols.some((symbol) => symbol.behavior)).toBe(false)
    // A port whose comments were not read has no facts at all.
    expect(API_MODELS.py.symbols.some((symbol) => symbol.behavior)).toBe(false)
  })

  it('state, for Go Pane.Capture, what its doc comment says with the line each sentence stands on', () => {
    const { behavior } = symbolOf('go', 'tmux.Pane.Capture')
    expect(Object.keys(behavior!)).toEqual(['completion', 'boundedBy', 'ownership', 'errors', 'transport'])
    expect(behavior!.completion).toMatchObject({ source: { file: 'tmux/pane_capture.go', line: 116 }, origin: 'doc comment' })
    expect(behavior!.ownership).toMatchObject({ text: 'It returns a caller-owned slice.', source: { line: 113 } })
    expect(behavior!.boundedBy!.source.line).toBe(121)
    expect(behavior!.transport).toMatchObject({ origin: 'curated', via: 'CaptureToFile', source: { line: 169 } })
    // Each fact is the sentence its recorded evidence line begins, so no fact is a paraphrase.
    const evidence = (goSidecar.symbols as Record<string, { evidence: Record<string, { line: number; text: string }> }>)['tmux.Pane.Capture'].evidence
    for (const [row, record] of Object.entries(evidence)) {
      const fact = (behavior as Record<string, { text?: string; source: { line: number } }>)[row]
      expect(record.line, row).toBe(fact.source.line)
      if (fact.text) expect(fact.text.replace(/\s+/g, ' ').includes(record.text.split(' ').slice(0, 3).join(' ')) || record.text.includes(fact.text.split(' ').slice(0, 3).join(' ')), row).toBe(true)
    }
  })

  it('state, for a Rust async method, its # Errors section and that it returns a future', () => {
    const { behavior } = symbolOf('rs', 'pane.Pane.capture')
    expect(behavior!.errors).toMatchObject({ text: 'Returns an error when tmux refuses the command.', origin: 'doc comment' })
    expect(behavior!.completion).toMatchObject({ text: 'Returns a future that runs when awaited.', origin: 'signature' })
    expect(behavior!.completion!.source.line).toBe(symbolOf('rs', 'pane.Pane.capture').source.line)
  })

  it('leave a declaration whose comment states nothing without behaviour, rather than a row that says unknown', () => {
    const quiet = API_MODELS.go.symbols.find((symbol) => (symbol.kind === 'method') && !symbol.behavior)
    expect(quiet).toBeDefined()
  })
})

describe('the rendered facts', () => {
  async function render(symbol: ApiSymbol, port: string) {
    const template = await loadAstroTemplate('components/api/BehaviorFacts.astro', { real: ['components/api/ApiDoc.astro'] })
    const container = await experimental_AstroContainer.create({ astroConfig: { site: 'https://libtmux.org' } } as never)
    const win = new Window()
    windows.push(win)
    win.document.body.innerHTML = withoutScope(await container.renderToString(template as never, {
      request: new Request('https://libtmux.org/en/go/latest/reference/tmux-pane-capture/'),
      props: {
        symbol, port, index: indexFor(API_MODELS[port], () => '/'),
        sourceUrl: (entry: ApiSymbol) => `https://example.invalid/${entry.source.file}#L${entry.source.line}`,
      },
    }))
    return win.document
  }

  it('draw the rows in the fixed order, each with its citation as a link to the line', async () => {
    const document = await render(symbolOf('go', 'tmux.Pane.Capture'), 'go')
    expect([...document.querySelectorAll('[data-row]')].map((row) => row.getAttribute('data-row'))).toEqual(['completion', 'boundedBy', 'ownership', 'errors', 'transport'])
    expect([...document.querySelectorAll('dt')].map((cell) => cell.textContent)).toEqual(['Completion', 'Bounded by', 'Ownership', 'Errors', 'Transport'])
    expect([...document.querySelectorAll('.api-behavior__src')].map((cite) => cite.textContent)).toEqual([
      'doc comment · pane_capture.go:116', 'doc comment · :121', 'doc comment · :113', 'doc comment · :113', 'CaptureToFile doc · :169',
    ])
    // A citation opens the line on the site's own page for the pinned file, with the symbol it came from.
    expect(document.querySelector('[data-row=errors] a.api-behavior__src')!.getAttribute('href')).toMatch(/\/sources\/tmux\/pane_capture\.go\/\?from=tmux-pane-capture#L113$/)
    expect(document.querySelector('[data-row=errors] a.api-behavior__src')!.getAttribute('href')).toBe(sourcePageHref('go', 'tmux/pane_capture.go', 113, 'tmux-pane-capture'))
    // The error type in the sentence is a cross-reference, not plain text.
    expect(document.querySelector('[data-row=errors] dd a:not(.api-behavior__src)')!.textContent).toContain('CommandError')
  })

  it('draw nothing for a declaration with no behaviour, and no row for what is not stated', async () => {
    const quiet = API_MODELS.go.symbols.find((symbol) => symbol.kind === 'method' && !symbol.behavior)!
    expect((await render(quiet, 'go')).querySelector('.api-behavior')).toBeNull()
    const rust = await render(symbolOf('rs', 'pane.Pane.capture'), 'rs')
    expect([...rust.querySelectorAll('[data-row]')].map((row) => row.getAttribute('data-row'))).toEqual(['completion', 'errors'])
    expect(rust.querySelector('[data-row=completion] .api-behavior__src')!.textContent).toMatch(/^signature · observe\.rs:\d+$/)
  })
})

describe('a citation to a file the site holds no copy of', () => {
  it('opens the line on GitHub at the pinned revision instead', async () => {
    const symbol = { ...symbolOf('go', 'tmux.Pane.Capture'), behavior: { errors: { text: 'It fails.', source: { file: 'tmux/not_cached.go', line: 4 }, origin: 'doc comment' as const } } }
    const template = await loadAstroTemplate('components/api/BehaviorFacts.astro', { real: ['components/api/ApiDoc.astro'] })
    const container = await experimental_AstroContainer.create({ astroConfig: { site: 'https://libtmux.org' } } as never)
    const win = new Window()
    windows.push(win)
    win.document.body.innerHTML = withoutScope(await container.renderToString(template as never, {
      request: new Request('https://libtmux.org/'),
      props: { symbol, port: 'go', index: indexFor(API_MODELS.go, () => '/'), sourceUrl: (entry: ApiSymbol) => `https://example.invalid/${entry.source.file}#L${entry.source.line}` },
    }))
    expect(win.document.querySelector('a.api-behavior__src')!.getAttribute('href')).toBe('https://example.invalid/tmux/not_cached.go#L4')
  })
})
