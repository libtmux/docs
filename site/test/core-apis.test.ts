import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { apisUsed, CORE_APIS, MAX_APIS, withoutLiterals } from '../src/lib/core-apis'
import { portCapabilities, type CapabilityTable } from '../src/lib/core-capabilities'
import { QUICKSTARTS, homeProgram } from '../src/lib/quickstarts'
import TABLE from '../src/data/core-capabilities.json'
import SOURCES from '../src/data/example-sources.json'
import type { CachedSource } from '../src/lib/port-landing'

const showcasePorts = Object.keys(TABLE).filter((port) => portCapabilities(port, TABLE as CapabilityTable, SOURCES as Record<string, CachedSource>).length > 0)

const programs = (port: string): Record<string, string> => ({
  'typed-graph': homeProgram(QUICKSTARTS[port]!.complete!, 'full'),
  ...Object.fromEntries(portCapabilities(port, TABLE as CapabilityTable, SOURCES as Record<string, CachedSource>).map((item) => [item.id, item.code])),
})

describe('the APIs a showcase example uses', () => {
  it('has a list for every example the showcase shows, and none for another', () => {
    // A port that gains a showcase example must list its APIs, whichever port it is.
    expect(showcasePorts).toEqual(expect.arrayContaining(['rs', 'ruby', 'go']))
    for (const port of showcasePorts) expect(Object.keys(CORE_APIS[port] ?? {}).sort(), port).toEqual(Object.keys(programs(port)).sort())
    expect(Object.keys(CORE_APIS).sort()).toEqual([...showcasePorts].sort())
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
      'PaneWait', 'Server', 'SplitDirection', 'SplitOptions', 'Server::new_session', 'Session::active_window', 'Window::rename', 'Window::active_pane', 'Pane::split', 'Session::new_window',
    ])
    expect(used.more).toBe(17)
  })

  it('counts a use, not a mention in a comment or a string, and a call by its qualified form', () => {
    const real = programs('rs')['typed-graph']!
    // The name only in a comment, or only in a string.
    expect(() => apisUsed('rs', ['pane.Pane.wait_until'], '// wait_until is not called here\nfn main() {}\n', 'latest')).toThrow(/never uses wait_until/)
    expect(() => apisUsed('rs', ['pane.Pane.wait_until'], 'fn main() { println!("wait_until"); }', 'latest')).toThrow(/never uses wait_until/)
    expect(() => apisUsed('rs', ['pane.Pane.wait_until'], '/* pane.wait_until(x) */ fn main() {}', 'latest')).toThrow(/never uses wait_until/)
    // A method needs its call form: a bare word of the same name is another thing.
    expect(() => apisUsed('rs', ['pane.Pane.capture'], 'fn main() { let capture = 1; }', 'latest')).toThrow(/never uses capture/)
    expect(apisUsed('rs', ['pane.Pane.capture'], 'fn main() { pane.capture().await; }', 'latest').shown).toHaveLength(1)
    expect(apisUsed('rs', ['server.Server.builder'], 'fn main() { Server::builder(); }', 'latest').shown).toHaveLength(1)
    expect(() => apisUsed('go', ['tmux.Session.Rename'], '// session.Rename(ctx, "x")\nfunc main() {}\n', 'latest')).toThrow(/never uses Rename/)
    expect(() => apisUsed('ruby', ['LibTmux::Pane#send_text'], '# pane.send_text("x")\nputs 1\n', 'latest')).toThrow(/never uses send_text/)
    expect(() => apisUsed('ruby', ['LibTmux::Pane#send_text'], 'puts "pane.send_text"\n', 'latest')).toThrow(/never uses send_text/)
    expect(withoutLiterals('a "b // c" // d\ne', 'rust')).toBe(`a${' '.repeat(14)}\ne`)
    expect(withoutLiterals('x `raw "y"` z', 'go')).toBe(`x${' '.repeat(11)}z`)
    // Ruby runs the code inside #{...}.
    expect(withoutLiterals('puts "a #{window.snapshot.name} b"', 'ruby')).toContain('window.snapshot.name')
    expect(withoutLiterals('puts "plain window.snapshot"', 'ruby')).not.toContain('snapshot')
    // The real programs still use every symbol they name.
    expect(apisUsed('rs', CORE_APIS.rs!['typed-graph']!, real, 'latest').shown.length).toBeGreaterThan(0)
  })

  // The Ruby send-keys program polls Pane#capture and attaches no control
  // client. A frozen copy keeps the list held to that program whatever the
  // example cache holds: the list must resolve against it, and a list that
  // names a control-mode symbol the program never calls must be refused.
  describe('the Ruby send-keys program that polls capture instead of watching', () => {
    const polling = readFileSync(new URL('./fixtures/ruby-capture-begin-wrapped.rb', import.meta.url), 'utf8')
    const watching = [
      'LibTmux::Server#open_control', 'LibTmux::ControlConnection#exchange', 'LibTmux::ControlConnection#subscribe',
      'LibTmux::ControlSubscription#next', 'LibTmux::ControlEvent#data',
    ]

    it('resolves the list the showcase holds for it', () => {
      expect(apisUsed('ruby', CORE_APIS.ruby!['send-keys']!, polling, 'latest').shown.map((item) => item.label)).toEqual([
        'Server', 'Server.start', 'Server#new_session', 'CreationReceipt#pane', 'Pane#send_text', 'Pane#send_keys', 'Pane#capture', 'CommandResult#stdout',
      ])
    })

    it.each(watching)('refuses a list that still names %s', (id) => {
      const name = id.slice(id.lastIndexOf('#') + 1)
      expect(() => apisUsed('ruby', [...CORE_APIS.ruby!['send-keys']!, id], polling, 'latest', 'ruby/send-keys'))
        .toThrow(`core-apis: ruby/send-keys names ${id}, but the program never uses ${name}`)
    })
  })

  it('fails on a symbol the model lacks, one the program never uses, a duplicate and an internal one', () => {
    const code = programs('rs')['typed-graph']!
    expect(() => apisUsed('rs', ['server.Server.no_such'], code, 'latest')).toThrow(/not in the rs API model/)
    expect(() => apisUsed('rs', ['pane.Pane.capture'], code, 'latest')).toThrow(/never uses capture/)
    expect(() => apisUsed('rs', ['server.Server', 'server.Server'], code, 'latest')).toThrow(/twice/)
    expect(() => apisUsed('rs', ['libtmux.Pane'], code, 'latest')).toThrow(/not in the rs API model/)
    expect(() => apisUsed('nope', [], code, 'latest')).toThrow(/unknown port/)
  })
})
