import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { extractProject } from '../src/project.ts'
import { SymbolIndex } from '../src/link.ts'
import { referencesIn } from '../src/doc/roles.ts'
import type { ApiModel } from '../src/model.ts'

/**
 * The coverage claim, as a test rather than a number in a commit message.
 *
 * The fixture is every `id="libtmux.Pane.*"` anchor gp-sphinx emits for
 * `libtmux.pane`, captured from a real build. If the extractor ever stops
 * finding one of them, this fails — which is the point: "100% today" and
 * "100% or the build breaks" are different claims.
 *
 * The fixture is 251 anchors, and gp-sphinx renders 252 members. The
 * difference is `client_utf8`, which reaches `Pane` twice through the MRO;
 * Sphinx renders both and anchors only the first, so it has a signature on
 * the page and no `id`. That is a quirk of the fixture, not of either tool.
 */
const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(here, 'fixtures/gp-sphinx-libtmux-pane-anchors.txt')
const SOURCE = join(homedir(), 'work/python/libtmux/src')

const available = existsSync(SOURCE)
const describeIfSource = available ? describe : describe.skip

describeIfSource('Python extraction against gp-sphinx', () => {
  let model: ApiModel

  it('extracts the package', async () => {
    model = await extractProject({
      port: 'py',
      root: SOURCE,
      // Matching libtmux's own conf.py, which passes :private-members: and
      // :inherited-members:. specialMembers is on because the site wants
      // `__enter__` documented even though Sphinx's default list omits it.
      options: { privateMembers: true, specialMembers: true, inheritedMembers: true },
    })
    expect(model.symbols.length).toBeGreaterThan(1500)
  }, 120_000)

  it('finds every member gp-sphinx anchors on Pane', () => {
    const expected = readFileSync(FIXTURE, 'utf8').split('\n').filter(Boolean)
    const pane = model.symbols.find((s) => s.publicId === 'libtmux.Pane' && s.kind === 'class')
    expect(pane, 'Pane class').toBeDefined()

    const found = new Set(
      model.symbols.filter((s) => s.parent === pane?.id).map((s) => s.publicId ?? s.id),
    )
    const missing = expected.filter((id) => !found.has(id))
    expect(missing, `missing ${missing.length} of ${expected.length}`).toEqual([])
  })

  it('resolves inherited dataclass fields from another module', () => {
    const pane = model.symbols.find((s) => s.publicId === 'libtmux.Pane')
    const field = model.symbols.find(
      (s) => s.parent === pane?.id && s.name === 'buffer_name',
    )
    expect(field?.inheritedFrom).toBe('libtmux.neo.Obj')
    expect(field?.publicId).toBe('libtmux.Pane.buffer_name')
  })

  it('merges overloads onto one symbol and keeps the documented signature', () => {
    const cap = model.symbols.find((s) => s.publicId === 'libtmux.Pane.capture_pane')
    // Two `@t.overload` stubs plus the implementation.
    expect(cap?.signatures.length).toBe(3)
    expect(cap?.doc?.summary).toMatch(/Capture text from pane/)
    // The stubs carry no docs; the implementation's parameter docs must win.
    const documented = cap?.signatures.flatMap((s) => s.params.filter((p) => p.doc)) ?? []
    expect(documented.length).toBeGreaterThan(10)
  })

  it('gives every symbol a public path, not a declaration path', () => {
    const cap = model.symbols.find((s) => s.id === 'libtmux.pane.Pane.capture_pane')
    expect(cap?.publicId).toBe('libtmux.Pane.capture_pane')
  })
})

describeIfSource('cross-linking', () => {
  let index: SymbolIndex
  let model: ApiModel

  beforeAll(async () => {
    model = await extractProject({
      port: 'py',
      root: SOURCE,
      options: { privateMembers: true, specialMembers: true },
    })
    index = new SymbolIndex(model.symbols, (s) => `#${s.publicId ?? s.id}`, 'py')
  }, 120_000)

  it('resolves the great majority of docstring references', () => {
    let total = 0
    let linked = 0
    for (const sym of model.symbols) {
      const text = [sym.doc?.summary, sym.doc?.body].filter(Boolean).join('\n')
      if (!text) continue
      for (const ref of referencesIn(text)) {
        total++
        if (index.resolve(ref.target, ref.role, sym)) linked++
      }
    }
    // 93.5% at the time of writing. The floor is deliberately below that:
    // this guards against a regression in the resolver, not against libtmux
    // adding a docstring reference to something outside the package.
    expect(total).toBeGreaterThan(200)
    expect(linked / total).toBeGreaterThan(0.9)
  })

  it('links type annotations, including inside generics and unions', () => {
    const spans = index.linkType('list[Window] | None')
    const window = spans.find((s) => s.text === 'Window')
    expect(window?.link?.symbol?.publicId).toBe('libtmux.Window')
    // `list` and `None` are the language's, and go to docs.python.org.
    expect(spans.find((s) => s.text === 'list')?.link?.external).toBe(true)
    expect(spans.find((s) => s.text === 'None')?.link?.external).toBe(true)
    // Brackets and separators survive untouched, so the annotation still reads
    // as the annotation.
    expect(spans.map((s) => s.text).join('')).toBe('list[Window] | None')
  })

  it('does not link a string literal inside a Literal[...]', () => {
    const spans = index.linkType(`t.Literal["-"] | int`)
    expect(spans.find((s) => s.text === '"-"')?.link).toBeUndefined()
  })

  it('resolves a relative reference against its enclosing class', () => {
    const session = model.symbols.find((s) => s.publicId === 'libtmux.Session')
    expect(index.resolve('.panes', 'attr', session)?.symbol?.publicId).toBe('libtmux.Session.panes')
    // And refuses to fall through to a global match when it cannot.
    const pane = model.symbols.find((s) => s.publicId === 'libtmux.Pane')
    expect(index.resolve('.nonexistent_thing', 'attr', pane)).toBeUndefined()
  })

  it('prefers a class over a same-named enum member for a bare reference', () => {
    // `Window` is both `libtmux.Window` and `OptionScope.Window`. Sphinx's
    // default role prefers the type, and so does this.
    expect(index.resolve('Window', 'any')?.symbol?.publicId).toBe('libtmux.Window')
  })

  it('does not invent references inside roles it does not handle', () => {
    // `:term:` and `:ref:` are glossary and label references, not symbols.
    // Leaving their backticks unclaimed made the fallback read the label as a
    // symbol name — 20 fabricated references across the package.
    const refs = referencesIn('See :term:`winlinks <winlink>` and :ref:`quickstart`.')
    expect(refs).toEqual([])
  })
})

describeIfSource('id stability', () => {
  /**
   * `id` and `publicId` are keys, not labels.
   *
   * Anything durable keyed on them — a permalink a reader bookmarked, a row in
   * a projection, a cross-reference resolved in another port — breaks silently
   * if they move for an unchanged symbol. Two extractions of the same tree must
   * agree exactly.
   */
  it('produces identical ids across two extractions', async () => {
    const once = await extractProject({
      port: 'py',
      root: SOURCE,
      options: { privateMembers: true, specialMembers: true },
    })
    const twice = await extractProject({
      port: 'py',
      root: SOURCE,
      options: { privateMembers: true, specialMembers: true },
    })
    const key = (m: ApiModel) =>
      m.symbols.map((s) => `${s.id}\t${s.publicId}`).sort().join('\n')
    expect(key(twice)).toBe(key(once))
  }, 120_000)

  it('derives id from the declaration path, not from resolution order', async () => {
    const model = await extractProject({
      port: 'py',
      root: SOURCE,
      options: { privateMembers: true, specialMembers: true },
    })
    // An inherited member is keyed on the class it lands on, so it stays put
    // even if the base it came from is renamed or re-homed.
    const field = model.symbols.find(
      (s) => s.publicId === 'libtmux.Pane.buffer_name',
    )
    expect(field?.id).toBe('libtmux.pane.Pane.buffer_name')
    expect(field?.inheritedFrom).toBe('libtmux.neo.Obj')
  }, 120_000)
})

describe('id uniqueness across every port', () => {
  /**
   * `id` is a key. Anchors, permalinks and any projection keyed on it break
   * silently when two symbols share one — the second overwrites, or renders a
   * duplicate anchor, and nothing errors.
   *
   * Swift failed this and seven ports passed, which is why the check belongs
   * here rather than in a reviewer's head: its ids come from the symbol
   * graph's title path, which omits parameter types, so six overloads of
   * `FilterOperator.equals(_:)` collapsed onto one id. They are merged into
   * one symbol with six signatures now, which is also what the reference
   * should render.
   */
  const MODELS = ['py', 'ts', 'rs', 'go', 'java', 'dotnet', 'cxx', 'swift'] as const

  it.each(MODELS)('%s has no duplicate ids', async (port) => {
    const path = join(here, `../../site/src/data/api/${port}.json`)
    if (!existsSync(path)) return // generated artifact; skip when absent
    const model = JSON.parse(readFileSync(path, 'utf8')) as ApiModel
    const seen = new Map<string, number>()
    for (const s of model.symbols) seen.set(s.id, (seen.get(s.id) ?? 0) + 1)
    const dupes = [...seen.entries()].filter(([, n]) => n > 1)
    expect(dupes.map(([id, n]) => `${id} x${n}`)).toEqual([])
  })
})

describe('objects.inv round-trips every port', () => {
  /**
   * An inventory two entries short looks exactly like a correct one.
   *
   * Java's did, because the extractor had put a field's initialiser into its
   * name — `DEFAULT_MAX_REPLY_BYTES = 16 * 1024 * 1024` — and the record
   * format is whitespace-delimited, so the reader mis-split it and dropped it.
   * Found by a second session counting entries against the model rather than
   * trusting the writer.
   */
  const MODELS = ['py', 'ts', 'rs', 'go', 'java', 'dotnet', 'cxx', 'swift'] as const

  it.each(MODELS)('%s writes and reads back every symbol', async (port) => {
    const path = join(here, `../../site/src/data/api/${port}.json`)
    if (!existsSync(path)) return
    const model = JSON.parse(readFileSync(path, 'utf8')) as ApiModel
    const { writeInventory, readInventory } = await import('../src/inventory.ts')
    const bytes = writeInventory(model, {
      project: port,
      version: 'test',
      uriFor: (s) => `reference/${port}/#${s.publicId ?? s.id}`,
    })
    const back = readInventory(bytes)
    expect(back.entries.length).toBe(model.symbols.length)
  })
})

describe('methods belong to their types', () => {
  /**
   * A method with no owner renders detached from the type it is called on,
   * and makes receiver-scoped linking impossible for that port.
   *
   * Go had 0 of 1,003 parented: `func (w Window) Panes()` is a top-level
   * declaration carrying its type in a `receiver` field nothing read, and Go's
   * namespace is the package directory rather than the file, so the type and
   * its methods were in different modules besides. Rust reported 85 more that
   * were not methods at all — free functions in `mod` blocks, since Rust
   * spells both `function_item` and only an enclosing `impl` distinguishes
   * them.
   */
  const MODELS = ['py', 'ts', 'rs', 'go', 'java', 'dotnet', 'cxx', 'swift'] as const

  it.each(MODELS)('%s parents at least 95%% of its methods', (port) => {
    const path = join(here, `../../site/src/data/api/${port}.json`)
    if (!existsSync(path)) return
    const model = JSON.parse(readFileSync(path, 'utf8')) as ApiModel
    const methods = model.symbols.filter((s) => s.kind === 'method')
    if (!methods.length) return
    const orphans = methods.filter((s) => !s.parent)
    const rate = 1 - orphans.length / methods.length
    expect(rate, `${orphans.length} ownerless: ${orphans.slice(0, 3).map((s) => s.id).join(', ')}`)
      .toBeGreaterThanOrEqual(0.95)
  })

  it('attaches a Go method to its receiver type', () => {
    const path = join(here, '../../site/src/data/api/go.json')
    if (!existsSync(path)) return
    const model = JSON.parse(readFileSync(path, 'utf8')) as ApiModel
    const panes = model.symbols.find((s) => s.id === 'tmux.Window.Panes')
    expect(panes?.kind).toBe('method')
    expect(panes?.parent).toBe('tmux.Window')
  })
})

describe('the reference is pruned but not gutted', () => {
  /**
   * Two failure directions, and only testing one of them is how a pruning
   * rule quietly eats real API.
   */
  it('drops internal namespaces', () => {
    for (const port of ['ts', 'rs', 'go'] as const) {
      const path = join(here, `../../site/src/data/api/${port}.json`)
      if (!existsSync(path)) continue
      const model = JSON.parse(readFileSync(path, 'utf8')) as ApiModel
      const leaked = model.symbols.filter((s) =>
        /^_?(internal|_generated)\./.test(s.publicId ?? s.id),
      )
      expect(leaked.map((s) => s.publicId), `${port} leaked internals`).toEqual([])
    }
  })

  it('keeps the types a reader came for', () => {
    // The other direction. TypeScript lost 1,448 of 2,242 symbols to pruning;
    // a rule one character wider would have taken `Pane` with them and the
    // count alone would have looked like a success.
    for (const port of ['ts', 'rs', 'go'] as const) {
      const path = join(here, `../../site/src/data/api/${port}.json`)
      if (!existsSync(path)) continue
      const model = JSON.parse(readFileSync(path, 'utf8')) as ApiModel
      for (const name of ['Server', 'Session', 'Window', 'Pane']) {
        const owner = model.symbols.find((s) => s.name === name && !s.parent)
        expect(owner, `${port} lost ${name}`).toBeDefined()
        const members = model.symbols.filter((s) => s.parent === owner?.id)
        expect(members.length, `${port}.${name} has no members`).toBeGreaterThan(0)
      }
    }
  })
})
