import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractPowerShell, powerShellType } from '../src/languages/powershell.ts'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/powershell-native.json', import.meta.url), 'utf8'))
const model = extractPowerShell(fixture, fixture.source.revision)
const command = (name: string) => model.symbols.find((symbol) => symbol.name === name)!

describe('PowerShell native command adapter', () => {
  it('preserves both module inventories without publishing implementation classes', () => {
    expect(model.symbols.filter((symbol) => symbol.kind === 'function')).toHaveLength(6)
    expect(model.sources?.map((source) => [source.package, source.product])).toEqual([
      ['LibTmux', 'core'], ['LibTmux.Workspace', 'workspace'],
    ])
    expect(model.symbols.every((symbol) => !symbol.id.includes('PowerShell.Commands'))).toBe(true)
    expect(command('Get-TmuxWorkspace')).toMatchObject({ package: 'LibTmux.Workspace', product: 'workspace' })
  })

  it('keeps each owner-specific set and its pipeline binding', () => {
    const pane = command('Get-TmuxPane')
    expect(pane.signatures.map((signature) => signature.label)).toEqual(['Server', 'Session', 'Window'])
    for (const signature of pane.signatures) {
      const owner = signature.params.find((param) => param.name === signature.label)!
      expect(owner.binding).toMatchObject({ mandatory: true, position: 0, pipeline: { byValue: true, byPropertyName: false } })
      expect(signature.raw).toContain(`[<CommonParameters>]`)
      expect(signature.returns).toBe('LibTmux.Pane')
    }
  })

  it('preserves defaults, validation, common parameters and ShouldProcess', () => {
    const control = command('Connect-TmuxControl')
    expect(control.command).toMatchObject({ kind: 'cmdlet', supportsShouldProcess: true })
    expect(control.signatures[0]!.params.map((parameter) => parameter.name)).toContain('WhatIf')
    expect(control.signatures[0]!.params.find((parameter) => parameter.name === 'ErrorAction')?.binding?.common).toBe(true)
    const timeout = command('Invoke-TmuxPaneCommand').signatures[0]!.params.find((parameter) => parameter.name === 'Timeout')!
    expect(timeout.default).toBe('30')
    const id = command('Get-TmuxPane').signatures[0]!.params.find((parameter) => parameter.name === 'Id')!
    expect(id.binding?.attributes.some((attribute) => attribute.type.endsWith('ValidateNotNullOrEmptyAttribute'))).toBe(true)
    expect(command('New-TmuxServer').signatures[0]!.params.find((parameter) => parameter.name === 'TmuxBinaryPath')?.binding?.declaration?.initializer).toBe('"tmux"')
  })

  it('describes engine-supplied common parameters without replacing authored help', () => {
    const common = command('Connect-TmuxControl').signatures[0]!.params.filter((param) => param.binding?.common)
    expect(common).toHaveLength(12)
    expect(common.every((param) => Boolean(param.doc?.trim()))).toBe(true)
    expect(common.find((param) => param.name === 'Verbose')?.doc).toMatch(/verbose messages/)
    expect(common.find((param) => param.name === 'ErrorAction')?.doc).toMatch(/non-terminating errors/)

    const authored = structuredClone(fixture)
    const parameters = authored.commands[0].parameterSets[0].parameters
    parameters.find((param: { name: string }) => param.name === 'Verbose').description = 'Authored verbose behavior.'
    const normalized = extractPowerShell(authored).symbols.find((symbol) => symbol.id === authored.commands[0].id)!
    expect(normalized.signatures[0]!.params.find((param) => param.name === 'Verbose')?.doc).toBe('Authored verbose behavior.')
    parameters.find((param: { name: string }) => param.name === 'Verbose').description = ''
    parameters.find((param: { name: string }) => param.name === 'Verbose').common = false
    expect(extractPowerShell(authored).symbols.find((symbol) => symbol.id === authored.commands[0].id)!
      .signatures[0]!.params.find((param) => param.name === 'Verbose')?.doc).toBeUndefined()
  })

  it('keeps executable example code, following prose, errors and source provenance', () => {
    const control = command('Connect-TmuxControl')
    expect(control.doc?.examples?.[0]?.code).toContain('Connect-TmuxControl')
    expect(control.doc?.examples?.[0]?.intro).not.toContain('```')
    expect(control.doc?.body).toContain('Tmux.ControlConnectFailed')
    expect(command('Invoke-TmuxPaneCommand').doc?.examples?.[0]?.outro).toContain('ExitStatus')
    expect(control.source.revision).toBe(fixture.source.revision)
    expect(model.nativeProvenance?.files.some((file) => file.path === 'eng/Build.ps1')).toBe(true)
  })

  it('renders nested reflected generic and array types without assembly metadata', () => {
    expect(powerShellType('System.Collections.Generic.Dictionary`2[[System.String, System.Private.CoreLib, Version=8.0.0.0],[System.Collections.Generic.List`1[[LibTmux.Pane, LibTmux, Version=0.0.0.0]], System.Private.CoreLib]][]'))
      .toBe('System.Collections.Generic.Dictionary[System.String, System.Collections.Generic.List[LibTmux.Pane]][]')
    expect(powerShellType('System.String[]')).toBe('System.String[]')
  })

  it('rejects stale revisions, missing commands, duplicate sets and missing examples', () => {
    expect(() => extractPowerShell(fixture, '0'.repeat(40))).toThrow(/source revision/)
    const missing = structuredClone(fixture)
    missing.commands.pop()
    expect(() => extractPowerShell(missing)).toThrow(/inventory differs/)
    const duplicate = structuredClone(fixture)
    duplicate.commands[0].parameterSets.push(duplicate.commands[0].parameterSets[0])
    expect(() => extractPowerShell(duplicate)).toThrow(/distinct parameter sets/)
    const example = structuredClone(fixture)
    example.commands[0].examples[0].code = ''
    expect(() => extractPowerShell(example)).toThrow(/example code/)
  })
})
