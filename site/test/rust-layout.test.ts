import { describe, expect, it } from 'vitest'
import { parserFor, SymbolIndex, type ApiSymbol, type Signature } from '@libtmux/api-model'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { apiSignatureLayouts, CODE_COLUMNS, codeWidthFailures, signatureSpans } from '../src/lib/code-layout'
import { apiEntryFields, usesNativeSignatures } from '../src/lib/api-sections'
import { symbolMarkdownWithLayout } from '../src/lib/symbol-markdown'

const method = (raw: string, params: Signature['params'] = [], name = 'method'): ApiSymbol => ({
  id: `server.Server.${name}`, name, kind: 'method', parent: 'server.Server', modifiers: [],
  signatures: [{ raw, params }], source: { file: 'server.rs' },
})

const layoutFor = async (symbol: ApiSymbol) => {
  const layout = (await apiSignatureLayouts(symbol, 'rs')).get(symbol.signatures[0]!)
  expect(layout).toBeDefined()
  return layout!
}

describe('Rust callable layouts', () => {
  it.fails('wraps a native async hook header at 60 columns with shared Markdown and parameter links', async () => {
    const symbol = method('pub async fn set_hook(&self, name: &str, command: impl Into<OsString>) -> Result<(), Error>', [
      { name: '&self' }, { name: 'name', type: '&str' }, { name: 'command', type: 'impl Into<OsString>' },
    ], 'set_hook')
    const layout = await layoutFor(symbol)
    const expected = 'pub async fn set_hook(\n    &self,\n    name: &str,\n    command: impl Into<OsString>\n) -> Result<(), Error>'
    expect(layout.text).toBe(expected)
    expect(layout.failures).toEqual([])
    expect(layout.limit).toBe(60)
    expect(usesNativeSignatures(symbol, 'rs')).toBe(true)
    const index = new SymbolIndex([symbol], (entry) => `/${entry.id}/`, 'rs')
    const spans = signatureSpans(layout, index, symbol, symbol.signatures[0]!)
    expect(spans.map((span) => span.text).join('')).toBe(expected)
    expect(spans.filter((span) => span.declarationName).map((span) => span.text)).toEqual(['set_hook'])
    expect(spans.filter((span) => span.link?.href.startsWith('#')).map((span) => [span.text, span.link!.href])).toEqual([
      ['&self', '#server.Server.set_hook.parameter.%26self'],
      ['name', '#server.Server.set_hook.parameter.name'],
      ['command', '#server.Server.set_hook.parameter.command'],
    ])
    expect(apiEntryFields(symbol, 'rs').params.map((param) => param.name)).toEqual(['&self', 'name', 'command'])
    const document = await symbolMarkdownWithLayout({ model: { port: 'rs', extractor: 'fixture', symbols: [symbol] }, symbol, index })
    const signature = fromMarkdown(document).children.find((node) => node.type === 'code')
    expect(signature?.type === 'code' && signature.value).toBe(expected)
    expect(CODE_COLUMNS).toEqual({ api: 60, example: 80 })
    expect(await codeWidthFailures(expected, 'api')).toEqual([])
    const parser = await parserFor('rust')
    const input = parser.parse(`${symbol.signatures[0]!.raw} {}`)!
    const output = parser.parse(`${layout.text} {}`)!
    try {
      expect(output.rootNode.hasError).toBe(false)
      expect(output.rootNode.toString()).toBe(input.rootNode.toString())
    } finally { input.delete(); output.delete(); parser.delete() }
  })
})
