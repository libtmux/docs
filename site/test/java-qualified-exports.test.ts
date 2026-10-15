import { describe, expect, it } from 'vitest'
import { API_MODELS } from '../src/lib/api-models'
import { symbolMarkdown } from '../src/lib/symbol-markdown'

it('keeps an existing Java enum route when a record accessor differs only by case', () => {
  const model = API_MODELS.java
  const type = model.symbols.find((symbol) => symbol.id === 'io.github.libtmux.PaneRun.PaneRun.Outcome')!
  const accessor = model.symbols.find((symbol) => symbol.id === 'io.github.libtmux.PaneRun.PaneRun.outcome')!
  const base = 'io-github-libtmux-panerun-panerun-outcome'
  expect(type).toMatchObject({ kind: 'enum', slug: base })
  expect(accessor.kind).toBe('method')
  expect(accessor.signatures).toEqual([{ params: [], returns: 'Outcome' }])
  expect(accessor.source.line).toBeUndefined()
  expect(accessor.slug).toMatch(new RegExp(`^${base}-[a-z0-9]{4}$`))
})

it('copies Java record component documentation and implicit accessors without invented method lines', () => {
  const model = API_MODELS.java
  const owner = model.symbols.find((symbol) => symbol.id === 'io.github.libtmux.batch.BatchResult.BatchResult')!
  const accessor = model.symbols.find((symbol) => symbol.id === `${owner.id}.operations`)!
  expect(owner.kind).toBe('class')
  expect(owner.signatures[0].params).toEqual([{ name: 'operations', type: 'List<OperationResult>',
    doc: 'one result per submitted operation, in submission order' }])
  expect(accessor.source.file).toBe('libtmux/src/main/java/io/github/libtmux/batch/BatchResult.java')
  expect(accessor.source.line).toBeUndefined()
  for (const symbol of [owner, accessor]) {
    const canonical = `https://libtmux.org/en/java/latest/reference/${symbol.slug}/`
    const text = symbolMarkdown({ model, symbol, canonical })
    expect(text).toContain('one result per submitted operation, in submission order')
    expect(text).toContain('List<OperationResult>')
    expect(text).toContain(canonical)
  }
})

describe('Java names in copied Markdown', () => {
  for (const [id, name] of [
    ['io.github.libtmux.Server.Server', 'io.github.libtmux.Server'],
    ['io.github.libtmux.Server.Server.Builder', 'io.github.libtmux.Server.Builder'],
    ['io.github.libtmux.Server.Server.sessions', 'io.github.libtmux.Server.sessions'],
  ]) {
    it(`uses the source name of ${name} and retains its existing page URL`, () => {
      const model = API_MODELS.java
      const symbol = model.symbols.find((entry) => entry.id === id)!
      expect(symbol).toBeDefined()
      const canonical = `https://libtmux.org/en/java/latest/reference/${symbol.slug}/`
      const text = symbolMarkdown({ model, symbol, canonical })
      expect(text).toMatch(new RegExp(`^# ${name.replaceAll('.', '\\.') }\\n`))
      expect(text).toContain('- **Module:** io.github.libtmux\n')
      expect(text).toContain(`- **Page:** ${canonical}\n`)
      if (symbol.signatures.length) expect(text).toContain(`${name}(`)
      expect(symbol.id).toBe(id)
    })
  }
})
