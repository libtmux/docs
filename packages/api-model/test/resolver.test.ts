import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { readInventory } from '../src/inventory.ts'
import type { ApiModel } from '../src/model.ts'
import { Resolver, notASymbol, toPath } from '../src/resolver.ts'

/**
 * The resolver, against the corpus it exists for.
 *
 * The rate is a floor rather than an assertion of the current number: prose
 * changes, and a test that pins 87% fails on an unrelated edit. What must not
 * regress is the mechanism, so the specific behaviours below are asserted
 * individually — each one is a rule that cost a spike round to establish.
 */
const here = dirname(fileURLToPath(import.meta.url))
const DATA = join(here, '../../../site/src/data/api')
const PORTS = ['py', 'ts', 'rs', 'go', 'java', 'dotnet', 'cxx', 'swift'] as const
const available = existsSync(join(DATA, 'py.json'))
const d = available ? describe : describe.skip

d('resolver', () => {
  let r: Resolver

  beforeAll(() => {
    const models = PORTS.map((p) => JSON.parse(readFileSync(join(DATA, `${p}.json`), 'utf8')) as ApiModel)
    r = new Resolver(models)
    const inv = join(here, '../../../site/src/data/inventories/python.inv')
    if (existsSync(inv)) {
      r.addInventory('Python', 'https://docs.python.org/3/', readInventory(readFileSync(inv)).entries)
    }
  })

  it('rejects things that are not references', () => {
    expect(notASymbol('sync_snippets.py --check')).toBeTruthy()
    expect(notASymbol('pane.pane_id == other.pane_id')).toBeTruthy()
    expect(notASymbol('new ServerConnectionOptions()')).toBeTruthy()
    expect(notASymbol('tmux.ServerOptions{SocketName: "work"}')).toBeTruthy()
    // And does not reject a real one.
    expect(notASymbol('server.sessions()')).toBeUndefined()
  })

  it('normalises call syntax to a path', () => {
    expect(toPath('await server.sessions()')).toEqual(['server', 'sessions'])
    expect(toPath('server->sessions()')).toEqual(['server', 'sessions'])
    expect(toPath('libtmux::Server::wait_for(ch)')).toEqual(['libtmux', 'Server', 'wait_for'])
  })

  it('scopes an ambiguous member by its receiver', () => {
    // `panes` exists on Server, Session and Window; only the receiver decides.
    const res = r.resolve('py', 'window.panes')
    expect(res.how).toBe('scoped')
    if (res.how === 'scoped') expect(res.symbol.publicId).toBe('libtmux.Window.panes')
  })

  it('resolves a Go method through its receiver type', () => {
    const res = r.resolve('go', 'window.Panes()')
    expect(['scoped', 'unique']).toContain(res.how)
    if (res.how === 'scoped' || res.how === 'unique') {
      expect(res.symbol.parent).toMatch(/Window$/)
    }
  })

  it('treats a module-qualified name as a whole, not as a receiver', () => {
    // `tmux.NewServer` is a package path a Go reader writes. Read as
    // receiver+member it looks for a type named `Tmux` and fails.
    const res = r.resolve('go', 'tmux.NewServer(tmux.ServerOptions{})')
    expect(res.how).not.toBe('no-symbol')
  })

  it('federates a name that is not ours', () => {
    const res = r.resolve('py', 'subprocess.Popen')
    expect(res.how).toBe('federated')
    if (res.how === 'federated') expect(res.href).toContain('docs.python.org')
  })

  it('uses a URL template where no inventory exists', () => {
    // javadoc and pkg.go.dev publish no objects.inv; their URLs are derivable.
    const go = r.resolve('go', 'errors.As')
    expect(go.how).toBe('federated')
    const java = r.resolve('java', 'Stream.filter()')
    expect(java.how).toBe('federated')
  })

  it('refuses rather than guessing when nothing disambiguates', () => {
    // Prose that elides the receiver entirely is underdetermined by its text.
    const res = r.resolve('py', '.get()')
    expect(['ambiguous', 'no-symbol']).toContain(res.how)
  })

  it('answers the cross-port question the estate is for', () => {
    expect(r.portsWith('sessions').length).toBeGreaterThan(3)
    // And is honest that name matching does not bridge a rename: this is the
    // evidence for needing an explicit concept map.
    expect(r.portsWith('capture_pane')).toEqual(['py'])
  })

  it('resolves most of the real corpus', () => {
    const LABEL: Record<string, string> = {
      Python: 'py', TypeScript: 'ts', Rust: 'rs', Go: 'go',
      Java: 'java', '.NET': 'dotnet', 'C++': 'cxx', Swift: 'swift',
    }
    const docs = join(here, '../../../site/src/content/docs')
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.md') ? [join(dir, e.name)] : [])
    let linkable = 0
    let resolved = 0
    for (const f of walk(docs)) {
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        if (!line.startsWith('|')) continue
        const cols = line.split('|').map((c) => c.trim())
        const port = LABEL[cols[1]]
        if (!port) continue
        for (const col of cols.slice(2)) {
          for (const m of col.matchAll(/`([^`]+)`/g)) {
            const text = m[1]
            if (!/^[A-Za-z_.][\w.]*(\s*\(|\.)/.test(text) && !/\(\)$/.test(text)) continue
            const res = r.resolve(port, text)
            if (res.how === 'not-a-symbol') continue
            linkable++
            if (!['ambiguous', 'no-symbol'].includes(res.how)) resolved++
          }
        }
      }
    }
    expect(linkable).toBeGreaterThan(200)
    // Floor, not a pin. 87% at the time of writing.
    expect(resolved / linkable).toBeGreaterThan(0.8)
  })
})
