import { describe, expect, it } from 'vitest'
import { apisUsed, CORE_APIS, MAX_APIS } from '../src/lib/core-apis'
import { portCapabilities, type CapabilityTable } from '../src/lib/core-capabilities'
import { QUICKSTARTS, homeProgram } from '../src/lib/quickstarts'
import TABLE from '../src/data/core-capabilities.json'
import SOURCES from '../src/data/example-sources.json'
import type { CachedSource } from '../src/lib/port-landing'

const programs = (port: string): Record<string, string> => ({
  'typed-graph': homeProgram(QUICKSTARTS[port]!.complete!, 'full'),
  ...Object.fromEntries(portCapabilities(port, TABLE as CapabilityTable, SOURCES as Record<string, CachedSource>).map((item) => [item.id, item.code])),
})

describe('the APIs a showcase example uses', () => {
  it('has a list for every example the showcase shows, and none for another', () => {
    for (const port of ['rs', 'ruby', 'go']) expect(Object.keys(CORE_APIS[port]!).sort(), port).toEqual(Object.keys(programs(port)).sort())
    expect(Object.keys(CORE_APIS).sort()).toEqual(['go', 'ruby', 'rs'].sort())
  })

  const cases = Object.entries(CORE_APIS).flatMap(([port, list]) => Object.entries(list).map(([id, ids]) => [`${port}/${id}`, port, id, ids] as const))
  it.each(cases)('resolves every symbol %s names, uses it in the program and links the reference', (name, port, id, ids) => {
    const code = programs(port)[id]!
    const used = apisUsed(port, ids, code, 'latest', name)
    expect(used.shown.length + used.more).toBe(ids.length)
    expect(used.shown.length).toBeLessThanOrEqual(MAX_APIS)
    expect(used.shown.map((item) => item.at)).toEqual([...used.shown.map((item) => item.at)].sort((a, b) => a - b))
    for (const item of used.shown) expect(item.href, item.id).toContain(`/${port}/latest/reference/`)
    expect(used.moreHref).toBe(`/${port}/latest/reference/`)
  })

  it('lists the Rust quickstart symbols in order of first use', () => {
    const used = apisUsed('rs', CORE_APIS.rs!['typed-graph']!, programs('rs')['typed-graph']!, 'latest')
    expect(used.shown.map((item) => item.label)).toEqual([
      'PaneWait', 'Server', 'Server::new_session', 'Session::new_window', 'Window::active_pane', 'Pane::send_line', 'Pane::wait_until', 'Pane::capture', 'Server::builder', 'ServerBuilder::build',
    ])
    expect(used.more).toBe(2)
  })

  it('fails on a symbol the model lacks, one the program never uses, a duplicate and an internal one', () => {
    const code = programs('rs')['typed-graph']!
    expect(() => apisUsed('rs', ['server.Server.no_such'], code, 'latest')).toThrow(/not in the rs API model/)
    expect(() => apisUsed('rs', ['window.Window.panes'], code, 'latest')).toThrow(/never uses panes/)
    expect(() => apisUsed('rs', ['server.Server', 'server.Server'], code, 'latest')).toThrow(/twice/)
    expect(() => apisUsed('rs', ['libtmux.Pane'], code, 'latest')).toThrow(/not in the rs API model/)
    expect(() => apisUsed('nope', [], code, 'latest')).toThrow(/unknown port/)
  })
})
