import { describe, expect, it } from 'vitest'
import { nativeReferenceTree, type NativeShellContext } from '../src/lib/native-shell'
import { searchApi, apiTreeHref } from '../src/lib/api-search'

describe('native shell context', () => {
  it('keeps repeated native declarations on their own pages with nested ownership', () => {
    const context = { port: 'py', pages: ['api/server/', 'internals/server/'].map((path) => ({ path, title: 'Server',
      url: `/pr-42/en/py/v0.46.2/api/${path}`, declarations: [
        { id: 'Server', name: 'Server', kind: 'class' },
        { id: 'Server.sessions', name: 'sessions', kind: 'property', parent: 'Server' },
      ] })) } as NativeShellContext
    const json = nativeReferenceTree(context)
    const members = searchApi(json, 'sessions')
    expect(new Set(members.map((member) => member.id)).size).toBe(2)
    expect(members.map((member) => apiTreeHref('/ignored/', member, json.hrefs))).toEqual([
      '/pr-42/en/py/v0.46.2/api/api/server/#Server.sessions', '/pr-42/en/py/v0.46.2/api/internals/server/#Server.sessions',
    ])
    expect(json.members['api/server/#Server'][0][2]).toBe('api/server/#Server.sessions')
  })
  it('never shows a page id as a name, path or summary', () => {
    const context = { port: 'py', toctree: [], pages: ['api/libtmux.client/', ''].map((path) => ({ path, title: path ? 'Client' : 'API Reference',
      url: `/en/py/latest/api/${path}`, declarations: path ? [{ id: 'libtmux.Client', name: 'Client', kind: 'class' }, { id: 'libtmux.Client.cmd', name: 'cmd', kind: 'method', parent: 'libtmux.Client' }] : [] })) } as unknown as NativeShellContext
    const records = searchApi(nativeReferenceTree(context), '')
    expect(records.length).toBeGreaterThan(2)
    for (const record of records) {
      for (const text of [record.name, record.symbolName, record.qualifiedName, record.shortName ?? '']) expect(text).not.toMatch(/^page:/)
    }
    expect(records.find((record) => record.kind === 'section' && record.name === 'Client')?.qualifiedName).toBe('api/libtmux.client')
  })
})
