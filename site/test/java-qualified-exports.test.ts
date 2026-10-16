import { describe, expect, it } from 'vitest'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { API_MODELS } from '../src/lib/api-models'
import { symbolMarkdown } from '../src/lib/symbol-markdown'

function expectJavaExport(text: string, name: string, canonical: string, nativeHeader?: string) {
  const lines = text.split('\n')
  expect(lines[0]).toBe(`# ${name}`)
  expect(lines.filter((line) => line.startsWith('- **Module:**'))).toEqual(['- **Module:** io.github.libtmux'])
  expect(lines.filter((line) => line.startsWith('- **Page:**'))).toEqual([`- **Page:** ${canonical}`])
  if (nativeHeader !== undefined) {
    expect(fromMarkdown(text).children.find((node) => node.type === 'code')?.value).toBe(nativeHeader)
  }
}

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
  for (const [id, name, slug] of [
    ['io.github.libtmux.Server.Server', 'io.github.libtmux.Server', 'io-github-libtmux-server-server'],
    ['io.github.libtmux.Server.Server.Builder', 'io.github.libtmux.Server.Builder', 'io-github-libtmux-server-server-builder-dv7l'],
    ['io.github.libtmux.Server.Server.sessions', 'io.github.libtmux.Server.sessions', 'io-github-libtmux-server-server-sessions'],
  ]) {
    it(`uses the source name of ${name} and retains its existing page URL`, () => {
      const model = API_MODELS.java
      const symbol = model.symbols.find((entry) => entry.id === id)!
      expect(symbol).toBeDefined()
      expect(symbol.slug).toBe(slug)
      const canonical = `https://libtmux.org/en/java/latest/reference/${symbol.slug}/`
      const text = symbolMarkdown({ model, symbol, canonical })
      const rawHeaders = symbol.signatures.map((signature) => {
        expect(signature.raw).toBeTypeOf('string')
        return signature.raw
      })
      // The synchronous export retains source headers; production prepares their layout separately.
      expectJavaExport(text, name, canonical, rawHeaders.length ? rawHeaders.join('\n\n') : undefined)
      expect(symbol.id).toBe(id)
    })
  }

  const model = API_MODELS.java
  const sessions = model.symbols.find((symbol) => symbol.id === 'io.github.libtmux.Server.Server.sessions')!
  const name = 'io.github.libtmux.Server.sessions'
  const canonical = 'https://libtmux.org/en/java/latest/reference/io-github-libtmux-server-server-sessions/'
  const rawHeaders = sessions.signatures.map((signature) => signature.raw!)
  const nativeHeader = rawHeaders.join('\n\n')

  for (const [label, before, after] of [
    ['unqualified title', `# ${name}\n`, '# sessions\n'],
    ['unqualified module', '- **Module:** io.github.libtmux\n', '- **Module:** libtmux\n'],
    ['changed canonical route', `- **Page:** ${canonical}\n`, '- **Page:** https://libtmux.org/en/java/latest/reference/server-sessions/\n'],
    ['duplicate module', '- **Module:** io.github.libtmux\n', '- **Module:** io.github.libtmux\n- **Module:** wrong\n'],
    ['wrong native method name', ' sessions(', ' windows('],
    ['fabricated qualified method header', ' sessions(', ` ${name}(`],
    ['missing native modifier', 'public List<Session>', 'List<Session>'],
    ['missing native annotation', '@ReadOnly\n', ''],
    ['changed native return type', 'public List<Session>', 'public List<Window>'],
    ['missing overload', nativeHeader, rawHeaders[0]],
    ['reordered overloads', nativeHeader, [...rawHeaders].reverse().join('\n\n')],
  ]) {
    it(`rejects ${label} even when the correct declaration appears later`, () => {
      const text = symbolMarkdown({ model, symbol: sessions, canonical })
      const changed = text.replace(before, after)
      expect(changed).not.toBe(text)
      const decoy = `\nCorrect page: ${name}, io.github.libtmux, ${canonical}\n\n\`\`\`java\n${nativeHeader}\n\`\`\`\n`
      expect(() => expectJavaExport(changed + decoy, name, canonical, nativeHeader))
        .toThrow(expect.objectContaining({ name: 'AssertionError' }))
    })
  }
})
