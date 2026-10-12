import { describe, expect, it } from 'vitest'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { API_MODELS, createApiIndex } from '../src/lib/api-models'
import { nativeSignatureText } from '../src/lib/api-sections'
import { symbolMarkdown } from '../src/lib/symbol-markdown'

const model = API_MODELS.powershell
const index = createApiIndex(model, (symbol) => `/en/powershell/latest/reference/${symbol.slug}/`)
const invoke = model.symbols.find((symbol) => symbol.name === 'Invoke-TmuxCommand')!

describe('PowerShell syntax layout', () => {
  it('puts each parameter and CommonParameters on a separate four-space-indented line', () => {
    const signature = invoke.signatures[0]
    const text = nativeSignatureText(invoke, signature, 'powershell')
    const lines = text.split('\n')
    expect(lines[0]).toBe('Invoke-TmuxCommand')
    expect(lines.slice(1)).toEqual([
      '    [-Server] <LibTmux.Server>',
      '    [-Arguments] <System.String[]>',
      '    [-WhatIf]',
      '    [-Confirm]',
      '    [<CommonParameters>]',
    ])
    expect(nativeSignatureText(invoke, { ...signature, raw: text }, 'powershell')).toBe(text)
  })

  it('preserves every native parameter set and its parameter, type and common-parameter links', () => {
    let count = 0
    for (const symbol of model.symbols)
      for (const signature of symbol.signatures) {
        if (!signature.raw) continue
        const text = nativeSignatureText(symbol, signature, 'powershell')
        expect(text.split('\n')[0], symbol.id).toBe(symbol.name)
        expect(text.replace(/\s+/g, ' '), symbol.id).toBe(signature.raw.replace(/\s+/g, ' '))
        const params = signature.params.filter((parameter) => !parameter.binding?.common)
        const common = signature.params.some((parameter) => parameter.binding?.common) ? 1 : 0
        expect(text.split('\n'), symbol.id).toHaveLength(1 + params.length + common)
        expect(
          text
            .split('\n')
            .slice(1)
            .every((line) => /^ {4}\S/.test(line)),
          symbol.id,
        ).toBe(true)
        const linked = (value: string) =>
          index
            .linkType(value, symbol, signature)
            .filter((span) => span.link)
            .map((span) => ({ text: span.text, href: span.link!.href }))
        expect(linked(text), symbol.id).toEqual(linked(signature.raw))
        count++
      }
    expect(count).toBeGreaterThan(60)
    const links = index
      .linkType(nativeSignatureText(invoke, invoke.signatures[0], 'powershell'), invoke, invoke.signatures[0])
      .filter((span) => span.link)
    expect(links.find((span) => span.text === 'Arguments')?.link?.href).toContain('.parameter.Arguments')
    expect(links.find((span) => span.text === 'CommonParameters')?.link?.href).toContain('learn.microsoft.com')
  })

  it('exports the same multiline syntax to Markdown and leaves other native languages unchanged', () => {
    const text = nativeSignatureText(invoke, invoke.signatures[0], 'powershell')
    const markdown = symbolMarkdown({ model, symbol: invoke, index })
    const code = fromMarkdown(markdown)
      .children.filter((node) => node.type === 'code')
      .map((node) => node.value)
    expect(code).toContain(text)
    for (const language of ['csharp', 'fsharp', 'julia', 'c']) {
      expect(nativeSignatureText(invoke, invoke.signatures[0], language)).toBe(invoke.signatures[0].raw)
    }
  })
})
