import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CONCEPTS, conceptsFor } from '../src/concepts.ts'
import type { ApiModel } from '../src/model.ts'
import { API_MODEL_PORTS } from '../../../site/src/lib/ports.ts'

/**
 * The concept map is hand-maintained, so this is what keeps it true.
 *
 * Every id it names is resolved against the extracted model for that port. A
 * rename upstream fails here rather than silently rendering an "in other
 * languages" block with a dead link in it — which is the failure mode of
 * every hand-maintained mapping that nothing checks.
 */
const here = dirname(fileURLToPath(import.meta.url))
const DATA = join(here, '../../../site/src/data/api')
const PORTS = API_MODEL_PORTS.map((port) => port.slug)

const models = new Map<string, ApiModel>()
for (const port of PORTS) {
  const path = join(DATA, `${port}.json`)
  if (existsSync(path)) models.set(port, JSON.parse(readFileSync(path, 'utf8')) as ApiModel)
}

describe('concept map', () => {
  it.runIf(models.size)('workspace concepts stay within the workspace product', () => {
    for (const id of ['workspace-description', 'build-workspace', 'freeze-workspace']) {
      for (const [port, publicId] of Object.entries(CONCEPTS[id].symbols)) {
        const model = models.get(port)
        if (!model) continue
        const symbol = model.symbols.find((entry) => (entry.publicId ?? entry.id) === publicId)
        expect(symbol?.product, `${id} ${port}: ${publicId}`).toBe('workspace')
      }
    }
  })

  it.runIf(models.size)('applies reviewed PowerShell workspace plans with native confirmation', () => {
    const concept = CONCEPTS['build-workspace']
    const id = 'LibTmux.Workspace\\Invoke-TmuxWorkspace'
    expect(concept.symbols.powershell).toBe(id)
    const symbol = models.get('powershell')!.symbols.find((entry) => entry.id === id)!
    expect(symbol.product).toBe('workspace')
    expect(symbol.command).toMatchObject({
      kind: 'cmdlet',
      supportsShouldProcess: true,
      confirmImpact: 'High',
      outputTypes: ['LibTmux.Workspace.WorkspaceResult'],
    })
    expect(symbol.signatures[0].params.find((param) => param.name === 'Plan')).toMatchObject({
      type: 'LibTmux.Workspace.WorkspacePlan',
      binding: { mandatory: true, pipeline: { byValue: true } },
    })
    expect(conceptsFor('powershell', id)).toContain(concept)
    expect(conceptsFor('powershell', 'LibTmux.Workspace\\Get-TmuxWorkspacePlan')).not.toContain(concept)
    expect(concept.notes?.powershell).toContain('`-WhatIf`')
    expect(concept.absent?.powershell).toBeUndefined()
  })

  it.runIf(models.size)('applies prepared Julia workspace plans on an explicit server', () => {
    const concept = CONCEPTS['build-workspace']
    const id = 'LibTmuxWorkspace.apply'
    expect(concept.symbols.julia).toBe(id)
    const symbol = models.get('julia')!.symbols.find((entry) => entry.id === id)!
    expect(symbol).toMatchObject({ product: 'workspace', kind: 'function' })
    expect(symbol.signatures[0].params.slice(0, 2)).toMatchObject([
      { name: 'server', type: 'LibTmux.Server' },
      { name: 'prepared', type: 'LibTmuxWorkspace.WorkspacePlan' },
    ])
    expect(symbol.signatures[0].params.find((param) => param.name === 'reuse')?.default).toBe('nothing')
    expect(conceptsFor('julia', id)).toContain(concept)
    expect(conceptsFor('julia', 'LibTmuxWorkspace.plan')).not.toContain(concept)
    expect(concept.notes?.julia).toContain('prepared `WorkspacePlan`')
    expect(concept.absent?.julia).toBeUndefined()
  })

  it.runIf(models.size)('live workspace export takes a session rather than a description', () => {
    for (const [port, publicId] of Object.entries(CONCEPTS['freeze-workspace'].symbols)) {
      const model = models.get(port)
      if (!model) continue
      const symbol = model.symbols.find((entry) => (entry.publicId ?? entry.id) === publicId)
      expect(
        symbol?.signatures.some((signature) =>
          signature.params.some((parameter) => /\bSession\b/.test(parameter.type ?? '')),
        ),
        `${port}: ${publicId}`,
      ).toBe(true)
    }
    expect(CONCEPTS['freeze-workspace'].symbols.swift).toBeUndefined()
  })

  it('keeps scoped listings separate from server-wide listings', () => {
    expect(CONCEPTS['list-windows'].symbols.swift).toBe('Snapshot.windows(of:)')
    expect(CONCEPTS['list-panes'].symbols.swift).toBe('Snapshot.panes(of:)')
    expect(CONCEPTS['list-server-windows']?.symbols.swift).toBe('Server.windows()')
    expect(CONCEPTS['list-server-panes']?.symbols.swift).toBe('Server.panes()')
    expect(CONCEPTS['list-sessions'].symbols.fsharp).toBe('LibTmux.FSharp.Server.sessions')
    expect(CONCEPTS['list-clients'].symbols.fsharp).toBe('LibTmux.FSharp.Server.clients')
    expect(CONCEPTS['list-server-windows'].symbols.fsharp).toBe('LibTmux.FSharp.Server.windows')
    expect(CONCEPTS['list-server-panes'].symbols.fsharp).toBe('LibTmux.FSharp.Server.panes')
    expect(CONCEPTS['list-windows'].symbols.fsharp).toBe('LibTmux.FSharp.Session.windows')
    expect(CONCEPTS['list-panes'].symbols.fsharp).toBe('LibTmux.FSharp.Window.panes')
    expect(CONCEPTS['list-session-panes'].symbols.fsharp).toBe('LibTmux.FSharp.Session.panes')
  })

  it.runIf(models.size)('preserves native server representations instead of fabricating facade classes', () => {
    const expected = [
      ['powershell', 'LibTmux\\New-TmuxServer', 'function'],
      ['julia', 'LibTmux.Server', 'struct'],
      ['fsharp', 'LibTmux.FSharp.Server', 'module'],
    ]
    for (const [port, id, kind] of expected) {
      const symbol = models.get(port)!.symbols.find((symbol) => (symbol.publicId ?? symbol.id) === id)!
      expect(CONCEPTS.server.symbols[port]).toBe(id)
      expect(symbol.kind).toBe(kind)
      expect(conceptsFor(port, id)).toContain(CONCEPTS.server)
    }
    const cmdlet = models.get('powershell')!.symbols.find((symbol) => symbol.name === 'New-TmuxServer')!
    expect(cmdlet.command?.kind).toBe('cmdlet')
    expect(cmdlet.command?.outputTypes).toContain('LibTmux.Server')
    expect(CONCEPTS.server.notes?.powershell).toContain('without contacting tmux')
    expect(CONCEPTS.server.notes?.fsharp).toContain('shared .NET `LibTmux.Server`')
  })

  it.runIf(models.size)('keeps Julia references distinct from captured entities and validates receiver scopes', () => {
    const model = models.get('julia')!
    for (const name of ['Session', 'Window', 'Pane']) {
      const concept = CONCEPTS[name.toLowerCase()]
      expect(concept.symbols.julia).toBe(`LibTmux.${name}Snapshot`)
      expect(concept.variants?.julia).toContain(`LibTmux.${name}Ref`)
      expect(conceptsFor('julia', `LibTmux.${name}Ref`)).toContain(concept)
    }
    const windows = model.symbols.find((symbol) => symbol.id === CONCEPTS['list-windows'].symbols.julia)!
    expect(windows.signatures.some((signature) => signature.raw?.includes('parent::LibTmux.SessionSnapshot'))).toBe(
      true,
    )
    expect(windows.signatures.some((signature) => signature.raw?.includes('snap::LibTmux.Snapshot'))).toBe(true)
    const panes = model.symbols.find((symbol) => symbol.id === CONCEPTS['list-panes'].symbols.julia)!
    expect(panes.signatures.some((signature) => signature.raw?.includes('win::LibTmux.WindowSnapshot'))).toBe(true)
    expect(CONCEPTS['list-session-panes'].symbols.julia).toBeUndefined()
    expect(CONCEPTS['list-session-panes'].absent?.julia).toContain('Traverse')
    expect(CONCEPTS.snapshot.label).not.toMatch(/instant|atomic/)
    expect(CONCEPTS.snapshot.notes?.julia).toContain('not make it a transaction')
  })

  it.runIf(models.size)('maps PowerShell listing scopes to declared parameter sets', () => {
    const model = models.get('powershell')!
    for (const [concept, receiver] of [
      ['list-sessions', 'Server'],
      ['list-server-windows', 'Server'],
      ['list-windows', 'Session'],
      ['list-server-panes', 'Server'],
      ['list-session-panes', 'Session'],
      ['list-panes', 'Window'],
    ]) {
      const symbol = model.symbols.find((symbol) => symbol.id === CONCEPTS[concept].symbols.powershell)!
      expect(
        symbol.signatures.some((signature) => signature.raw?.includes(`[-${receiver}] <LibTmux.${receiver}>`)),
        concept,
      ).toBe(true)
      expect(CONCEPTS[concept].notes?.powershell, concept).toContain(`\`-${receiver}\``)
    }
  })

  it.runIf(models.size)('distinguishes F# scoped query construction from acquiring results', () => {
    const model = models.get('fsharp')!
    for (const [concept, parent, child] of [
      ['list-windows', 'Session', 'Window'],
      ['list-session-panes', 'Session', 'Pane'],
      ['list-panes', 'Window', 'Pane'],
    ]) {
      const symbol = model.symbols.find((entry) => entry.id === CONCEPTS[concept].symbols.fsharp)!
      expect(symbol.signatures[0].params[0].type).toBe(`LibTmux.${parent}`)
      expect(symbol.signatures[0].returns).toBe(`Query<LibTmux.${child}>`)
      expect(CONCEPTS[concept].notes?.fsharp).toContain('deferred')
      expect(CONCEPTS[concept].notes?.fsharp).toContain('`Query.list` acquires')
      expect(CONCEPTS[concept].notes?.fsharp).not.toMatch(/already captured|missing coverage/)
    }
    const execute = model.symbols.find((entry) => entry.id === 'LibTmux.FSharp.Query.list')!
    expect(execute.signatures[0].returns).toBe("Task<IReadOnlyList<'T>>")
  })

  it('links visible capture to the visible capture overload', () => {
    expect(CONCEPTS['capture-pane'].symbols.swift).toBe('Server.capture(_:includingHistory:)')
    expect(CONCEPTS['capture-pane'].symbols.ruby).toBe('LibTmux::Pane#capture')
    expect(CONCEPTS['capture-pane'].symbols.lua).toBe('libtmux.Pane:capture')
  })

  it('preserves native handle scopes and recognises Cats Effect operations', () => {
    for (const port of ['kotlin', 'scala']) {
      for (const [concept, member] of Object.entries({
        'split-pane': 'Pane.split',
        'split-window': 'Window.split',
        'list-windows': 'Session.windows',
        'list-panes': 'Window.panes',
        'list-server-windows': 'Server.windows',
        'list-server-panes': 'Server.panes',
      })) {
        expect(CONCEPTS[concept].symbols[port]).toBe(
          `io.github.libtmux.${port === 'scala' ? 'scaladsl' : port}.${member}`,
        )
      }
    }
    expect(conceptsFor('scala', 'io.github.libtmux.scaladsl.cats.Server.newSession')).toContain(CONCEPTS['new-session'])
  })

  it('keeps Lua request completion distinct from snapshot capture', () => {
    expect(CONCEPTS.snapshot.symbols.lua).toBe('libtmux.Server:snapshot')
    expect(CONCEPTS.snapshot.symbols.lua).not.toContain('Request')
  })

  it('does not substitute a window target for a pane target', () => {
    expect(CONCEPTS['split-window'].symbols.cxx).toBe('libtmux::Window::split')
    expect(CONCEPTS['split-pane'].symbols.cxx).toBeUndefined()
  })

  it('does not claim that a Swift window has one parent session', () => {
    expect(CONCEPTS['window-session'].symbols.swift).toBeUndefined()
  })

  it.runIf(models.size)('every symbol it names exists', () => {
    const missing: string[] = []
    for (const [id, concept] of Object.entries(CONCEPTS)) {
      for (const [port, publicId] of Object.entries(concept.symbols)) {
        const model = models.get(port)
        if (!model) continue
        for (const target of [publicId, ...(concept.variants?.[port] ?? [])]) {
          const found = model.symbols.some((s) => (s.publicId ?? s.id) === target)
          if (!found) missing.push(`${id} ${port}: ${target}`)
        }
      }
    }
    expect(missing, `concept map names symbols that no longer exist:\n${missing.join('\n')}`).toEqual([])
  })

  it('a port is either mapped or explained, never silently absent', () => {
    for (const [id, concept] of Object.entries(CONCEPTS)) {
      for (const port of PORTS) {
        const has = port in concept.symbols || port in (concept.absent ?? {})
        expect(has, `${id} says nothing about ${port}`).toBe(true)
      }
    }
  })

  it('finds the concepts a symbol belongs to', () => {
    const [concept] = conceptsFor('py', CONCEPTS['capture-pane'].symbols.py)
    expect(concept?.label).toBe(CONCEPTS['capture-pane'].label)
    expect(conceptsFor('py', 'libtmux.NotAThing')).toEqual([])
  })
})
