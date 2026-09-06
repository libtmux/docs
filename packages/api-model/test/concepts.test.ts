import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CONCEPTS, conceptsFor } from '../src/concepts.ts'
import type { ApiModel } from '../src/model.ts'

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
const PORTS = ['py', 'ts', 'rs', 'go', 'java', 'dotnet', 'cxx', 'swift']

const models = new Map<string, ApiModel>()
for (const port of PORTS) {
  const path = join(DATA, `${port}.json`)
  if (existsSync(path)) models.set(port, JSON.parse(readFileSync(path, 'utf8')) as ApiModel)
}

describe('concept map', () => {
  it('keeps scoped listings separate from server-wide listings', () => {
    expect(CONCEPTS['list-windows'].symbols.swift).toBe('Snapshot.windows(of:)')
    expect(CONCEPTS['list-panes'].symbols.swift).toBe('Snapshot.panes(of:)')
    expect(CONCEPTS['list-server-windows']?.symbols.swift).toBe('Server.windows()')
    expect(CONCEPTS['list-server-panes']?.symbols.swift).toBe('Server.panes()')
  })

  it('links visible capture to the visible capture overload', () => {
    expect(CONCEPTS['capture-pane'].symbols.swift).toBe('Server.capture(_:includingHistory:)')
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
        const found = model.symbols.some((s) => (s.publicId ?? s.id) === publicId)
        if (!found) missing.push(`${id} ${port}: ${publicId}`)
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
