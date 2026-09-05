import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SymbolIndex } from '../src/link.ts'
import { Resolver } from '../src/resolver.ts'
import { readInventory } from '../src/inventory.ts'
import { moduleOf, modulesIn } from '../src/modules.ts'

/**
 * An inventory answers for its own project, and for no other.
 *
 * This is the test that was missing when CPython's `objects.inv` and the
 * built-in Python stdlib tables were consulted for every port. The result was
 * 1,889 links that took a reader of Go, Rust, Java, .NET, C++ or Swift to
 * documentation for a different language: `time.Time` and `os.File` to
 * Python's `time` and `os` modules, Java's `Optional` to `typing.Optional`,
 * `bool` and `int` everywhere to Python's builtins.
 *
 * Those links are worse than no link. An unresolved name renders as plain
 * text and the reader looks it up; a wrong link looks deliberate, and the
 * reader follows it.
 *
 * Both resolvers get the same treatment because both had the bug: `link.ts`
 * for the reference pages' type annotations, `resolver.ts` for prose tables.
 */
const here = dirname(fileURLToPath(import.meta.url))
const PY_INV = join(here, '../../../site/src/data/inventories/python.inv')
const OTHER_PORTS = ['ts', 'rs', 'go', 'java', 'dotnet', 'cxx', 'swift']

/** Names that are Python's and also perfectly ordinary in other languages. */
const POACHED = [
  'time.Time', // Go
  'os.File', // Go
  'time.Duration', // Go
  'io.Reader', // Go
  'Optional', // Java
  'Exception', // Java, .NET
  'bool',
  'int',
  'str',
  'list',
  'object',
  'Path',
]

describe('inventories are scoped to their own language', () => {
  const entries = existsSync(PY_INV) ? readInventory(readFileSync(PY_INV)).entries : []

  it.runIf(entries.length)('SymbolIndex: no port but py reaches docs.python.org', () => {
    for (const port of OTHER_PORTS) {
      const index = new SymbolIndex([], (s) => `#${s.id}`, port)
      index.addInventory('https://docs.python.org/3/', entries, ['py'])
      for (const name of POACHED) {
        const hit = index.resolve(name)
        expect(hit?.href ?? '', `${port} resolved ${name}`).not.toContain('docs.python.org')
      }
    }
  })

  it.runIf(entries.length)('SymbolIndex: py still reaches it', () => {
    const index = new SymbolIndex([], (s) => `#${s.id}`, 'py')
    index.addInventory('https://docs.python.org/3/', entries, ['py'])
    expect(index.resolve('str')?.href).toContain('docs.python.org')
    expect(index.resolve('ValueError')?.href).toContain('docs.python.org')
  })

  it('SymbolIndex: an index with no language declared invents nothing', () => {
    // Undefined must mean "no language-specific fallbacks", never "assume
    // Python" — a caller that forgets should lose links, not gain wrong ones.
    const index = new SymbolIndex([], (s) => `#${s.id}`)
    expect(index.resolve('str')).toBeUndefined()
    expect(index.resolve('time.Time')).toBeUndefined()
  })

  it.runIf(entries.length)('Resolver: prose tables do not cross languages', () => {
    const r = new Resolver([])
    r.addInventory('Python', 'https://docs.python.org/3/', entries, ['py'])
    for (const port of OTHER_PORTS) {
      for (const name of [...POACHED, 'Stream.filter()']) {
        const res = r.resolve(port, name)
        expect(
          res.how === 'federated' ? res.project : '',
          `${port} resolved ${name}`,
        ).not.toBe('Python')
      }
    }
  })

  it.runIf(entries.length)('Resolver: a tail match is not a match', () => {
    // `Stream.filter()` once resolved to Python's builtin `filter` because a
    // failed lookup of the full name fell back to the last segment.
    const r = new Resolver([])
    r.addInventory('Python', 'https://docs.python.org/3/', entries, ['py'])
    const res = r.resolve('py', 'Stream.filter()')
    expect(res.how).not.toBe('federated')
  })
})

/**
 * A type is not ambiguous with its own constructor.
 *
 * C++, C# and Java name a constructor after its class, so a bare `Window`
 * matched `libtmux::Window` and `libtmux::Window::Window` alike and the
 * resolver refused. Genuine contests must still refuse, which is what the
 * second half of this test pins down: dropping the constructor must not
 * become "prefer any type", or Rust's three same-named `Error` types would
 * silently pick one.
 */
describe('constructors do not contest their own type', () => {
  const model = (port: string, symbols: { id: string; name: string; kind: string; parent?: string }[]) => ({
    port,
    version: '0',
    symbols: symbols.map((s) => ({ ...s, signatures: [], docs: [] })),
  })

  it('a class beats its constructor', () => {
    const r = new Resolver([
      model('cxx', [
        { id: 'libtmux::Window', name: 'Window', kind: 'class' },
        { id: 'libtmux::Window::Window', name: 'Window', kind: 'method', parent: 'libtmux::Window' },
      ]),
    ] as never)
    const res = r.resolve('cxx', 'Window')
    expect(res.how).toBe('unique')
    expect(res.how === 'unique' && res.symbol.id).toBe('libtmux::Window')
  })

  it('two unrelated types of one name still refuse', () => {
    const r = new Resolver([
      model('rs', [
        { id: 'error.Error', name: 'Error', kind: 'enum' },
        { id: 'error.refusal.Error', name: 'Error', kind: 'class' },
      ]),
    ] as never)
    expect(r.resolve('rs', 'Error').how).toBe('ambiguous')
  })

  it('one method on two receivers still refuses', () => {
    const r = new Resolver([
      model('go', [
        { id: 'tmux.Server', name: 'Server', kind: 'struct' },
        { id: 'tmux.Session', name: 'Session', kind: 'struct' },
        { id: 'tmux.Server.Open', name: 'Open', kind: 'method', parent: 'tmux.Server' },
        { id: 'tmux.Session.Open', name: 'Open', kind: 'method', parent: 'tmux.Session' },
      ]),
    ] as never)
    expect(r.resolve('go', 'Open').how).toBe('ambiguous')
  })

  it("Swift's labelled selectors are reachable by their bare name", () => {
    // The symbol graph names a method `unsetEnvironment(_:in:)`; prose writes
    // `unsetEnvironment`. Both must find it.
    const r = new Resolver([
      model('swift', [
        { id: 'TmuxServer.unsetEnvironment(_:in:)', name: 'unsetEnvironment(_:in:)', kind: 'method' },
      ]),
    ] as never)
    expect(r.resolve('swift', 'unsetEnvironment').how).toBe('unique')
  })
})

/**
 * A module name is derived, not recorded.
 *
 * Prose refers to `libtmux.neo`, `LibTmux.Testing` and `libtmux::test` — none
 * of which is a symbol, and all of which were unresolvable because no
 * extractor emits a module as an entity. Splitting a public id on its own
 * separator is enough, and it has to handle `::` as one separator rather than
 * two characters.
 */
describe('module names', () => {
  const sym = (id: string, name: string) =>
    ({ id, name, kind: 'class', signatures: [], docs: [] }) as never

  it('reads a module off a public id in every separator style', () => {
    expect(moduleOf(sym('libtmux.neo.Obj', 'Obj'))).toBe('libtmux.neo')
    expect(moduleOf(sym('libtmux::test::Fixture', 'Fixture'))).toBe('libtmux::test')
    expect(moduleOf(sym('LibTmux.Testing.Scope', 'Scope'))).toBe('LibTmux.Testing')
    expect(moduleOf(sym('tmux.Server', 'Server'))).toBe('tmux')
  })

  it('a bare name has no module', () => {
    expect(moduleOf(sym('Server', 'Server'))).toBe('')
  })

  it('lists modules shallowest first and excludes members', () => {
    const mods = modulesIn({
      port: 'py',
      symbols: [
        sym('libtmux.neo.Obj', 'Obj'),
        sym('libtmux.neo.Fetch', 'Fetch'),
        sym('libtmux.Server', 'Server'),
        sym('libtmux.Session', 'Session'),
        { ...(sym('libtmux.Server.kill', 'kill') as object), parent: 'libtmux.Server' } as never,
      ],
    } as never)
    expect(mods.map((m) => m.name)).toEqual(['libtmux', 'libtmux.neo'])
    // Two top-level symbols; `kill` belongs to Server's page, not the module.
    expect(mods[0].symbols).toHaveLength(2)
  })

  it('reports no modules when grouping would not group', () => {
    // One module per symbol is a flat list wearing a costume — .NET's docfx
    // ids produced 243 headings for 239 cards.
    const mods = modulesIn({
      port: 'dotnet',
      symbols: [
        sym('Exceptions.LibTmuxException.LibTmuxException', 'LibTmuxException'),
        sym('Requests.SendKeysRequest.SendKeysRequest', 'SendKeysRequest'),
      ],
    } as never)
    expect(mods).toEqual([])
  })
})

/**
 * A module name in prose resolves to that module's section.
 *
 * `libtmux::test` arrives from `toPath` as `libtmux.test`, so the lookup is
 * separator-insensitive while the destination keeps the spelling the language
 * uses for its anchor.
 */
describe('modules resolve as destinations', () => {
  const sym = (id: string, name: string) =>
    ({ id, name, kind: 'class', signatures: [], docs: [] }) as never
  const r = new Resolver([
    {
      port: 'py',
      symbols: [
        sym('libtmux.neo.Obj', 'Obj'),
        sym('libtmux.neo.Fetch', 'Fetch'),
        sym('libtmux.Server', 'Server'),
        sym('libtmux.Session', 'Session'),
      ],
    },
    {
      port: 'cxx',
      symbols: [
        sym('libtmux::test::Fixture', 'Fixture'),
        sym('libtmux::test::Harness', 'Harness'),
        sym('libtmux::Window', 'Window'),
        sym('libtmux::Pane', 'Pane'),
      ],
    },
  ] as never)

  it('finds a nested module', () => {
    const res = r.resolve('py', 'libtmux.neo')
    expect(res.how).toBe('module-index')
    expect(res.how === 'module-index' && res.module).toBe('libtmux.neo')
  })

  it('does not resolve an enclosing module that has no section', () => {
    // `libtmux.neo` holds symbols directly and gets a section;
    // `libtmux.nothing` does not exist at all. Resolving a module with no
    // section produced the one broken anchor left in the build.
    expect(r.resolve('py', 'libtmux.nothing').how).not.toBe('module-index')
  })

  it('a type is not a module, even though a member sits below it', () => {
    const withMember = new Resolver([
      {
        port: 'py',
        symbols: [
          sym('libtmux.Server', 'Server'),
          { ...(sym('libtmux.Server.kill', 'kill') as object), parent: 'libtmux.Server' } as never,
        ],
      },
    ] as never)
    expect(withMember.resolve('py', 'libtmux.Server').how).toBe('module')
  })

  it("keeps C++'s spelling while matching the normalised form", () => {
    const res = r.resolve('cxx', 'libtmux::test')
    expect(res.how === 'module-index' && res.module).toBe('libtmux::test')
  })

  it('does not invent a module for another port', () => {
    expect(r.resolve('py', 'libtmux::test').how).not.toBe('module-index')
  })
})

/**
 * A real symbol beats a module that only looks like one.
 *
 * docfx names a generated file after the member it documents, so
 * `Server.FromEnvironment` is simultaneously a method and a module path. Run
 * before symbol resolution, the module step claimed the name and sent readers
 * to a heading instead of the method they had just read about.
 */
it('prefers a method over a same-named module path', () => {
  const r = new Resolver([
    {
      port: 'dotnet',
      symbols: [
        { id: 'Server.FromEnvironment.Server', name: 'Server', kind: 'class', signatures: [], docs: [] },
        {
          id: 'Server.FromEnvironment.Server.FromEnvironment',
          name: 'FromEnvironment',
          kind: 'method',
          parent: 'Server.FromEnvironment.Server',
          signatures: [],
          docs: [],
        },
      ],
    },
  ] as never)
  const res = r.resolve('dotnet', 'Server.FromEnvironment')
  expect(res.how).toBe('unique')
  expect(res.how === 'unique' && res.symbol.name).toBe('FromEnvironment')
})

/**
 * An enum's variants are part of its API.
 *
 * Every spec extracted an enum's *methods* and none of them extracted what the
 * enum is, so `Subscription.Session`, `TmuxDispatchState.Unknown` and
 * `OperationOutcome.COMPLETE` were named in prose and existed nowhere in the
 * reference. 565 symbols across three ports.
 *
 * Two of the three needed a visibility exemption as well as a member mapping,
 * which is the same mistake that once hid every Rust method: a variant is as
 * public as its enum and there is no syntax to say otherwise, so a test for
 * `pub` or `public` rejects all of them. Adding the member mapping alone
 * changed nothing, which is why this asserts on real extracted models rather
 * than on the spec tables.
 */
describe('enum variants reach the model', () => {
  const cases: { port: string; enumName: string; variant: string }[] = [
    { port: 'rs', enumName: 'Subscription', variant: 'Session' },
    { port: 'dotnet', enumName: 'TmuxDispatchState', variant: 'NotDispatched' },
    { port: 'java', enumName: 'OperationOutcome', variant: 'COMPLETE' },
    // C++ comes from Doxygen, which nests an enum's values inside the enum's
    // own <memberdef> rather than emitting one each — a different miss from
    // the tree-sitter ports, with the same result: 21 enums, 0 members.
    { port: 'cxx', enumName: 'BackendKind', variant: 'subprocess' },
  ]

  for (const { port, enumName, variant } of cases) {
    const path = join(here, `../../../site/src/data/api/${port}.json`)
    it.runIf(existsSync(path))(`${port}: ${enumName}.${variant}`, () => {
      const model = JSON.parse(readFileSync(path, 'utf8')) as {
        symbols: { id: string; name: string; kind: string; parent?: string }[]
      }
      const owner = model.symbols.find((s) => s.kind === 'enum' && s.name === enumName)
      expect(owner, `${port} has no enum named ${enumName}`).toBeDefined()
      const variants = model.symbols.filter((s) => s.parent === owner?.id)
      expect(variants.map((v) => v.name)).toContain(variant)
    })
  }

  it.runIf(existsSync(join(here, '../../../site/src/data/api/rs.json')))(
    'every enum with variants has them attached, not floating',
    () => {
      const model = JSON.parse(
        readFileSync(join(here, '../../../site/src/data/api/rs.json'), 'utf8'),
      ) as { symbols: { id: string; kind: string; parent?: string }[] }
      const enumIds = new Set(model.symbols.filter((s) => s.kind === 'enum').map((s) => s.id))
      const attached = model.symbols.filter((s) => s.parent && enumIds.has(s.parent))
      expect(attached.length).toBeGreaterThan(100)
    },
  )
})

/**
 * The JDK and the web platform, federated from indexes they do publish.
 *
 * Neither ships an `objects.inv`. Both publish a complete index in another
 * shape — javadoc's `type-search-index.js` and `member-search-index.js`, and
 * the `.d.ts` files TypeScript itself resolves against — so
 * `scripts/build-inventories.mjs` converts rather than invents.
 *
 * The alternative, and what was here before, is a URL template that guesses:
 * `?q=Stream.filter` into a search page. That resolves every name including
 * the ones that do not exist, which is the failure this subsystem exists to
 * avoid.
 */
describe('JDK and DOM federation', () => {
  const invDir = join(here, '../../../site/src/data/inventories')
  const load = (file: string) => {
    const path = join(invDir, file)
    return existsSync(path) ? readInventory(readFileSync(path)) : undefined
  }

  const jdk = load('jdk.inv')
  const dom = load('dom.inv')

  const resolver = () => {
    const r = new Resolver([])
    if (jdk) {
      r.addInventory(
        'Java SE',
        'https://docs.oracle.com/en/java/javase/21/docs/api/',
        jdk.entries,
        ['java'],
      )
    }
    if (dom) r.addInventory('MDN', 'https://developer.mozilla.org/', dom.entries, ['ts'])
    return r
  }

  it.runIf(jdk)('resolves Stream.filter() for Java, which the goal named', () => {
    const res = resolver().resolve('java', 'Stream.filter()')
    expect(res.how).toBe('federated')
    expect(res.how === 'federated' && res.href).toContain('java/util/stream/Stream.html')
  })

  it.runIf(jdk)('resolves a bare JDK type name as prose writes it', () => {
    // Prose writes `Optional`, not `java.util.Optional`.
    const res = resolver().resolve('java', 'Optional')
    expect(res.how === 'federated' && res.href).toContain('java/util/Optional.html')
  })

  it.runIf(dom)('resolves Promise for TypeScript, which the goal named', () => {
    const res = resolver().resolve('ts', 'Promise')
    expect(res.how).toBe('federated')
    // A language builtin, not a DOM interface. MDN files the two apart and so
    // must the inventory: `Web/API/Promise` is a page that does not exist.
    expect(res.how === 'federated' && res.href).toContain(
      'Web/JavaScript/Reference/Global_Objects/Promise',
    )
  })

  it.runIf(dom)('keeps DOM interfaces under Web/API', () => {
    const res = resolver().resolve('ts', 'AbortController')
    expect(res.how === 'federated' && res.href).toContain('Web/API/AbortController')
  })

  it.runIf(jdk && dom)('neither answers for a language it does not describe', () => {
    const r = resolver()
    for (const port of ['py', 'rs', 'go', 'dotnet', 'cxx', 'swift']) {
      for (const name of ['Optional', 'Promise', 'Stream.filter()', 'List']) {
        expect(r.resolve(port, name).how, `${port} resolved ${name}`).not.toBe('federated')
      }
    }
  })

  it.runIf(jdk)('carries no Swing or compiler internals', () => {
    // Every entry is a name the resolver might match, so a bigger inventory is
    // a wider surface for a wrong link, not a better one.
    const stray = jdk!.entries.filter((e) => /^(javax|com\.sun|jdk|org\.w3c)\./.test(e.name))
    expect(stray.slice(0, 5).map((e) => e.name)).toEqual([])
  })
})
