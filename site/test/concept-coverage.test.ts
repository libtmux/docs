import { describe, expect, it } from 'vitest'
import { CONCEPTS, conceptsFor } from '@libtmux/api-model'
import { API_MODELS, referenceAlternatives, referenceHref } from '../src/lib/api-models'
import { API_MODEL_PORTS } from '../src/lib/ports'

/**
 * Which ports have a page for each operation, as the port switcher and "In other ports" show it. A port with no page
 * reads "No matching page", so a port that has the operation under another name must be named in the concept table:
 * a name match cannot find `LibTmux.Server.CaptureSnapshotAsync` or `LibTmux.FSharp.Server.capture` for
 * `Server.snapshot`. A port with no such declaration says what is missing.
 */
const ORDER = API_MODEL_PORTS.map((port) => port.slug)

/** The ports of `concept` that have a reference page, and the ports that say why they have none. */
function coverage(concept: string) {
  const id = CONCEPTS[concept]!
  const pages: string[] = []
  const reasons: string[] = []
  for (const port of ORDER) {
    const symbol = id.symbols[port]
    if (symbol && referenceHref(port, symbol)) pages.push(port)
    else if (id.absent?.[port]) reasons.push(port)
  }
  return { pages, reasons }
}

describe('the ports that have a page for an operation', () => {
  it('lists every port for a server snapshot except those with no whole-server snapshot', () => {
    const { pages, reasons } = coverage('snapshot')
    expect(pages.toSorted()).toEqual(['csharp', 'elixir', 'fsharp', 'go', 'java', 'julia', 'kotlin', 'lua', 'powershell', 'rs', 'ruby', 'scala', 'swift', 'ts'])
    // Python's core and C++ have no snapshot of a whole server, and each says so.
    expect(reasons.toSorted()).toEqual(['cxx', 'py'])
    for (const port of ['py', 'cxx']) expect(CONCEPTS.snapshot!.absent![port], port).toMatch(/^no equivalent on `Server`/)
  })

  it('names the declaration each port reaches for a server snapshot, wherever its name is not `snapshot`', () => {
    expect(CONCEPTS.snapshot!.symbols).toMatchObject({
      csharp: 'LibTmux.Server.CaptureSnapshotAsync',
      fsharp: 'LibTmux.FSharp.Server.capture',
      rs: 'server.Server.hierarchy',
      swift: 'Server.snapshot()',
    })
  })

  it('says of Rust\'s hierarchy what its documentation says: three commands, and not an atomic capture', () => {
    const hierarchy = API_MODELS.rs!.symbols.find((symbol) => symbol.id === 'server.Server.hierarchy')!
    expect(hierarchy.doc?.summary).toBe('Fetch the whole hierarchy in three commands.')
    expect(hierarchy.doc?.body).toMatch(/not an\s+atomic capture/)
    expect(hierarchy.apiScope).not.toBe('internal')
    expect(CONCEPTS.snapshot!.notes!.rs).toMatch(/not an atomic transaction/)
    // Go's snapshot is mapped, and is no more atomic.
    expect(API_MODELS.go!.symbols.find((symbol) => symbol.id === 'tmux.Server.Snapshot')?.doc?.summary).toMatch(/not an atomic transaction/)
    expect(CONCEPTS.snapshot!.absent!.rs).toBeUndefined()
  })

  /** The public declarations of `Server` and the free functions that a name says read a hierarchy, a tree or a capture. */
  const reaching = (port: string, server: string) => API_MODELS[port]!.symbols
    .filter((symbol) => (symbol.product ?? 'core') === 'core' && symbol.apiScope !== 'internal' && (symbol.parent === server || (!symbol.parent && symbol.kind === 'function')))
    .filter((symbol) => /snapshot|hierarch|tree|capture/i.test(symbol.name))
    .map((symbol) => symbol.publicId ?? symbol.id)

  it('gives C++ a reason that names what is missing, and links no declaration that takes the internal backend', () => {
    const reason = CONCEPTS.snapshot!.absent!.cxx!
    expect(CONCEPTS.snapshot!.symbols.cxx).toBeUndefined()
    expect(conceptsFor('cxx', 'libtmux::Snapshot::take')).toEqual([])
    for (const name of ['sessions', 'windows', 'panes', 'clients', 'Snapshot::take', 'detail::Backend']) expect(reason, name).toContain(name)
    // The reason stays true while the model says so. Nothing public on `Server`, and no free function, reads a hierarchy:
    // `capture_lines` splits the text of a pane capture. Every signature of `Snapshot::take` and `take_in_session` is given
    // an internal backend. Each listing is its own call.
    expect(reaching('cxx', 'libtmux::Server')).toEqual(['libtmux::capture_lines'])
    const signatures = API_MODELS.cxx!.symbols.filter((symbol) => symbol.id.startsWith('libtmux::Snapshot::take')).flatMap((symbol) => symbol.signatures)
    expect(signatures.length).toBeGreaterThanOrEqual(3)
    for (const signature of signatures) expect(signature.params.some((param) => /detail::Backend/.test(param.type ?? ''))).toBe(true)
    for (const name of ['sessions', 'windows', 'panes', 'clients']) expect(API_MODELS.cxx!.symbols.some((symbol) => symbol.id === `libtmux::Server::${name}`), name).toBe(true)
  })

  it('gives Python its reason while its Server and its free functions hold no snapshot, hierarchy, tree or capture', () => {
    expect(CONCEPTS.snapshot!.symbols.py).toBeUndefined()
    expect(reaching('py', 'libtmux.server.Server')).toEqual([])
  })

  it('shows the Rust, Swift, C# and F# pages from a Ruby `Server#snapshot`, and a reason where a port has none', () => {
    const fromRuby = referenceAlternatives('ruby', 'LibTmux::Server#snapshot')
    expect(fromRuby).toHaveLength(1)
    const links = Object.fromEntries(fromRuby[0]!.ports.map((entry) => [entry.port, entry]))
    expect(links.rs).toMatchObject({ publicId: 'server.Server.hierarchy', href: expect.stringMatching(/\/rs\/.*\/reference\/server-server-hierarchy[^/]*\/$/), note: CONCEPTS.snapshot!.notes!.rs })
    expect(links.swift).toMatchObject({ publicId: 'Server.snapshot()', href: expect.stringContaining('/swift/') })
    expect(links.csharp).toMatchObject({ publicId: 'LibTmux.Server.CaptureSnapshotAsync' })
    expect(links.fsharp).toMatchObject({ publicId: 'LibTmux.FSharp.Server.capture' })
    expect(links.py).toMatchObject({ href: undefined, absent: 'no equivalent on `Server`' })
    expect(links.cxx).toMatchObject({ href: undefined, absent: CONCEPTS.snapshot!.absent!.cxx })
    // And back: the Rust page lists the others.
    const fromRust = referenceAlternatives('rs', 'server.Server.hierarchy')
    expect(fromRust.map((group) => group.label)).toEqual(['Capture the tmux hierarchy'])
    expect(fromRust[0]!.ports.find((entry) => entry.port === 'ruby')?.href).toMatch(/\/ruby\/.*\/libtmux-server-snapshot[^/]*\/$/)
  })

  it('has a page for every port a concept maps, and a reason for every port it does not', () => {
    const missing: string[] = []
    for (const [name, concept] of Object.entries(CONCEPTS)) {
      for (const port of ORDER) {
        const symbol = concept.symbols[port]
        if (symbol ? !referenceHref(port, symbol) : !concept.absent?.[port]) missing.push(`${name} ${port}: ${symbol ?? 'no reason'}`)
      }
    }
    expect(missing).toEqual([])
  })
})
