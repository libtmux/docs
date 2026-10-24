import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { API_HOSTS, EXTERNAL_INVENTORIES, PAGE_EXCEPTIONS, addressSegments, apiHostOf, arityOf, collectApiDestinations, qualified, terminalSymbol, urlsIn } from '../../scripts/lib/api-destinations.mjs'
import { addressOf, mismatch } from '../../scripts/lib/api-addresses.mjs'
import { judge, judgeLabel, pageIdentity, sourceIdentity } from '../../scripts/lib/api-identities.mjs'
import { PORT_LANGUAGES, languageOfUrl, languageProblem, loadReviewedLinks, doccHeading } from '../../scripts/lib/api-links.mjs'
import { BARE_OWNERS, DEFAULT_NAMES, bareOwners, hintOwners } from '../../scripts/lib/api-sources.mjs'
import { pageHeading } from '../../scripts/lib/api-html.mjs'
import { linksIn } from '../../scripts/lib/api-destinations.mjs'
import {
  INVENTORY_SOURCES, MAX_UNVERIFIABLE_SHARE, UNVERIFIABLE_REASONS, checkApiEvidence, expectationsOf, expectedSymbols, inventoryDigest, mentions, needsCheck, readPage, recordProblems, sameAddress, sectionAt, slugSymbol,
} from '../../scripts/lib/api-destination-verification.mjs'
import evidence from '../src/data/api-destination-evidence.json'

const root = new URL('../../', import.meta.url).pathname
const destinations = collectApiDestinations({ root })
const today = new Date(`${evidence.checkedAt}T12:00:00Z`)

describe('API destination evidence', () => {
  it('holds a passing record for every destination the site generates, and none for a link nothing makes', () => {
    const { problems } = checkApiEvidence(destinations, evidence, { today, root })
    expect(problems).toEqual([])
  })

  it('never records an unreadable host as passing', () => {
    for (const record of evidence.destinations as { url: string; ok: boolean; unverifiable?: string; failure?: string; detail?: string }[]) {
      if (record.unverifiable) {
        expect(record.ok, record.url).toBe(false)
        expect(UNVERIFIABLE_REASONS.some((reason) => reason.test(record.unverifiable!)), `${record.url}: ${record.unverifiable}`).toBe(true)
      } else if (!record.ok) {
        expect(record.failure, record.url).toBeTruthy()
        expect(record.detail, record.url).toBeTruthy()
      }
    }
  })

  it('requires a page that answers 200 at its own address, and a verdict for each name', () => {
    for (const record of evidence.destinations as { url: string; ok: boolean; status: number; finalUrl?: string; checkedAt: string; terminal?: { symbol: string; at: string }[] }[]) {
      expect(record.url, 'https url').toMatch(/^https:\/\//)
      expect(record.checkedAt, record.url).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      if (!record.ok) continue
      expect(record.status, record.url).toBe(200)
      expect(record.finalUrl, `${record.url} is a redirect`).toBeUndefined()
      const destination = destinations.get(record.url)
      if (!destination) continue
      expect(needsCheck(destination, record), record.url).toBe(false)
    }
  })

  it('names every cached inventory, each checked against its host and still holding the entries it was checked with', () => {
    expect(evidence.inventories.map((record) => record.name).sort()).toEqual(Object.keys(INVENTORY_SOURCES).sort())
    for (const record of evidence.inventories as { name: string; ok: boolean; missing: number; digest: string }[]) {
      expect(record.ok, record.name).toBe(true)
      expect(record.missing, record.name).toBe(0)
      const entries = JSON.parse(readFileSync(new URL(`../src/data/inventories/${record.name}.entries.json`, import.meta.url), 'utf8')).e as [string, string][]
      expect(record.digest, record.name).toBe(inventoryDigest(entries))
    }
  })

  it('keeps a manual\'s own labels out of the inventories, so a name never means one', () => {
    for (const name of ['python', 'julia']) {
      const { e } = JSON.parse(readFileSync(new URL(`../src/data/inventories/${name}.entries.json`, import.meta.url), 'utf8')) as { e: [string, string][] }
      const names = new Set(e.map(([entry]) => entry))
      for (const label of name === 'python' ? ['search', 'default', 'genindex', 'modindex'] : ['index', 'Level-6']) expect(names.has(label), `${name}: ${label}`).toBe(false)
    }
  })

  it('holds one record for each address', () => {
    const urls = (evidence.destinations as { url: string }[]).map((record) => record.url)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('lists the same inventories the reference and the prose linker attach', () => {
    for (const file of ['src/lib/api-models.ts', 'src/lib/prose-resolver.ts']) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
      for (const { baseUrl, langs } of EXTERNAL_INVENTORIES) {
        const attached = new RegExp(`baseUrl: '${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}',\\s*langs: \\[([^\\]]*)\\]`).exec(source)
          ?? new RegExp(`langs: \\[([^\\]]*)\\][^}]*baseUrl: '${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`).exec(source)
          ?? new RegExp(`baseUrl: '${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'[^}]*langs: \\[([^\\]]*)\\]`).exec(source)
        expect(attached, `${file} attaches ${baseUrl}`).not.toBeNull()
        expect([...attached![1]!.matchAll(/'(\w+)'/g)].map(([, lang]) => lang), `${file} ${baseUrl}`).toEqual(langs)
      }
    }
  })
})

describe('what the verifier reads from a page', () => {
  it('matches a symbol as a whole word, never inside another', () => {
    expect(mentions('SetAlgebra Protocol', 'Set')).toBe(false)
    expect(mentions('Set (Java SE 21 & JDK 21)', 'Set')).toBe(true)
    // An underscore joins words into one name: `map` is not in `unordered_map` or `map_or`.
    expect(mentions('the_iterable_protocol', 'iterable')).toBe(false)
    expect(mentions('std::unordered_map', 'map')).toBe(false)
    expect(mentions('std::map', 'map')).toBe(true)
    expect(mentions('std-fixture-tmp_path', 'tmp_path')).toBe(true)
    expect(mentions('Vector in std::vector - Rust', 'Vec')).toBe(false)
    expect(mentions('Base.sort!', 'sort')).toBe(false)
    expect(mentions('map_or', 'map')).toBe(false)
  })

  it('opens the text after a heading when the anchor wraps the heading', () => {
    const html = '<html><head><title>Annotations</title></head><body>'
      + '<div id="documenting-types"><a href="#documenting-types">link</a><h2>Documenting Types</h2></div>'
      + '<p>Recognized types: <code>nil</code>, <code>any</code>.</p><h2 id="next">Next</h2></body></html>'
    const page = readPage(html)
    expect(page.anchors.map((anchor) => anchor.id)).toEqual(['documenting-types', 'next'])
    expect(page.headings.map((heading) => heading.text)).toEqual(['Documenting Types', 'Next'])
  })

  it('joins the words a page breaks with <wbr>, as Microsoft Learn does', () => {
    expect(readPage('<h1>File<wbr>Info Class</h1>').headings[0]?.text).toBe('FileInfo Class')
  })

  it('treats a locale, a view and a trailing slash as the same address, and a moved page as another', () => {
    expect(sameAddress('https://learn.microsoft.com/dotnet/api/system.string', 'https://learn.microsoft.com/en-us/dotnet/api/system.string?view=net-10.0')).toBe(true)
    expect(sameAddress('https://example.org/a/b/', 'https://example.org/a/b')).toBe(true)
    expect(sameAddress('https://en.cppreference.com/w/cpp/container/vector', 'https://en.cppreference.com/cpp/container/vector')).toBe(false)
    expect(sameAddress('https://hexdocs.pm/elixir/Enum.html', 'https://elixir.hexdocs.pm/Enum.html')).toBe(false)
    expect(sameAddress('https://docs.junit.org/current/api/x.html', 'https://docs.junit.org/6.1.3/api/x.html')).toBe(false)
    // A path's case is part of its name: MDN answers /map with a redirect to /Map.
    expect(sameAddress('https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/map', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map')).toBe(false)
  })

  it('reads the symbol a name asks for, and the one an address names', () => {
    expect(terminalSymbol('java', 'Optional.of')).toBe('of')
    expect(terminalSymbol('java', 'java.util.concurrent.Flow.Publisher')).toBe('Publisher')
    expect(terminalSymbol('csharp', 'int')).toBe('Int32')
    expect(terminalSymbol('elixir', 'Enum.member?/2')).toBe('member?')
    expect(terminalSymbol('ts', 'ReadonlyMap')).toBe('Map')
    expect(terminalSymbol('powershell', 'Get-Member')).toBe('Get-Member')
    expect(slugSymbol('https://doc.rust-lang.org/std/vec/struct.Vec.html')).toBe('Vec')
    expect(slugSymbol('https://learn.microsoft.com/dotnet/api/system.threading.tasks.task.whenall')).toBe('whenall')
    expect(slugSymbol('https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Optional.html#of(T)')).toBe('Optional')
    expect(slugSymbol('https://kotlinlang.org/api/core/kotlin-stdlib/kotlin.time/to-kotlin-duration.html')).toBe('to-kotlin-duration')
    expect(slugSymbol('https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_commonparameters?view=powershell-7.4')).toBe('commonparameters')
  })

  it('ends a fragment\'s section at the next entry, not at the next heading', () => {
    const entries = '<h1>Built-in Functions</h1><dl><dt id="abs">abs(x)</dt><dd>Return the absolute value of an int.</dd><dt id="int">int(x)</dt><dd>Return an integer.</dd></dl><h2 id="later">Later</h2>'
    const page = readPage(`<html><head><title>Built-in Functions</title></head><body>${entries}</body></html>`)
    expect(sectionAt(page, 'abs')).toContain('absolute value of an int')
    expect(sectionAt(page, 'abs')).not.toContain('Return an integer')
    expect(sectionAt(page, 'int')).toBe('int(x) Return an integer.')
  })

  it('opens the text after a heading when the anchor is inside it, as the JLS writes it', () => {
    const page = readPage('<html><body><h3 class="title"><a name="jls-4.2.1"></a>4.2.1. Integral Types</h3><p><a name="jls-4.2.1-100"></a>The values of byte, short and int.</p><h3><a name="jls-4.2.2"></a>4.2.2. Operations</h3></body></html>')
    expect(sectionAt(page, 'jls-4.2.1')).toBe('The values of byte, short and int.')
  })

  it('reads the path an address spells, to the member its fragment names', () => {
    const path = (url: string) => addressOf(url)?.path
    expect(path('https://doc.rust-lang.org/std/io/struct.Error.html')).toEqual(['std', 'io', 'Error'])
    expect(path('https://doc.rust-lang.org/std/iter/trait.Iterator.html#method.next')).toEqual(['std', 'iter', 'Iterator', 'next'])
    expect(path('https://pkg.go.dev/errors#Join')).toEqual(['errors', 'Join'])
    expect(path('https://pkg.go.dev/github.com/modelcontextprotocol/go-sdk@v1.6.1/mcp#Transport')).toEqual(['github.com', 'modelcontextprotocol', 'go-sdk', 'mcp', 'Transport'])
    expect(path('https://docs.python.org/3/library/warnings.html#warnings.warn')).toEqual(['warnings', 'warn'])
    expect(path('https://docs.julialang.org/en/v1/base/base/#Core.String-Tuple%7BAbstractString%7D')).toEqual(['Core', 'String'])
    expect(path('https://elixir.hexdocs.pm/Enum.html#member?/2')).toEqual(['Enum', 'member?'])
    expect(addressOf('https://elixir.hexdocs.pm/Enum.html#member?/2')?.arity).toBe('2')
    expect(path('https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/Flow.Subscription.html#request(long)')?.slice(-8)).toEqual(['java', 'base', 'java', 'util', 'concurrent', 'Flow', 'Subscription', 'request'])
    expect(path('https://www.scala-lang.org/api/3.x/scala/util/Using$.html#resource-fffffb81')).toEqual(['api', '3', 'x', 'scala', 'util', 'Using', 'resource'])
    expect(path('https://learn.microsoft.com/dotnet/api/system.collections.generic.ienumerable-1')).toEqual(['system', 'collections', 'generic', 'ienumerable'])
    expect(path('https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_commonparameters?view=powershell-7.4')).toEqual(['microsoft', 'powershell', 'core', 'about', 'commonparameters'])
    // A fragment that is a heading names no entry, and a host with no symbol address has none to read.
    expect(addressOf('https://docs.python.org/3/glossary.html#term-generator')?.fragment).toBe('heading')
    expect(addressOf('https://elixir.hexdocs.pm/typespecs.html#basic-types')?.fragment).toBe('heading')
    expect(addressOf('https://en.cppreference.com/cpp/container/vector')).toBeUndefined()
    expect(addressOf('https://www.lua.org/manual/5.4/manual.html#2.1')).toBeUndefined()
  })

  it('ends a name at the address, whole: the symbol, then each package, module or type before it', () => {
    const rust = addressOf('https://doc.rust-lang.org/std/io/struct.Error.html')!
    expect(mismatch(['Error'], rust)).toBeUndefined()
    expect(mismatch(['io', 'Error'], rust)).toBeUndefined()
    expect(mismatch(['std', 'io', 'Error'], rust)).toBeUndefined()
    expect(mismatch(['std', 'fmt', 'Error'], rust)).toBe('owner')
    expect(mismatch(['Errors'], rust)).toBe('symbol')
    // An identifier is compared whole: `sort` is not `sort!`, nor `warn` the `warn_explicit` beside it.
    expect(mismatch(['Base', 'sort'], addressOf('https://docs.julialang.org/en/v1/base/sort/#Base.sort!')!)).toBe('symbol')
    expect(mismatch(['warnings', 'warn'], addressOf('https://docs.python.org/3/library/warnings.html#warnings.warn_explicit')!)).toBe('symbol')
    expect(mismatch(['os', 'path', 'join'], addressOf('https://docs.python.org/3/builtins/stdtypes.html#str.join')!)).toBe('owner')
    expect(mismatch(['System', 'Threading', 'Timer'], addressOf('https://learn.microsoft.com/dotnet/api/system.timers.timer')!)).toBe('owner')
    expect(mismatch(['System', 'Threading', 'Timer'], addressOf('https://learn.microsoft.com/dotnet/api/system.threading.timer')!)).toBeUndefined()
    expect(mismatch(['errors', 'Join'], addressOf('https://pkg.go.dev/strings#Join')!)).toBe('owner')
  })

  it('writes a name as its address would: aliases applied, the root marker and an operand count off', () => {
    expect(addressSegments('go', 'sdk.Transport')).toEqual(['sdk', 'Transport'])
    expect(addressSegments('scala', 'cats.effect.Async')).toEqual(['cats', 'effect', 'kernel', 'Async'])
    expect(addressSegments('scala', '_root_.cats.effect.IO')).toEqual(['cats', 'effect', 'IO'])
    expect(arityOf('Enum.map/2')).toBe('2')
    expect(arityOf('HTTP/2')).toBe('2')
    expect(arityOf('Enum.map')).toBeUndefined()
    expect(qualified({ imports: { t: 'typing' } } as never, 't.Generic')).toBe('typing.Generic')
    expect(qualified({} as never, 't.Generic')).toBe('t.Generic')
  })

  it('attaches a reviewed exception to one name at one exact address, and to no other', () => {
    const uses = (port: string, name: string) => [{ port, name, source: 'builtin' }]
    const at = (url: string, port: string, name: string) => expectationsOf({ url, uses: uses(port, name) })[0]?.exception
    expect(at('https://en.cppreference.com/cpp/chrono/duration', 'cxx', 'std::chrono::milliseconds')?.tier).toBe('listed')
    expect(at('https://en.cppreference.com/cpp/chrono/steady_clock', 'cxx', 'std::chrono::milliseconds')).toBeUndefined()
    expect(at('https://en.cppreference.com/cpp/chrono/duration', 'cxx', 'std::chrono::hours')).toBeUndefined()
    expect(at('https://en.cppreference.com/cpp/container/vector', 'cxx', 'bool')).toBeUndefined()
    expect(at('https://www.lua.org/manual/5.4/manual.html#2.1', 'lua', 'nil')?.tier).toBe('section')
    expect(at('https://www.lua.org/manual/5.4/manual.html#2.2', 'lua', 'nil')).toBeUndefined()
    expect(at('https://docs.oracle.com/javase/specs/jls/se21/html/jls-4.html#jls-4.2.5', 'java', 'boolean')?.tier).toBe('section')
    expect(at('https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html#jls-14.9', 'java', 'boolean')).toBeUndefined()
    expect(at('https://elixir.hexdocs.pm/typespecs.html#basic-types', 'elixir', 'atom')?.tier).toBe('section')
    expect(at('https://elixir.hexdocs.pm/typespecs.html#literals', 'elixir', 'atom')).toBeUndefined()
    expect(at('https://docs.python.org/3/builtins/functions.html#abs', 'py', 'int')).toBeUndefined()
    // Every exception names an address with a fragment or a page of its own, a reason, and at least one name.
    for (const entry of PAGE_EXCEPTIONS as unknown as { tier: string; url: string; names: string[]; reason: string }[]) {
      expect(['listed', 'section'], entry.url).toContain(entry.tier)
      expect(entry.reason.length, entry.url).toBeGreaterThan(20)
      expect(entry.names.length, entry.url).toBeGreaterThan(0)
      expect(entry.url, 'an address, not a prefix').not.toMatch(/#$/)
      expect(new URL(entry.url).pathname, 'an address, not a host').not.toBe('/')
    }
  })

  it('names the contradictions in a record, and what the evidence may leave open', () => {
    const passing = { url: 'https://docs.python.org/3/builtins/functions.html#int', host: 'docs.python.org', ok: true, status: 200, via: 'html', terminal: [{ symbol: 'int', at: 'fragment' }] }
    expect(recordProblems(passing)).toEqual([])
    expect(recordProblems({ ...passing, status: 404 })[0]).toMatch(/passing with the status 404/)
    expect(recordProblems({ ...passing, failure: 'fragment' })[0]).toMatch(/passing yet carries failure/)
    expect(recordProblems({ ...passing, finalUrl: 'https://example.org/' })[0]).toMatch(/passing yet carries finalUrl/)
    expect(recordProblems({ ...passing, host: 'example.org' })[0]).toMatch(/recorded under the host/)
    expect(recordProblems({ ...passing, via: undefined })[0]).toMatch(/without saying how the host was read/)
    expect(recordProblems({ ...passing, terminal: [{ symbol: 'int', at: 'heading' }] })[0]).toMatch(/never reports/)
    expect(recordProblems({ ...passing, terminal: [{ symbol: 'int', at: 'identity' }] })[0]).toMatch(/found by identity without the identity/)
    expect(recordProblems({ ...passing, ok: false })[0]).toMatch(/neither passes nor says why/)
    expect(recordProblems({ ...passing, ok: false, unverifiable: 'blocked' })[0]).toMatch(/no reason the verifier gives/)
    expect(recordProblems({ ...passing, ok: false, unverifiable: 'n/a' })[0]).toMatch(/no reason the verifier gives/)
    for (const reason of ['the request failed (EAI_AGAIN)', 'the host rate-limited the request (429)', 'the host blocks the request (403)', 'the page is rendered in the browser and serves no readable content']) {
      expect(recordProblems({ ...passing, ok: false, unverifiable: reason, status: 0, terminal: undefined })).toEqual([])
    }
    expect(MAX_UNVERIFIABLE_SHARE).toBeGreaterThan(0)
    expect(MAX_UNVERIFIABLE_SHARE).toBeLessThan(0.5)
  })

  it('asks a name once per symbol and ignores names that stand for a concept', () => {
    const destination = {
      url: 'https://example.org/x', host: 'example.org',
      uses: [
        { port: 'java', name: 'Optional', source: 'type' }, { port: 'java', name: 'java.util.Optional', source: 'prose' },
        { port: 'java', name: 'finally', source: 'keyword' }, { port: '', name: 'site/src/lib/api-glossary.ts', source: 'authored' },
      ],
    }
    expect(expectedSymbols(destination)).toEqual(['Optional'])
  })

  it('finds the links a text names without the punctuation around them', () => {
    expect(urlsIn('See [x](https://docs.python.org/3/library/re.html#re.sub), or https://go.dev/ref/spec#Constants.')).toEqual([
      'https://docs.python.org/3/library/re.html#re.sub', 'https://go.dev/ref/spec#Constants',
    ])
    expect(urlsIn('https://doc.rust-lang.org/std/${page}')).toEqual([])
  })

  it('knows which hosts document a language or an SDK', () => {
    expect(apiHostOf('https://pkg.go.dev/time#Duration')).toBe('pkg.go.dev')
    expect(apiHostOf('https://elixir.hexdocs.pm/Enum.html')).toBe('elixir.hexdocs.pm')
    expect(apiHostOf('https://github.com/libtmux/libtmux')).toBeUndefined()
    expect(API_HOSTS.has('docs.oracle.com')).toBe(true)
  })
})

describe('what a name says it is', () => {
  const identity = (port: string, name: string, extra: object = {}) => sourceIdentity({ port, name, source: 'builtin', ...extra })

  it('keeps the whole path after generics, calls and subscripts', () => {
    expect(identity('rs', 'Option<T>::map').segments).toEqual(['Option', 'map'])
    expect(identity('rs', 'Vec<u8>::push').segments).toEqual(['Vec', 'push'])
    expect(identity('cxx', 'std::vector<int>::push_back').segments).toEqual(['std', 'vector', 'push_back'])
    expect(identity('java', 'List<String>.add').segments).toEqual(['List', 'add'])
    expect(identity('rs', 'HashMap<K, V>::get').symbol).toBe('get')
  })

  it('reads the kind, the operand count and the parameters a name writes', () => {
    expect(identity('elixir', 't:Supervisor.child_spec/0')).toMatchObject({ kind: 'type', arity: 0, symbol: 'child_spec' })
    expect(identity('elixir', 'Application.start/2')).toMatchObject({ kind: 'member', arity: 2 })
    expect(identity('elixir', 'c:Application.start/2')).toMatchObject({ kind: 'callback' })
    expect(identity('csharp', 'ILogger<TCategoryName>')).toMatchObject({ arity: 1, kind: 'type' })
    expect(identity('csharp', 'IEnumerable').arity).toBe(1)
    expect(identity('java', 'Process.waitFor(long, TimeUnit)').params).toEqual(['long', 'TimeUnit'])
    expect(identity('java', 'System.getenv()').params).toEqual([])
    expect(identity('java', 'System.getenv').params).toBeUndefined()
    expect(identity('kotlin', 'Dispatchers').kind).toBe('object')
    expect(identity('kotlin', 'kotlinx.coroutines.Dispatchers.IO').kind).toBe('member')
    expect(identity('fsharp', 'Seq').kind).toBe('module')
    expect(identity('scala', 'Using').kind).toBe('object')
    expect(identity('ts', 'string')).toMatchObject({ symbol: 'String', aliased: true })
  })

  it('ties a Go qualifier to the import path it stands for', () => {
    const mcp = { path: ['github.com/modelcontextprotocol/go-sdk/mcp', 'Transport'], kind: 'type', declared: 'type' }
    expect(judge(identity('go', 'sdk.Transport'), mcp)).toBeUndefined()
    expect(judge(identity('go', 'mcp.Transport'), mcp)).toBeUndefined()
    expect(judge(identity('go', 'errors.Is'), { path: ['errors', 'Is'], kind: 'member', declared: 'function' })).toBeUndefined()
    expect(judge(identity('go', 'errors.Is'), { path: ['github.com/pkg/errors', 'Is'], kind: 'member', declared: 'function' })).toMatchObject({ failure: 'owner' })
    expect(judge(identity('go', 'template.New'), { path: ['html/template', 'New'], kind: 'member', declared: 'function' })).toMatchObject({ failure: 'owner' })
    expect(judge(identity('go', 'template.New'), { path: ['text/template', 'New'], kind: 'member', declared: 'function' })).toBeUndefined()
  })

  it('refuses a bare name no table gives an owner', () => {
    expect(judge(identity('java', 'Widget'), { path: ['com', 'example', 'Widget'], kind: 'type', declared: 'class' })).toMatchObject({ failure: 'owner' })
    expect(judge(identity('java', 'Duration'), { path: ['javax', 'xml', 'datatype', 'Duration'], kind: 'type', declared: 'class' })).toMatchObject({ failure: 'owner' })
    expect(judge(identity('java', 'Duration'), { path: ['java', 'time', 'Duration'], kind: 'type', declared: 'class' })).toBeUndefined()
    expect(judge(identity('java', 'IllegalArgumentException'), { path: ['java', 'lang', 'IllegalArgumentException'], kind: 'type', declared: 'class' })).toBeUndefined()
    expect(judge(identity('py', 'run'), { path: ['subprocess', 'run'], kind: 'member', declared: 'function' })).toMatchObject({ failure: 'owner' })
    expect(judge(identity('py', 'open'), { path: ['open'], kind: 'member', declared: 'function' })).toBeUndefined()
  })

  it('accepts a bare member written in the docs of a type that extends its owner, and no other', () => {
    const close = { path: ['java', 'lang', 'AutoCloseable', 'close'], kind: 'member', declared: 'method' }
    expect(judge(identity('scala', 'close()'), close)).toMatchObject({ failure: 'owner' })
    expect(judge(identity('scala', 'close()', { owners: ['AutoCloseable'] }), close)).toBeUndefined()
    expect(judge(identity('scala', 'close()', { owners: ['Comparable'] }), close)).toMatchObject({ failure: 'owner' })
  })

  it('tells a kind from a kind, and a page of the manual from a symbol', () => {
    expect(judge(identity('elixir', 'Application.start/2'), { path: ['Application', 'start'], kind: 'callback', declared: 'callback', arity: 2 })).toMatchObject({ failure: 'kind' })
    expect(judge(identity('scala', 'IO'), { path: ['cats', 'effect', 'IO'], kind: 'object', declared: 'object' })).toMatchObject({ failure: 'kind' })
    expect(judge(identity('py', 'default'), { path: ['default'], kind: 'other', declared: 'fragment' })).toMatchObject({ failure: 'kind' })
    expect(judge(identity('py', 'search'), { path: [], kind: 'other', declared: 'page' })).toMatchObject({ failure: 'kind' })
    expect(judge(identity('cxx', 'bool'), { path: ['bool'], kind: 'keyword', declared: 'keyword' })).toBeUndefined()
  })

  it('compares operand counts and parameter lists where the name writes them', () => {
    expect(judge(identity('csharp', 'ILogger'), { path: ['Microsoft', 'Extensions', 'Logging', 'ILogger'], kind: 'type', declared: 'interface', arity: 1, via: 'learn' })).toMatchObject({ failure: 'arity' })
    expect(judge(identity('elixir', 'Enum.reduce/2'), { path: ['Enum', 'reduce'], kind: 'member', declared: 'function', arity: 3, via: 'exdoc' })).toMatchObject({ failure: 'arity' })
    expect(judge(identity('java', 'System.getenv()'), { path: ['java', 'lang', 'System', 'getenv'], kind: 'member', declared: 'method', params: ['String'] })).toMatchObject({ failure: 'params' })
    expect(judge(identity('java', 'System.getenv'), { path: ['java', 'lang', 'System', 'getenv'], kind: 'member', declared: 'method', params: ['String'] })).toBeUndefined()
  })

  it('compares words on a link with the symbol the page documents', () => {
    const strip = { path: ['Base', 'strip'], kind: 'member', declared: 'function' }
    expect(judgeLabel('strip', strip)).toBeUndefined()
    expect(judgeLabel('`Base.strip`', strip)).toBeUndefined()
    expect(judgeLabel('lstrip', strip)).toMatchObject({ failure: 'label' })
    expect(judgeLabel('`tokio::select!`', { path: ['tokio', 'select'], kind: 'member', declared: 'macro' })).toBeUndefined()
  })

  it('finds the words of each link a text writes', () => {
    const links = linksIn('See [`a`](https://x.org/a) and [the b][b] or [c][missing].\n\n[b]: https://x.org/b\n{ title: \'Python classes\', url: \'https://docs.python.org/3/tutorial/classes.html\' }')
    expect([...links].map(([url, words]) => [url, [...words]])).toEqual([
      ['https://x.org/a', ['`a`']], ['https://x.org/b', ['the b']], ['https://docs.python.org/3/tutorial/classes.html', ['Python classes']],
    ])
  })
})

describe('what a page says it is', () => {
  const read = (url: string, html: string) => pageIdentity(url, readPage(`<html><head><title>${/<title>([^<]*)/.exec(html)?.[1] ?? ''}</title></head><body>${html}</body></html>`))

  it('reads rustdoc\'s title and heading', () => {
    const page = readPage('<html><head><title>Error in std::io - Rust</title></head><body><h1>Struct <span>Error</span></h1><section id="method.kind"></section></body></html>')
    expect(pageIdentity('https://doc.rust-lang.org/std/io/struct.Error.html', page)).toMatchObject({ kind: 'type', path: ['std', 'io', 'Error'] })
    expect(pageIdentity('https://doc.rust-lang.org/std/io/struct.Error.html#method.kind', page)).toMatchObject({ kind: 'member', path: ['std', 'io', 'Error', 'kind'] })
  })

  it('reads javadoc\'s package line and the parameters a member\'s anchor spells', () => {
    const page = readPage('<html><head><title>Process</title></head><body><div class="sub-title"><span class="package-label-in-type">Package</span>&nbsp;<a href="x">java.lang</a></div><h1>Class Process</h1><section id="method-detail"><section class="detail" id="waitFor(long,java.util.concurrent.TimeUnit)"></section></section></body></html>')
    const url = 'https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Process.html'
    expect(pageIdentity(url, page)).toMatchObject({ kind: 'type', path: ['java', 'lang', 'Process'] })
    expect(pageIdentity(`${url}#waitFor(long,java.util.concurrent.TimeUnit)`, page)).toMatchObject({ kind: 'member', path: ['java', 'lang', 'Process', 'waitFor'], params: ['long', 'TimeUnit'] })
  })

  it('reads a page of a host it knows, that declares nothing, as no symbol', () => {
    expect(read('https://docs.python.org/3/search.html', '<h1>Search</h1>')).toMatchObject({ kind: 'other', declared: 'page' })
    expect(read('https://www.typescriptlang.org/docs/handbook/utility-types.html', '<h1>Utility Types</h1>')).toBeUndefined()
  })

  it('reads MDN\'s title for a member and for an object', () => {
    const member = readPage('<html><head><title>AbortSignal: timeout() static method - Web APIs | MDN</title></head><body></body></html>')
    expect(pageIdentity('https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static', member)).toMatchObject({ path: ['AbortSignal', 'timeout'], kind: 'member' })
    const object = readPage('<html><head><title>Map - JavaScript | MDN</title></head><body></body></html>')
    expect(pageIdentity('https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map', object)).toMatchObject({ path: ['Map'], kind: 'type' })
  })
})

describe('what a link\'s words say', () => {
  const symbol = (path: string[], declared = 'function', via = 'documenter', extra: object = {}) => ({ path, kind: 'member', declared, via, ...extra })

  it('holds a name written whole to the owner and the member, and a bare Rust type to the module Rust gives it', () => {
    const optionMap = symbol(['std', 'option', 'Option', 'map'], 'method', 'rustdoc')
    const resultMap = symbol(['std', 'result', 'Result', 'map'], 'method', 'rustdoc')
    expect(judgeLabel('`Option::map`', optionMap)).toBeUndefined()
    expect(judgeLabel('`Option::map`', resultMap)).toMatchObject({ failure: 'label' })
    expect(judgeLabel('Option<T>::map', optionMap)).toBeUndefined()
    expect(judgeLabel('`Result`', { path: ['std', 'result', 'Result'], kind: 'type', declared: 'enum', via: 'rustdoc' })).toBeUndefined()
    expect(judgeLabel('`Result`', { path: ['std', 'fmt', 'Result'], kind: 'type', declared: 'type alias', via: 'rustdoc' })).toMatchObject({ failure: 'label' })
  })

  it('reads a call as its callee, and a mark that ends a name as part of it', () => {
    const map = symbol(['Base', 'map'])
    expect(judgeLabel('`map(f)`', map)).toBeUndefined()
    expect(judgeLabel('`map!(f)`', map)).toMatchObject({ failure: 'label' })
    expect(judgeLabel('`Ok(item)`', symbol(['std', 'result', 'Result', 'Ok'], 'variant', 'rustdoc'))).toBeUndefined()
    expect(judgeLabel('`Ok(None)`', symbol(['std', 'option', 'Option', 'None'], 'variant', 'rustdoc'))).toMatchObject({ failure: 'label' })
  })

  it('is the name and nothing else: no plural, stem or synonym stands for it', () => {
    const type = (name: string, ...owner: string[]) => ({ path: [...owner, name], kind: 'type', declared: 'class', via: 'javadoc' })
    expect(judgeLabel('`Files`', type('Files', 'java', 'nio', 'file'))).toBeUndefined()
    expect(judgeLabel('`Files`', type('File', 'java', 'io'))).toMatchObject({ failure: 'label' })
    expect(judgeLabel('`Paths`', type('Path', 'java', 'nio', 'file'))).toMatchObject({ failure: 'label' })
    expect(judgeLabel('`Objects`', type('Object', 'java', 'lang'))).toMatchObject({ failure: 'label' })
    expect(judgeLabel('`Collections`', type('Collection', 'java', 'util'))).toMatchObject({ failure: 'label' })
    expect(judgeLabel('`Collection`', type('Collection', 'java', 'util'))).toBeUndefined()
    expect(judgeLabel('`Where-Object`', type('Object', 'System'))).toMatchObject({ failure: 'label' })
  })

  it('does not take words that describe a page for a name: those are rows of the reviewed link table', () => {
    const commonParameters = { path: ['microsoft', 'powershell', 'core', 'CommonParameters'], kind: 'keyword', declared: 'about topic', via: 'learn' }
    expect(judgeLabel('PowerShell common parameters', commonParameters)).toMatchObject({ failure: 'label', detail: expect.stringContaining('reviewed link table') })
    expect(judgeLabel('Kotlin coroutines', { path: ['kotlinx', 'coroutines', 'CoroutineScope'], kind: 'type', declared: 'interface', via: 'dokka' })).toMatchObject({ failure: 'label' })
    expect(judgeLabel('`CommonParameters`', commonParameters)).toBeUndefined()
  })
})

describe('the reviewed link table', () => {
  const { rows, byPair } = loadReviewedLinks(root)

  it('has one row for each text and address, each with a heading, sorted so a review reads as the rows that changed', () => {
    expect(rows.length).toBeGreaterThan(0)
    expect(byPair.size).toBe(rows.length)
    for (const row of rows) {
      expect(row.label.trim(), row.url).toBe(row.label)
      expect(row.url, row.label).toMatch(/^https:\/\//)
      expect(row.heading.length, row.label).toBeGreaterThan(0)
      expect(row.heading, `${row.label} is a heading, one line`).toBe(row.heading.replace(/\s+/g, ' ').trim())
    }
    const keys = rows.map((row) => `${row.url}\u0000${row.label}`)
    expect(keys).toEqual([...keys].sort((a, b) => a.split('\u0000')[0].localeCompare(b.split('\u0000')[0]) || a.localeCompare(b)))
  })

  it('names a page by the heading its fragment opens, a section label, its address, or its title', () => {
    const opens = readPage('<html><head><title>Classes - Docs</title></head><body><h1>Docs</h1><h1>Classes</h1><h3 id="inheritance">9.5. Inheritance <a>\u00b6</a></h3><p>x</p><dt id="entry">entry</dt></body></html>')
    expect(pageHeading(opens, 'inheritance')).toBe('9.5. Inheritance')
    expect(pageHeading(opens, 'entry')).toBe('#entry')
    expect(pageHeading(opens, '', 'https://example.org/docs/classes.html')).toBe('Classes')
    const section = readPage('<html><head><title>[class.mem]</title></head><body><h1>11 Classes [class]</h1><h2>11.4 Class members [class.mem]</h2></body></html>')
    expect(pageHeading(section, '', 'https://eel.is/c++draft/class.mem')).toBe('11.4 Class members [class.mem]')
    // A page that ends in a sidebar heading, and a book whose title heads every page.
    const book = readPage('<html><head><title>Overload Resolution | Docs</title></head><body><h1>Overload Resolution</h1><h1>Contributors to this page</h1></body></html>')
    expect(pageHeading(book, '', 'https://example.org/reference/overload-resolution.html')).toBe('Overload Resolution')
    const rust = readPage('<html><head><title>Structs - The Rust Reference</title></head><body><h1>The Rust Reference</h1><h1>Structs</h1></body></html>')
    expect(pageHeading(rust, '', 'https://example.org/items/structs.html')).toBe('Structs')
    // A page whose title and heading differ, under a title bar that is the book's name.
    const loops = readPage('<html><head><title>Loop expressions - The Rust Reference</title></head><body><h1 class="menu-title">The Rust Reference</h1><h1>Loops and other breakable expressions</h1></body></html>')
    expect(pageHeading(loops, '', 'https://example.org/expressions/loop-expr.html')).toBe('Loops and other breakable expressions')
  })

  it('reads a DocC heading by its anchor, and a page by its title', () => {
    const data = { metadata: { title: 'Declarations' }, primaryContentSections: [{ content: [{ type: 'heading', anchor: 'Type-Alias-Declaration', text: 'Type Alias Declaration' }] }] }
    expect(doccHeading(data, 'Type-Alias-Declaration')).toBe('Type Alias Declaration')
    expect(doccHeading(data, '')).toBe('Declarations')
    expect(doccHeading(data, 'missing')).toBe('#missing')
  })

  it('reads the language of an address from its host and path, and holds a port to the languages it goes to', () => {
    expect(languageOfUrl('https://eel.is/c++draft/class.mem')).toBe('cpp')
    expect(languageOfUrl('https://go.dev/ref/spec#Constants')).toBe('go')
    expect(languageOfUrl('https://doc.rust-lang.org/reference/items.html')).toBe('rust')
    expect(languageOfUrl('https://docs.oracle.com/javase/specs/jls/se21/html/jls-8.html')).toBe('java')
    expect(languageOfUrl('https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/static')).toBe('csharp')
    expect(languageOfUrl('https://learn.microsoft.com/en-us/powershell/module/x/about/about_functions')).toBe('powershell')
    expect(languageOfUrl('https://learn.microsoft.com/dotnet/api/system.string')).toBe('dotnet')
    expect(languageProblem('rs', 'https://go.dev/ref/spec#Constants')).toMatchObject({ failure: 'language' })
    expect(languageProblem('go', 'https://go.dev/ref/spec#Constants')).toBeUndefined()
    // A JVM port goes to the JLS and the JDK; PowerShell, F# and C# share the .NET API.
    expect(languageProblem('kotlin', 'https://docs.oracle.com/javase/specs/jls/se21/html/jls-8.html')).toBeUndefined()
    expect(languageProblem('scala', 'https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/List.html')).toBeUndefined()
    expect(languageProblem('powershell', 'https://learn.microsoft.com/dotnet/api/system.string')).toBeUndefined()
    expect(languageProblem('fsharp', 'https://learn.microsoft.com/dotnet/api/system.string')).toBeUndefined()
    expect(languageProblem('py', 'https://docs.oracle.com/javase/specs/jls/se21/html/jls-8.html')).toMatchObject({ failure: 'language' })
    expect(languageProblem('fsharp', 'https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/static')).toMatchObject({ failure: 'language' })
    expect(Object.keys(PORT_LANGUAGES).length).toBeGreaterThan(10)
  })

  it('derives the words of a keyword link from its help title when the use carries none', () => {
    const keyword = (name: string) => expectationsOf({ url: 'https://eel.is/c++draft/dcl.attr.nodiscard', uses: [{ port: 'cxx', name, source: 'keyword' }] })[0]
    expect(keyword('nodiscard')).toMatchObject({ label: 'C++ nodiscard attribute', key: 'keyword:C++ nodiscard attribute', port: 'cxx' })
  })
})

describe('what a bare name means', () => {
  it('binds Scala\'s collections per name, as Predef and the package object do', () => {
    expect(bareOwners('scala', 'Map')).toEqual(['scala.collection.immutable'])
    expect(bareOwners('scala', 'Set')).toEqual(['scala.collection.immutable'])
    expect(bareOwners('scala', 'Seq')).toEqual(['scala.collection.immutable'])
    expect(bareOwners('scala', 'Iterator')).toEqual(['scala.collection'])
    expect(bareOwners('scala', 'Iterable')).toEqual(['scala.collection'])
    expect(bareOwners('scala', 'IterableOnce')).toEqual(['scala.collection'])
    expect(DEFAULT_NAMES.scala).not.toHaveProperty('Using')
    expect(bareOwners('scala', 'Using')).toEqual(['scala.util'])
    expect(bareOwners('scala', 'Widget')).toEqual(['scala', 'scala.Predef', 'java.lang'])
  })

  it('holds the F# owners to what the F# model\'s files open, and F# itself opens nothing from System', () => {
    const model = JSON.parse(readFileSync(new URL('../src/data/api/fsharp.json', import.meta.url), 'utf8')) as { symbols: { namespaceImports?: string[] }[] }
    const opened = new Set(model.symbols.flatMap((symbol) => symbol.namespaceImports ?? []))
    for (const owner of new Set(Object.values(BARE_OWNERS.fsharp))) expect(opened.has(owner), `the port's files open ${owner}`).toBe(true)
    expect(bareOwners('fsharp', 'Widget').some((scope: string) => scope.startsWith('System'))).toBe(false)
  })

  it('resolves a type named in extends exactly, and not by the end of someone else\'s name', () => {
    expect(hintOwners('rs', 'Error')).toEqual(['std.error.Error'])
    expect(hintOwners('scala', 'AutoCloseable')).toContain('java.lang.AutoCloseable')
    expect(hintOwners('scala', 'cats.Show')).toEqual(['cats.Show'])
    const source = sourceIdentity({ port: 'rs', name: 'source', source: 'doc', owners: ['Error'] })
    const member = (path: string[]) => ({ path, kind: 'member', declared: 'method', via: 'rustdoc' })
    expect(judge(source, member(['std', 'error', 'Error', 'source']))).toBeUndefined()
    expect(judge(source, member(['std', 'io', 'Error', 'source']))).toMatchObject({ failure: 'owner' })
  })

  it('reads a name as qualified when the port\'s files open the namespace', () => {
    const barrier = { path: ['System', 'Threading', 'Barrier'], kind: 'type', declared: 'class', via: 'learn', arity: 0 }
    expect(judge(sourceIdentity({ port: 'fsharp', name: 'Barrier', source: 'type', opens: ['System.Threading'] }), barrier)).toBeUndefined()
    expect(judge(sourceIdentity({ port: 'fsharp', name: 'Barrier', source: 'type', opens: ['System.IO'] }), barrier)).toMatchObject({ failure: 'owner' })
    expect(sourceIdentity({ port: 'fsharp', name: 'string' }).segments).toEqual(['System', 'String'])
  })

  it('reads a Dokka declaration by its leading keywords: a fun interface is an interface', () => {
    const page = (keywords: string[]) => readPage(`<html><head><title>X</title></head><body><div class="breadcrumbs"><a>core</a><span class="delimiter">/</span><a>kotlinx.coroutines.flow</a><span class="delimiter">/</span><span class="current">FlowCollector</span></div><div class="symbol monospace"><div class="block"><div class="block"><span class="token annotation builtin">@</span></div></div>${keywords.map((word) => `<span class="token keyword">${word} </span>`).join('')}<a href="x">FlowCollector</a>(<span class="token keyword">in</span> x)</div></body></html>`)
    const url = 'https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/-flow-collector/'
    expect(pageIdentity(url, page(['fun', 'interface']))).toMatchObject({ declared: 'interface', kind: 'type' })
    expect(pageIdentity(url, page(['suspend', 'fun']))).toMatchObject({ declared: 'function', kind: 'member' })
    expect(pageIdentity(url, page(['value', 'class']))).toMatchObject({ declared: 'class', kind: 'type' })
  })
})
