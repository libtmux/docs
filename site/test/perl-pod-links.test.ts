import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { API, SCHEMA, observeDistribution, podAnchors, problemsWith } from '../../scripts/lib/perl-pod.mjs'
import { pageIdentity, judgeLabel } from '../../scripts/lib/api-identities.mjs'
import { languageProblem } from '../../scripts/lib/api-links.mjs'
import { apiHostOf } from '../../scripts/lib/api-destinations.mjs'
import { readPage } from '../../scripts/lib/api-html.mjs'
import { API_MODELS } from '../src/lib/api-models'
import { POD_DATA, alternateDocs, podLink, type PodData } from '../src/lib/perl-pod'
import { PORT_BY_SLUG } from '../src/lib/ports'
import { loadAstroTemplate, renderAstroTemplate, withoutScope } from './astro-templates'

describe('native Perl POD destinations', () => {
  it.each([
    ['https://metacpan.org/pod/Future', 'Future'],
    ['https://metacpan.org/pod/IO::Async::Loop', 'IO::Async::Loop'],
    ['https://perldoc.perl.org/5.44.0/JSON::PP', 'JSON::PP'],
  ])('reads %s from its NAME declaration', (url, module) => {
    const page = readPage(`<title>Perl documentation</title><h1 id="NAME"><a href="#NAME">#</a>NAME</h1><p><code>${module}</code> - module description</p>`)
    const identity = pageIdentity(url, page)
    expect(apiHostOf(url)).toBe(new URL(url).hostname)
    expect(languageProblem('perl', url)).toBeUndefined()
    expect(identity).toMatchObject({ via: 'pod', kind: 'module', path: module.split('::') })
    expect(judgeLabel(module, identity)).toBeUndefined()
    expect(judgeLabel('Wrong::Module', identity)).toMatchObject({ failure: 'label' })
  })

  it('rejects a search or challenge page and never infers identity from its URL', () => {
    const url = 'https://metacpan.org/pod/Future'
    expect(pageIdentity(url, readPage('<title>Client Challenge</title><h1>Client Challenge</h1>')))
      .toMatchObject({ kind: 'other', path: [] })
    const wrong = pageIdentity(url, readPage('<h1 id="NAME">NAME</h1><p>IO::Async - framework</p>'))
    expect(judgeLabel('Future', wrong)).toMatchObject({ failure: 'label' })
    expect(languageProblem('perl', 'https://docs.python.org/3/library/asyncio.html')).toMatchObject({ failure: 'language' })
  })
})

describe('MetaCPAN POD links from the Perl reference', () => {
  const model = API_MODELS.perl!
  const symbol = (id: string) => model.symbols.find((entry) => entry.id === id)!
  const link = (id: string, version?: string, pod?: PodData) => podLink(model, symbol(id), version, pod)
  const edit = (change: (data: any) => void): PodData => {
    const copy = structuredClone(POD_DATA)
    change(copy)
    return copy
  }
  const POD = 'https://metacpan.org/pod'
  const dists = PORT_BY_SLUG.perl!.packages!.map((entry) => entry.name)

  it.each(['LibTmux', 'LibTmux::Filter', 'LibTmux::Server', 'LibTmux::Async', 'LibTmux::Async::Server', 'LibTmux::Workspace'])('links the module page of %s to its POD', (id) => {
    expect(link(id)).toMatchObject({ kind: 'metacpan-pod', href: `${POD}/${id}`, module: id, section: undefined })
    expect(link(id)!.label).toMatch(/^MetaCPAN POD/)
  })

  it('links a method to its section, and keeps the synchronous and asynchronous classes of one name apart', () => {
    expect(link('LibTmux::Server::new')).toMatchObject({ href: `${POD}/LibTmux::Server#new`, distribution: 'LibTmux', section: 'new' })
    expect(link('LibTmux::Async::Server::new')).toMatchObject({ href: `${POD}/LibTmux::Async::Server#new`, distribution: 'LibTmux-Async', section: 'new' })
    for (const name of ['capture_pane', 'batch', 'kill_session']) {
      const [sync, async] = [link(`LibTmux::Server::${name}`), link(`LibTmux::Async::Server::${name}`)]
      expect(sync?.href, name).toBe(`${POD}/LibTmux::Server#${name}`)
      expect(async?.href, name).toBe(`${POD}/LibTmux::Async::Server#${name}`)
    }
  })

  it('links an inherited method to the POD of the class that declares it', () => {
    expect(link('LibTmux::Client::generation')?.href).toBe(`${POD}/LibTmux::Entity#generation`)
    const selection = model.symbols.find((entry) => entry.inheritedFrom === 'LibTmux::Selection')!
    expect(podLink(model, selection)?.href).toMatch(new RegExp(`^${POD}/LibTmux::Selection#${selection.name}$`))
    // The workspace package's exception inherits from core's, so its methods belong to a different distribution.
    const inherited = model.symbols.find((entry) => entry.kind === 'method' && entry.package === 'LibTmux-Workspace' && entry.inheritedFrom === 'LibTmux::X')
    if (inherited) expect(podLink(model, inherited)).toMatchObject({ distribution: 'LibTmux', module: 'LibTmux::X' })
  })

  it('sends exception subclasses to the shared document, with a section where the release gave one', () => {
    expect(link('LibTmux::X::NoMatch')).toMatchObject({ href: `${POD}/LibTmux::X#NoMatch`, module: 'LibTmux::X' })
    expect(link('LibTmux::X::NoMatch::message')?.href).toBe(`${POD}/LibTmux::X#message`)
    // A method a subclass declares has no heading of its own in the shared document, and a heading of the same name may be the base class's.
    expect(link('LibTmux::X::Creation::created')).toMatchObject({ href: `${POD}/LibTmux::X`, section: undefined })
    expect(link('LibTmux::X::Creation::created')!.title).not.toContain('section')
  })

  it('opens a section only where the release’s rendered POD has that fragment', () => {
    for (const entry of model.symbols) {
      const found = podLink(model, entry)
      if (!found) continue
      const release = POD_DATA.distributions[found.distribution]!
      expect(release.documents[found.module]?.anchors, entry.id).toEqual(expect.arrayContaining(found.section ? [found.section] : []))
      expect(found.href, entry.id).toMatch(new RegExp(`^${POD}/${found.module}(?:#${found.section})?$`))
    }
  })

  it('derives the modules from the recorded releases, not a list of pages', () => {
    expect(Object.keys(POD_DATA.distributions).sort()).toEqual([...dists].sort())
    const modules = new Set(model.symbols.map((entry) => podLink(model, entry)?.module).filter(Boolean))
    // Every distinct document the model's declarations live in, and none the record does not hold.
    expect(modules.size).toBeGreaterThan(25)
    for (const module of modules) expect(Object.values(POD_DATA.distributions).some((release) => module! in release.documents), module).toBe(true)
    // A document the release carries and the model does not declare is not linked.
    expect(Object.values(POD_DATA.distributions).flatMap((release) => Object.keys(release.documents)).length).toBeGreaterThanOrEqual(modules.size)
  })

  it('links no declaration the release does not carry or document', () => {
    // A distribution CPAN has no release of, and a module the release does not list.
    expect(link('LibTmux::Server', 'latest', edit((data) => { delete data.distributions.LibTmux }))).toBeUndefined()
    const filterless = edit((data) => { delete data.distributions.LibTmux.documents['LibTmux::Filter']; data.distributions.LibTmux.packages['LibTmux::Filter'] = null })
    expect(link('LibTmux::Filter', 'latest', filterless)).toBeUndefined()
    expect(model.symbols.filter((entry) => entry.parent === 'LibTmux::Filter' && !entry.inheritedFrom).map((entry) => podLink(model, entry, 'latest', filterless))).not.toContain(expect.anything())
    // A package whose POD lives in another file than the one the page documents.
    expect(link('LibTmux::Server', 'latest', edit((data) => { data.distributions.LibTmux.documents['LibTmux::Server'].path = 'lib/LibTmux/Other.pm' }))).toBeUndefined()
    // Another port has no alternate documentation here.
    const rust = API_MODELS.rs!
    expect(rust.symbols.map((entry) => alternateDocs(rust, entry)).filter(Boolean)).toEqual([])
  })

  it('falls back to the module page for a method with no section, but only where the file is the release’s own', () => {
    const headless = (sha?: string) => edit((data) => {
      const document = data.distributions.LibTmux.documents['LibTmux::Server']
      document.anchors = document.anchors.filter((id: string) => id !== 'capture_pane')
      if (sha) document.sha256 = sha
    })
    // The file is what the release shipped, so the method exists there even though the POD has no heading for it.
    expect(link('LibTmux::Server::capture_pane', 'latest', headless())).toMatchObject({ href: `${POD}/LibTmux::Server`, section: undefined, differs: false })
    // The file has changed since, so a method with no heading may be one the release lacks.
    expect(link('LibTmux::Server::capture_pane', 'latest', headless('0'.repeat(64)))).toBeUndefined()
    expect(link('LibTmux::Server::new', 'latest', headless('0'.repeat(64)))?.href).toBe(`${POD}/LibTmux::Server#new`)
    // A heading the renderer repeated is ambiguous, so it names no section.
    const repeated = edit((data) => { data.distributions.LibTmux.documents['LibTmux::Server'].anchors.push('new-1') })
    expect(link('LibTmux::Server::new', 'latest', repeated)).toMatchObject({ href: `${POD}/LibTmux::Server`, section: undefined })
  })

  it('names the release when the page documents other source than the release shipped', () => {
    const release = POD_DATA.distributions.LibTmux!.release
    const changed = edit((data) => { data.distributions.LibTmux.documents['LibTmux::Server'].sha256 = 'f'.repeat(64) })
    const same = link('LibTmux::Server::new')!
    expect(same).toMatchObject({ differs: false, label: 'MetaCPAN POD', release })
    expect(same.title).toBe(`MetaCPAN POD: LibTmux::Server, section new, in LibTmux ${release}`)
    const other = link('LibTmux::Server::new', 'latest', changed)!
    expect(other).toMatchObject({ differs: true, label: `MetaCPAN POD ${release}`, href: same.href })
    expect(other.title).toBe(`MetaCPAN POD ${release}: LibTmux::Server, section new, in LibTmux ${release}; this page documents other source`)
    // A decimal version is shown as MetaCPAN spells it.
    expect(release).toMatch(/^\d+\.\d{3}$/)
  })

  it('pins a page for a release tag to the recorded release, and leaves trunk and previews on the latest', () => {
    const { author, release } = POD_DATA.distributions.LibTmux!
    expect(link('LibTmux::Server::new', 'latest')?.href).toBe(`${POD}/LibTmux::Server#new`)
    for (const version of ['next', 'pr-42', 'main']) expect(link('LibTmux::Server::new', version)?.href, version).toBe(`${POD}/LibTmux::Server#new`)
    expect(link('LibTmux::Server::new', `v${release}`)?.href).toBe(`https://metacpan.org/release/${author}/LibTmux-${release}/view/lib/LibTmux/Server.pm#new`)
    expect(link('LibTmux::Async::Server', `v${release}`)?.href).toBe(`https://metacpan.org/release/${author}/LibTmux-Async-${release}/view/lib/LibTmux/Async/Server.pm`)
    // A dotted three-part tag is another grammar's, so it does not pin a decimal release.
    expect(link('LibTmux::Server::new', 'v0.0.3')?.href).toBe(`${POD}/LibTmux::Server#new`)
  })

  it('holds the recorded releases to a shape a link can be built from', () => {
    expect(problemsWith(POD_DATA, dists)).toEqual([])
    expect(POD_DATA.schema).toBe(SCHEMA)
    // Controls: each defect the reader depends on is named.
    expect(problemsWith({ ...POD_DATA, schema: 2 }, dists)).toEqual(['schema is 2, expected 1'])
    expect(problemsWith(edit((data) => { delete data.distributions['LibTmux-Async'] }), dists)).toEqual(['LibTmux-Async has no recorded release'])
    expect(problemsWith(POD_DATA, [...dists, 'LibTmux-Mcp'])).toEqual(['LibTmux-Mcp has no recorded release'])
    expect(problemsWith(edit((data) => { data.distributions.LibTmux.documents['LibTmux::Server'].sha256 = 'abc' }), dists)).toEqual(['LibTmux: LibTmux::Server has no SHA-256'])
    expect(problemsWith(edit((data) => { data.distributions.LibTmux.packages['LibTmux::Server'] = 'LibTmux::Missing' }), dists))
      .toContain('LibTmux: LibTmux::Server is documented by LibTmux::Missing, which the record lacks')
    expect(problemsWith(edit((data) => { data.distributions.LibTmux.documents['LibTmux::Server'].anchors.push('new') }), dists)).toEqual(['LibTmux: LibTmux::Server lists its fragments wrongly'])
    expect(problemsWith(edit((data) => { data.distributions.LibTmux.release = '0.0.3' }), dists)).toEqual(['LibTmux: release "0.0.3" is not a decimal version'])
  })
})

describe('reading a release from the MetaCPAN API', () => {
  const body = (value: unknown) => ({ status: 200, text: JSON.stringify(value), bytes: Buffer.from(JSON.stringify(value)) })
  const page = (name: string, ids: string[]) => ({ status: 200, bytes: Buffer.alloc(0), text: `<h1 id="NAME">NAME</h1>\n<p>${name} - a demo</p>\n${ids.map((id) => `<h2 id="${id}">${id}</h2>`).join('\n')}` })
  const source = (text: string) => ({ status: 200, bytes: Buffer.from(text), text })
  const release = { distribution: 'Demo-Dist', name: 'Demo-Dist-0.004', version: '0.004', status: 'latest', maturity: 'released', author: 'TONY', provides: ['Demo', 'Demo::Plain', 'Demo::X', 'Demo::X::Boom'] }
  const module = (documentation: string | null, path: string, extra = {}) => body({ distribution: 'Demo-Dist', release: 'Demo-Dist-0.004', documentation, path, ...extra })
  const served = (changes: Record<string, unknown> = {}) => {
    const routes: Record<string, unknown> = {
      [`${API}/release/Demo-Dist`]: body(release),
      [`${API}/module/Demo`]: module('Demo', 'lib/Demo.pm'),
      [`${API}/module/Demo::Plain`]: module(null, 'lib/Demo/Plain.pm'),
      [`${API}/module/Demo::X`]: module('Demo::X', 'lib/Demo/X.pm'),
      [`${API}/module/Demo::X::Boom`]: module('Demo::X', 'lib/Demo/X.pm'),
      [`${API}/pod/Demo`]: page('Demo', ['new', 'new-1']),
      [`${API}/pod/Demo::X`]: page('Demo::X', ['Boom']),
      [`${API}/source/TONY/Demo-Dist-0.004/lib/Demo.pm`]: source('package Demo;\n'),
      [`${API}/source/TONY/Demo-Dist-0.004/lib/Demo/X.pm`]: source('package Demo::X;\npackage Demo::X::Boom;\n'),
      ...changes,
    }
    return async (url: string) => (routes[url] ?? { status: 404, text: '', bytes: Buffer.alloc(0) }) as Awaited<ReturnType<Parameters<typeof observeDistribution>[0]>>
  }
  const sha = (text: string) => createHash('sha256').update(text).digest('hex')

  it('records each provided package with its document, and each document with its file’s digest and fragments', async () => {
    expect(await observeDistribution(served(), 'Demo-Dist')).toEqual({
      author: 'TONY', release: '0.004',
      // A package with no POD of its own is recorded as having none, and a shared file documents its subclass.
      packages: { Demo: 'Demo', 'Demo::Plain': null, 'Demo::X': 'Demo::X', 'Demo::X::Boom': 'Demo::X' },
      documents: {
        Demo: { path: 'lib/Demo.pm', sha256: sha('package Demo;\n'), anchors: ['NAME', 'new', 'new-1'] },
        'Demo::X': { path: 'lib/Demo/X.pm', sha256: sha('package Demo::X;\npackage Demo::X::Boom;\n'), anchors: ['NAME', 'Boom'] },
      },
    })
  })

  it('reads the fragments a page answers to: headings and items, each once, in order', () => {
    expect(podAnchors('<h1 id="NAME">N</h1><h2 id="a">a</h2><dl><dt id="b,-c">b</dt></dl><p id="not-a-heading"></p><h2 id="a">again</h2>')).toEqual(['NAME', 'a', 'b,-c'])
  })

  it('refuses a release or a page that would make a link open the wrong thing', async () => {
    const refuses = (changes: Record<string, unknown>, pattern: RegExp) => expect(observeDistribution(served(changes), 'Demo-Dist')).rejects.toThrow(pattern)
    await refuses({ [`${API}/release/Demo-Dist`]: body({ ...release, status: 'cpan' }) }, /does not name it as a released distribution/)
    await refuses({ [`${API}/release/Demo-Dist`]: body({ ...release, maturity: 'developer' }) }, /does not name it as a released distribution/)
    await refuses({ [`${API}/release/Demo-Dist`]: body({ ...release, distribution: 'Other-Dist' }) }, /does not name it as a released distribution/)
    await refuses({ [`${API}/module/Demo::Plain`]: module(null, 'lib/Demo/Plain.pm', { release: 'Demo-Dist-0.003' }) }, /files Demo::Plain under Demo-Dist-0\.003/)
    // A client challenge is not a POD page, and a page that declares another module is not this one's.
    await refuses({ [`${API}/pod/Demo`]: { status: 200, bytes: Buffer.alloc(0), text: '<title>Client Challenge</title><h1>Client Challenge</h1>' } }, /names "" in its NAME section/)
    await refuses({ [`${API}/pod/Demo`]: page('Demo::Elsewhere', ['new']) }, /names "Demo::Elsewhere" in its NAME section/)
    await refuses({ [`${API}/pod/Demo`]: { status: 503, bytes: Buffer.alloc(0), text: '' } }, /answered 503/)
    await refuses({ [`${API}/module/Demo`]: module('Demo', 'bin/demo') }, /outside lib\//)
  })
})

describe('the alternate documentation link on an API entry', () => {
  // ApiEntry's imports need the Astro build, so the link cluster is compiled from its own source rather than loaded whole.
  const entrySource = readFileSync(new URL('../src/components/api/ApiEntry.astro', import.meta.url), 'utf8')
  const cluster = entrySource.slice(entrySource.indexOf('(source || alternate) && ('), entrySource.indexOf('\n        }\n        <a class="headerlink"'))
  const entry = async (props: Record<string, unknown>) => {
    const template = await loadAstroTemplate('components/api/ApiEntry.astro', {
      stubs: { 'components/api/ApiEntry.astro': `---\nconst { source, alternate } = Astro.props\n---\n{${cluster}}` },
    })
    return withoutScope(await renderAstroTemplate(template, { props }))
  }
  const model = API_MODELS.perl!
  const symbol = model.symbols.find((candidate) => candidate.id === 'LibTmux::Server::new')!

  it('is the cluster the component renders, beside the permalink', () => {
    expect(cluster).toMatch(/^\(source \|\| alternate\) && \(/)
    expect(cluster).toContain('href={alternate.href}')
    expect(entrySource).toContain('alternate?: (symbol: ApiSymbol) => ApiAlternate | undefined')
    for (const file of ['ApiReference', 'ProductApiPage']) {
      expect(readFileSync(new URL(`../src/components/api/${file}.astro`, import.meta.url), 'utf8'), file).toMatch(/alternate=\{\(entry\) => .*alternateDocs\(/)
    }
  })

  it('renders the POD action beside the source link, with its release in the accessible name', async () => {
    const alternate = podLink(model, symbol)!
    const html = await entry({ source: 'https://example.test/source', alternate })
    const anchors = [...html.matchAll(/<a class="api-source-anchor[^"]*" href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((match) => [match[1], match[2]])
    expect(anchors).toEqual([['https://example.test/source', 'source'], [alternate.href, alternate.label]])
    expect(html).toContain(`aria-label="${alternate.title}"`)
    expect(html).toContain('data-alternate-docs="metacpan-pod"')
    expect(html).toContain('data-alternate-observation="source"')
    // A page that documents other source says so in the markup too.
    const other = await entry({ source: 'https://example.test/source', alternate: { ...alternate, differs: true } })
    expect(other).toContain('data-alternate-observation="release"')
  })

  it('renders nothing where there is no alternate, and keeps the source link alone', async () => {
    const html = await entry({ source: 'https://example.test/source' })
    expect(html).not.toContain('data-alternate-docs')
    expect(html).toContain('>source</a>')
    expect(await entry({})).not.toContain('gp-sphinx-api-source-link')
  })
})
