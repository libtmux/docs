import type { Document } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SymbolIndex, type ApiSymbol } from '@libtmux/api-model/reference'
import { API_MODELS } from '../src/lib/api-models'
import { closeWindows, complete, css, entry, go, page, symbolOf } from './api-page-fixtures'

vi.mock('astro:content', () => ({ getCollection: async () => [] }))
afterEach(closeWindows)
// The first test of a cold run compiles the real templates and loads the API models.
vi.setConfig({ testTimeout: 60_000 })

/**
 * The order of an entry against the design system (ParameterList; adoption step 6).
 */
describe('the entry order (ParameterList, adoption step 6)', () => {
  const order = (document: Document) => [...document.querySelectorAll('dd > *')]
    .flatMap((node) => {
      const label = node.querySelector(':scope > h2.rubric')?.firstChild?.textContent
        ?? [...node.querySelectorAll('dl.field-list > dt')].map((dt) => dt.textContent)
      return label ? [label].flat() : []
    })

  it('puts Parameters, Returns and Errors before Examples and References, and the caution under the signature', async () => {
    const document = await entry(complete())
    expect(order(document)).toEqual(['Description', 'Parameters', 'Returns', 'Errors', 'Examples', 'References'])
    // The replacement is named directly under the declaration, before the description, not after the examples.
    const body = [...document.querySelector('dd')!.children]
    const caution = body.findIndex((node) => node.hasAttribute('data-aside') || node.textContent?.includes('Use Pane.CaptureBytes'))
    const description = body.findIndex((node) => node.classList.contains('gp-sphinx-api-description'))
    expect(caution).toBeGreaterThanOrEqual(0)
    expect(caution).toBeLessThan(description)
  })

  it('orders the section bar the way the page reads', async () => {
    const document = await page(complete())
    const labels = [...document.querySelectorAll('nav.api-section-links a')].map((link) => link.firstChild?.textContent?.trim())
    const at = (label: string) => labels.indexOf(label)
    expect(at('Parameters')).toBeGreaterThan(-1)
    expect(at('Parameters')).toBeLessThan(at('Returns'))
    expect(at('Returns')).toBeLessThan(at('Errors'))
    expect(at('Errors')).toBeLessThan(at('Examples'))
  })

  it('names the section Errors everywhere but Python, which says Raises', async () => {
    expect((await entry(complete())).querySelector('dl.field-list > dt[id$=".errors"]')?.textContent).toBe('Errors')
    const python = API_MODELS.py
    const base = symbolOf(python, 'libtmux.pane.Pane.capture_pane')
    const symbol = { ...base, signatures: base.signatures.map((signature) => ({ ...signature, raises: [{ type: 'ValueError', doc: 'bad' }] })) } as ApiSymbol
    const index = new SymbolIndex(python.symbols, (entry) => `/en/py/latest/reference/${entry.slug}/`, 'py')
    expect((await entry(symbol, { index, port: 'py' })).querySelector('dl.field-list > dt[id$=".errors"]')?.textContent).toBe('Raises')
  }, 60_000)

  it('shows the default of every port that records one, and none where nothing is recorded', async () => {
    const lua = API_MODELS.lua
    const symbol = lua.symbols.find((candidate) => candidate.signatures[0]?.params.some((param) => param.default !== undefined))!
    const index = new SymbolIndex(lua.symbols, (entry) => `/en/lua/latest/reference/${entry.slug}/`, 'lua')
    const document = await entry(symbol, { index, port: 'lua' })
    const defaults = [...document.querySelectorAll('.api-parameter-default')]
    expect(defaults.length).toBeGreaterThan(0)
    expect(defaults[0]!.textContent).toMatch(/^Default\s+\S/)
    expect(defaults[0]!.querySelector('code')).not.toBeNull()
    // Go records none, and the page does not invent a line.
    expect((await entry(symbolOf(go, 'tmux.Pane.Capture'))).querySelector('.api-parameter-default')).toBeNull()
  }, 60_000)

  it('sets parameter names as code in the mono face', () => {
    expect(css).toMatch(/\.api-parameters:not\(\.mcp-parameters\) \.api-parameter-signature strong code \{[^}]*font-family: var\(--font-mono/)
  })
})

