import { readFileSync } from 'node:fs'
import { experimental_AstroContainer } from 'astro/container'
import { Window } from 'happy-dom'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { describe, expect, it } from 'vitest'
import type { ApiSymbol } from '@libtmux/api-model'
import { API_MODELS, createApiIndex } from '../src/lib/api-models'
import { nativeSignatureText } from '../src/lib/api-sections'
import { apiSignatureLayouts, CODE_COLUMNS, codeWidthFailures, signatureSpans, supportsPowerShellSignatures } from '../src/lib/code-layout'
import { formatSyntax, powershellGroups } from '../src/lib/powershell-code-layout'
import { symbolMarkdownWithLayout } from '../src/lib/symbol-markdown'
import { displayedSignature, signatureComponent } from './signature-component'

interface Native {
  tools: { powershell: string; platyPS: string; 'Microsoft.PowerShell.PlatyPS': string }
  commands: { name: string; syntax: string[]; platyps014: string[]; platyps103: string[]; getHelp60: string }[]
}
const native = JSON.parse(readFileSync(new URL('./fixtures/powershell-native-syntax.json', import.meta.url), 'utf8')) as Native
const model = API_MODELS.powershell
const index = createApiIndex(model, (symbol) => `/en/powershell/latest/reference/${symbol.slug}/`)
const find = (name: string): ApiSymbol => model.symbols.find((symbol) => symbol.name === name)!
const layoutOf = async (symbol: ApiSymbol, at = 0) => (await apiSignatureLayouts(symbol, 'powershell')).get(symbol.signatures[at]!)!

async function withWidth<T>(width: number, run: () => Promise<T>): Promise<T> {
  const original = CODE_COLUMNS.api
  try {
    Object.assign(CODE_COLUMNS, { api: width })
    return await run()
  } finally { Object.assign(CODE_COLUMNS, { api: original }) }
}

describe('native PowerShell syntax', () => {
  it('records the tools that produced the fixtures', () => {
    expect(native.tools).toMatchObject({ powershell: '7.6.6', platyPS: '0.14.2', 'Microsoft.PowerShell.PlatyPS': '1.0.3' })
    expect(native.commands.length).toBeGreaterThan(40)
  })

  it('wraps platyPS markdown only between the groups this layout keeps whole', () => {
    for (const command of native.commands) for (const block of [...command.platyps014, ...command.platyps103]) {
      const lines = block.split('\n')
      const { name, groups } = powershellGroups(lines.join(' '))
      const sequence = [name, ...groups]
      // Each native line holds whole items of the sequence, in order.
      let at = 0
      for (const [number, line] of lines.entries()) {
        const taken: string[] = []
        while (at < sequence.length && taken.join(' ').length < line.trim().length) taken.push(sequence[at++]!)
        expect(taken.join(' '), `${command.name} line ${number + 1}`).toBe(line.trim())
      }
      expect(at, command.name).toBe(sequence.length)
      // platyPS indents every continuation by one space and never splits a group.
      expect(lines.slice(1).every((line) => /^ \S/.test(line)), command.name).toBe(true)
    }
  })

  it('indents narrow Get-Help blocks four spaces and cuts through names and types', () => {
    const lines = native.commands.flatMap((command) => command.getHelp60.split('\n')).filter(Boolean)
    expect(lines.every((line) => /^ {4}/.test(line))).toBe(true)
    const cut = lines.filter((line) => (line.match(/[[<]/g)?.length ?? 0) !== (line.match(/[\]>]/g)?.length ?? 0))
    expect(cut.length).toBeGreaterThan(10)
    // A wrapped line can start mid-word, which no layout of this site may print.
    expect(lines.some((line) => /^ {4}(?:ndowName|g\[\]>)/.test(line))).toBe(true)
  })

  it('keeps every Get-Command syntax whole and flat when it fits', async () => {
    const lengths = new Set<number>()
    for (const command of native.commands) for (const syntax of command.syntax) {
      const layout = await formatSyntax(syntax)
      expect(layout.text.replace(/\s+/g, ' '), command.name).toBe(syntax)
      expect(layout.failures, command.name).toEqual(await codeWidthFailures(layout.text, 'api'))
      expect(layout.text.includes('\n'), command.name).toBe(syntax.length > CODE_COLUMNS.api)
      lengths.add(layout.text.split('\n').length)
    }
    expect(lengths.size).toBeGreaterThan(2)
  })

  it.each([40, 60, 80, 100])('keeps native syntax intact and inside %i columns', async (width) => {
    await withWidth(width, async () => {
      for (const command of native.commands) for (const syntax of command.syntax) {
        const layout = await formatSyntax(syntax)
        expect(layout.text.replace(/\s+/g, ' '), command.name).toBe(syntax)
        const wide = layout.text.split('\n').filter((line) => line.length > width)
        expect(layout.failures.length, command.name).toBe(wide.length)
        // A line may exceed the budget only where a group cannot break any further.
        for (const line of wide) expect(line.trim().split(/\s+/).length, `${command.name}: ${line}`).toBe(1)
      }
    })
  })
})

describe('PowerShell layout', () => {
  it('puts each group on its own line once the syntax no longer fits', async () => {
    const layout = await formatSyntax('Invoke-TmuxCommand [-Server] <LibTmux.Server> [-Arguments] <System.String[]> [-WhatIf] [-Confirm] [<CommonParameters>]')
    expect(layout.text).toBe(`Invoke-TmuxCommand
    [-Server] <LibTmux.Server>
    [-Arguments] <System.String[]>
    [-WhatIf]
    [-Confirm]
    [<CommonParameters>]`)
    expect(layout.failures).toEqual([])
    expect((await formatSyntax('Update-TmuxPane [-Pane] <LibTmux.Pane> [<CommonParameters>]')).text)
      .toBe('Update-TmuxPane [-Pane] <LibTmux.Pane> [<CommonParameters>]')
  })

  it('splits a group between its name and type only when the group is wider than its line', async () => {
    const layout = await formatSyntax('Get-TmuxWorkspacePlan -Server <LibTmux.Server> [-ExistingSession <LibTmux.Workspace.WorkspaceExistingSession>] [[-Path] <System.String>]')
    expect(layout.text).toBe(`Get-TmuxWorkspacePlan
    -Server <LibTmux.Server>
    [-ExistingSession
        <LibTmux.Workspace.WorkspaceExistingSession>]
    [[-Path] <System.String>]`)
    expect(layout.failures).toEqual([])
  })

  it('keeps an indivisible token whole and records the overflow', async () => {
    const type = `<${'LibTmux.Workspace.'.repeat(4)}Type>`
    const layout = await formatSyntax(`Get-Thing [-Value ${type}]`)
    expect(layout.text).toContain(type)
    expect(layout.failures).toEqual(await codeWidthFailures(layout.text, 'api'))
    expect(layout.failures.length).toBe(1)
  })

  it.each([
    ['Get-Thing [-Value <Broken', /Unbalanced/],
    ['', /Empty/],
  ])('rejects the syntax %j', async (raw, message) => {
    await expect(formatSyntax(raw)).rejects.toThrow(message)
  })

  it('lays out every command in the extracted model within the budget', async () => {
    let signatures = 0
    let flat = 0
    let split = 0
    let wide = 0
    for (const symbol of model.symbols.filter((entry) => supportsPowerShellSignatures(entry, 'powershell'))) {
      const layouts = await apiSignatureLayouts(symbol, 'powershell')
      expect([...layouts.keys()], symbol.id).toEqual(symbol.signatures)
      for (const signature of symbol.signatures) {
        const layout = layouts.get(signature)!
        signatures++
        // A group wider than the budget less its indent cannot share a line with the indent.
        wide += powershellGroups(signature.raw!).groups.filter((group) => group.length > CODE_COLUMNS.api - 4).length
        if (!layout.text.includes('\n')) flat++
        expect(layout.text.replace(/\s+/g, ' '), symbol.id).toBe(signature.raw!.replace(/\s+/g, ' '))
        expect(layout.text.split('\n')[0]!.split(' ')[0], symbol.id).toBe(symbol.name)
        expect(layout.limit).toBe(60)
        expect(layout.failures, symbol.id).toEqual(await codeWidthFailures(layout.text, 'api'))
        for (const line of layout.text.split('\n').slice(1)) {
          if (/^ {8}\S/.test(line)) split++
          else expect(line, symbol.id).toMatch(/^ {4}\S/)
        }
      }
    }
    expect(signatures).toBeGreaterThan(100)
    expect(flat).toBeGreaterThan(0)
    // Only a group wider than its line breaks inside.
    expect(split).toBe(wide)
    expect(wide).toBeGreaterThan(0)
  })

  it('formats nothing without source syntax', () => {
    expect(supportsPowerShellSignatures({ ...find('Invoke-TmuxCommand'), signatures: [{ params: [] }] }, 'powershell')).toBe(false)
    expect(supportsPowerShellSignatures(find('Invoke-TmuxCommand'), 'csharp')).toBe(false)
    expect(model.symbols.filter((symbol) => symbol.kind === 'module').some((symbol) => supportsPowerShellSignatures(symbol, 'powershell'))).toBe(false)
  })
})

describe('PowerShell links, roles and exports', () => {
  it('links the same names, types and parameters as the unwrapped syntax', async () => {
    for (const symbol of model.symbols.filter((entry) => entry.signatures.length)) for (const signature of symbol.signatures) {
      const layout = (await apiSignatureLayouts(symbol, 'powershell')).get(signature)!
      const spans = signatureSpans(layout, index, symbol, signature)
      expect(spans.map((span) => span.text).join(''), symbol.id).toBe(layout.text)
      const links = (value: { link?: { href: string } | undefined; text: string }[]) => value.filter((span) => span.link).map((span) => [span.text, span.link!.href])
      expect(links(spans), symbol.id).toEqual(links(index.linkType(signature.raw!, symbol, signature)))
      expect(spans.filter((span) => span.declarationName).map((span) => span.text), symbol.id).toEqual([symbol.name])
    }
    const invoke = find('Invoke-TmuxCommand')
    const spans = signatureSpans(await layoutOf(invoke), index, invoke, invoke.signatures[0]!)
    expect(spans.find((span) => span.text === 'Arguments')?.link?.href).toContain('.parameter.Arguments')
    expect(spans.find((span) => span.text === 'CommonParameters')?.link?.href).toContain('learn.microsoft.com')
    // .NET types resolve to the C# reference, as they do without a layout.
    expect(spans.find((span) => span.text === 'LibTmux.Server')?.link?.href).toBe('/en/csharp/latest/reference/libtmux-server/'.replace('/en', ''))
  })

  it('keeps links across a split group', async () => {
    const plan = find('Get-TmuxWorkspacePlan')
    const signature = plan.signatures[0]!
    const layout = await layoutOf(plan)
    expect(layout.text).toContain('[-ExistingSession\n        <LibTmux.Workspace.WorkspaceExistingSession>]')
    const spans = signatureSpans(layout, index, plan, signature)
    expect(spans.find((span) => span.text === 'ExistingSession')?.link?.href).toContain('.parameter.ExistingSession')
    expect(spans.some((span) => span.text.includes('LibTmux.Workspace.WorkspaceExistingSession'))).toBe(true)
  })

  it('exports each parameter set with its label and the shared text', async () => {
    const environment = find('Get-TmuxEnvironment')
    expect(environment.signatures.length).toBeGreaterThan(1)
    const layouts = await apiSignatureLayouts(environment, 'powershell')
    const markdown = await symbolMarkdownWithLayout({ model, symbol: environment, index })
    const code = fromMarkdown(markdown).children.find((node) => node.type === 'code')
    expect(code?.type === 'code' && code.value).toBe(environment.signatures.map((signature) =>
      `${signature.label}${signature.isDefault ? ' (default)' : ''}:\n${layouts.get(signature)!.text}`).join('\n\n'))
  })

  it.each(['Invoke-TmuxCommand', 'Get-TmuxEnvironment', 'Get-TmuxWorkspacePlan'])('renders %s as the exported text with its parameter set labels', async (name) => {
    const symbol = find(name)
    const signatureLayouts = await apiSignatureLayouts(symbol, 'powershell')
    const container = await experimental_AstroContainer.create()
    const win = new Window()
    try {
      const component = await signatureComponent()
      win.document.body.innerHTML = (await Promise.all(symbol.signatures.map((sig) => container.renderToString(component, {
        props: { symbol, sig, port: 'powershell', language: 'powershell', index, signatureLayouts, nativeSignatureText },
      })))).join('')
      const declarations = [...win.document.querySelectorAll('.api-native-signature')]
      expect(declarations.map((element) => element.classList.contains('api-native-signature--formatted'))).toEqual(symbol.signatures.map(() => true))
      expect(declarations.map((element) => element.getAttribute('data-code-width-status'))).toEqual(symbol.signatures.map(() => 'fits'))
      expect(declarations.map((element) => element.getAttribute('data-code-columns'))).toEqual(symbol.signatures.map(() => '60'))
      expect(declarations.map(displayedSignature)).toEqual(symbol.signatures.map((signature) =>
        `${signature.label && signature.label !== '__AllParameterSets' ? `${signature.label}${signature.isDefault ? ' (default)' : ''}: ` : ''}${signatureLayouts.get(signature)!.text}`))
      expect(win.document.querySelector('a a')).toBeNull()
      const parameters = [...win.document.querySelectorAll('a.api-parameter-name')].map((link) => link.textContent)
      expect(parameters).toEqual(symbol.signatures.flatMap((signature) =>
        signature.params.filter((param) => signature.raw!.includes(`-${param.name}`)).map((param) => param.name)))
    } finally { await win.happyDOM.abort() }
  })
})
