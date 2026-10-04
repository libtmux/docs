import { describe, expect, it } from 'vitest'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { builtinHref, tokenizeDoc, type ApiSymbol } from '@libtmux/api-model'
import { API_MODELS, createApiIndex } from '../src/lib/api-models'
import { apiCommandFacts, parameterBindingFacts, parameterBindingText } from '../src/lib/api-sections'
import { apiGlossaryHref } from '../src/lib/api-glossary'
import { symbolMarkdown } from '../src/lib/symbol-markdown'

const model = API_MODELS.powershell
const command = (name: string) => model.symbols.find((symbol) => symbol.name === name)!
const hrefFor = (symbol: ApiSymbol) => `/en/powershell/latest/reference/${symbol.slug}/`
const index = createApiIndex(model, hrefFor)
const refs = (text: string, owner: ApiSymbol) => index.linkText(text, owner).filter((span) => span.kind === 'ref')

describe('PowerShell native help references', () => {
  it('links plain result types and declared parameters without linking unknown names', () => {
    const owner = command('Invoke-TmuxCommand')
    const result = refs(
      'TmuxCommandResult returns objects. WhatIf performs no dispatch. ErrorAction Stop handles errors. MissingType stays plain.',
      owner,
    )
    expect(result.map((span) => span.target)).toEqual(['TmuxCommandResult', 'WhatIf', 'ErrorAction'])
    expect(result[0].link?.href).toContain('/csharp/latest/reference/libtmux-tmuxcommandresult/')
    expect(result[1].link?.href).toBe(`${hrefFor(owner)}#LibTmux%5CInvoke-TmuxCommand.parameter.WhatIf`)
    expect(result[2].link?.href).toBe(`${hrefFor(owner)}#LibTmux%5CInvoke-TmuxCommand.parameter.ErrorAction`)
    const arrival = new URL(result[1].link!.href, 'https://libtmux.org')
    expect(decodeURIComponent(arrival.hash.slice(1))).toBe('LibTmux\\Invoke-TmuxCommand.parameter.WhatIf')
    expect(refs('WhatIf is not a parameter here.', command('Get-TmuxServer'))).toEqual([])
    expect(refs('WhatIf.', owner)[0].link).toBeDefined()
  })

  it('links an error identifier to its pinned native Notes without inventing a type', () => {
    const owner = command('Get-TmuxServer')
    const result = refs(owner.doc!.body!, owner).find((span) => span.target === 'Tmux.ServerInspectionFailed')!
    expect(result.link?.href).toBe(`${owner.doc!.examples![0].sourceUrl}#notes`)
    expect(result.link?.href).toContain(`/blob/${owner.source.extractedRevision}/`)
    expect(result.link?.symbol).toBeUndefined()
    expect(index.resolve('Tmux.MadeUpFailure', 'any', owner)).toBeUndefined()
    expect(index.resolve('Tmux.ServerInspectionFailed', 'any', command('Invoke-TmuxCommand'))).toBeUndefined()
  })

  it('preserves author links and code while resolving known prose references', () => {
    const owner = command('Invoke-TmuxCommand')
    const result = index.linkText('[WhatIf](https://example.com/explanation) and `TmuxCommandResult`', owner)
    expect(result.filter((span) => span.kind === 'link')).toEqual([
      { kind: 'link', text: 'WhatIf', href: 'https://example.com/explanation' },
    ])
    expect(result.find((span) => span.kind === 'ref')?.link?.href).toContain(
      '/csharp/latest/reference/libtmux-tmuxcommandresult/',
    )
  })

  it('links validation through its reflected full type and preserves unknown custom attributes', () => {
    const parameter = structuredClone(
      command('Get-TmuxServer').signatures[0].params.find((param) => param.name === 'Server')!,
    )
    const target = builtinHref('powershell', 'System.Management.Automation.ValidateNotNullAttribute')!
    expect(parameterBindingFacts(parameter)).toContainEqual({
      label: 'Validation',
      value: '[`ValidateNotNull()`](' + target + ')',
    })
    expect(parameterBindingText(parameter)).toContain('[`ValidateNotNull()`](' + target + ')')
    parameter.binding!.attributes = [{ type: 'Custom.ValidateNotNullAttribute', arguments: [], namedArguments: {} }]
    expect(parameterBindingFacts(parameter)).toContainEqual({ label: 'Validation', value: '`ValidateNotNull()`' })
  })

  it('renders the real validation arguments as one linked code label, including bracketed regexes and sets', () => {
    let count = 0
    for (const owner of model.symbols)
      for (const signature of owner.signatures)
        for (const parameter of signature.params) {
          for (const fact of parameterBindingFacts(parameter).filter(
            (fact) => fact.label === 'Validation' || fact.label === 'Completion',
          )) {
            const spans = index.linkText(fact.value, owner)
            expect(spans, `${owner.name} ${parameter.name} ${fact.value}`).toHaveLength(1)
            expect(spans[0]).toMatchObject({ kind: 'link', code: true })
            count++
          }
        }
    expect(count).toBeGreaterThan(100)
    const parameter = structuredClone(
      command('Get-TmuxServer').signatures[0].params.find((param) => param.name === 'Server')!,
    )
    parameter.binding!.attributes = [
      { type: 'System.Management.Automation.ValidatePatternAttribute', arguments: ['[`]'], namedArguments: {} },
    ]
    const fact = parameterBindingFacts(parameter).find((fact) => fact.label === 'Validation')!
    expect(index.linkText(fact.value)[0]).toMatchObject({ kind: 'link', code: true, text: 'ValidatePattern("[`]")' })
  })

  it('links the command-kind label to the glossary, and rejects unsafe Markdown destinations', () => {
    const owner = command('Get-TmuxServer')
    const kind = apiCommandFacts(owner).find((fact) => fact.label === 'Command type')!
    expect(index.linkText(kind.value, owner)).toEqual([
      { kind: 'link', text: 'cmdlet', code: true, href: apiGlossaryHref('cmdlet') },
    ])
    expect(tokenizeDoc('[Run](javascript:alert)', 'powershell').some((span) => span.kind === 'link')).toBe(false)
    expect(tokenizeDoc('[Go](//unverified.example)', 'powershell').some((span) => span.kind === 'link')).toBe(false)
  })

  it('copies the same links into Markdown without changing example code', () => {
    const owner = command('Invoke-TmuxCommand')
    const text = symbolMarkdown({ model, symbol: owner, index })
    expect(text).toContain('[`TmuxCommandResult`](')
    expect(text).toContain('[`WhatIf`](' + hrefFor(owner) + '#LibTmux%5CInvoke-TmuxCommand.parameter.WhatIf)')
    const blocks = fromMarkdown(text)
      .children.filter((node) => node.type === 'code')
      .map((node) => node.value)
    for (const example of owner.doc!.examples!) expect(blocks).toContain(example.code.trimEnd())
    const server = symbolMarkdown({ model, symbol: command('Get-TmuxServer'), index })
    expect(server).toContain('[`Tmux.ServerInspectionFailed`](https://github.com/')
    expect(server).toContain('[`ValidateNotNull()`](https://learn.microsoft.com/')
  })
})
