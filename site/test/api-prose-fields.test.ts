import { globSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BUILTINS, PROSE_FIELDS, RENDERED_TEXTS, STRUCTURAL_FIELDS, commandFacts, isStructuralField, parameterBindingFacts, parameterBindingText, proseTexts, unclassifiedFields,
  type ApiSymbol, type SymbolIndex,
} from '@libtmux/api-model'
import { apiHostOf, apiIndexes, collectApiDestinations } from '../../scripts/lib/api-destinations.mjs'
import { normalizeAddress } from '../../scripts/lib/api-markdown-links.mjs'
import { languageOfUrl } from '../../scripts/lib/api-links.mjs'
import { createProseLinker } from '../src/lib/prose-resolver'
import { parseApiProse } from '../src/lib/api-prose'
import { API_MODELS } from '../src/lib/api-models'
import { defaultVersionFor } from '../src/lib/versions'
import { productApiIndex } from '../src/lib/product-api'
import { symbolPreview } from '../src/lib/link-preview'

/**
 * The link verifier reads the links of the prose the site renders. These tests hold the verifier to
 * the page: a string the model grows, an expression a component starts rendering as prose, and a
 * link a page shows that the verifier never sees each fail here.
 */
const root = new URL('../../', import.meta.url).pathname
/** The site's own models and indexes: what the pages link with, not a copy of it. */
const indexes: Record<string, SymbolIndex> = Object.fromEntries(Object.entries(API_MODELS).map(([port, model]) => [port, productApiIndex(model, defaultVersionFor(port))]))
const RENDERED = /<Api(?:Doc|Prose)\b[^>]*?\btext=\{([^}]+)\}/g
const symbols = Object.entries(API_MODELS).flatMap(([port, model]) => (model.symbols as ApiSymbol[]).map((symbol) => ({ port, symbol })))

describe('the strings of an extracted symbol', () => {
  it('are each documentation or structure, so a field the extractor adds is decided, not skipped', () => {
    const unclassified = new Map<string, number>()
    for (const { symbol } of symbols) for (const path of unclassifiedFields(symbol)) unclassified.set(path, (unclassified.get(path) ?? 0) + 1)
    expect([...unclassified.keys()], 'add each to PROSE_FIELDS (the site renders it as prose) or STRUCTURAL_FIELDS (it is a name, a type, code or an address)').toEqual([])
  })

  it('are never both', () => {
    for (const path of Object.keys(PROSE_FIELDS)) expect(isStructuralField(path), path).toBe(false)
    expect(STRUCTURAL_FIELDS.length).toBeGreaterThan(0)
  })

  it('include every prose field some symbol has, so no entry of the table is dead', () => {
    const seen = new Set(symbols.flatMap(({ symbol }) => proseTexts(symbol).map((text) => text.field)))
    for (const path of Object.keys(PROSE_FIELDS)) expect(seen.has(path), path).toBe(true)
  })
})

describe('the expressions the components render as prose', () => {
  /** Every Astro file the site renders with: a component, a page and a layout draw prose alike. */
  const SCANNED = 'src/**/*.astro'
  const expressionsIn = (listing: (readonly [string, string])[]) => {
    const found = new Map<string, string[]>()
    for (const [file, source] of listing) for (const match of source.matchAll(RENDERED)) found.set(match[1], [...(found.get(match[1]) ?? []), file])
    return found
  }
  const components = globSync(SCANNED, { cwd: new URL('..', import.meta.url).pathname })
  const sources = components.map((file) => [file, readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')] as const)
  const rendered = expressionsIn(sources)

  it('are read in every component, page and layout: a page that draws a symbol\'s prose is as much a renderer as a component', () => {
    for (const directory of ['src/components/', 'src/pages/', 'src/layouts/']) expect(components.some((file) => file.startsWith(directory)), directory).toBe(true)
    const planted = '<ApiDoc text={symbol.doc.seeAlso[0]} index={index} context={symbol} />'
    for (const file of ['src/pages/zz.astro', 'src/layouts/Zz.astro', 'src/components/api/Zz.astro']) {
      expect([...expressionsIn([[file, planted]]).keys()], file).toEqual(['symbol.doc.seeAlso[0]'])
    }
  })

  it('are each one the verifier reads: a component that renders a new expression fails until RENDERED_TEXTS says what it is', () => {
    expect([...rendered.keys()].sort()).toEqual(Object.keys(RENDERED_TEXTS).sort())
  })

  it('stand for a field of the table or for a text the model builds', () => {
    const built = new Set(['commandFacts and parameterBindingFacts', 'parameterBindingText', 'conceptNotes', 'ApiProse blocks'])
    for (const [expression, meaning] of Object.entries(RENDERED_TEXTS)) expect(meaning in PROSE_FIELDS || built.has(meaning), expression).toBe(true)
  })

  it('fail the check when a component renders one the table lacks, and when a symbol holds a string nobody classified', () => {
    const synthetic = '<ApiProse\n  text={symbol.doc.newField}\n  index={index} />\n<ApiDoc text={parameterBindingText(p)!} index={index} />'
    const expressions = [...synthetic.matchAll(RENDERED)].map((match) => match[1])
    expect(expressions).toEqual(['symbol.doc.newField', 'parameterBindingText(p)!'])
    expect(expressions.filter((expression) => !(expression in RENDERED_TEXTS))).toEqual(['symbol.doc.newField'])
    const symbol = { id: 'a.B', name: 'B', kind: 'class', modifiers: [], signatures: [], source: { file: 'a.ts' }, doc: { summary: 'x', newField: 'y' } } as unknown as ApiSymbol
    expect(unclassifiedFields(symbol)).toEqual(['.doc.newField'])
  })

  it('are linked by docSpans, the function the verifier calls', () => {
    const doc = sources.find(([file]) => file.endsWith('ApiDoc.astro'))![1]
    expect(doc).toContain('index.docSpans(text, context)')
  })
})

describe('the code that links prose', () => {
  /**
   * What touches the linker or an index: the tokens a call, an indirect call (`index['linkText']`, `const { linkType } = index`) and a
   * destructured use all contain. A file of any kind or place that holds one is read here, with what it does with an address outside
   * the site, or the test fails.
   */
  const LINKER = /\b(?:linkText|linkLiteral|linkType|linkDoc|docSpans|createProseLinker|decideMention|getResolver|tokenizeDoc|productApiIndex|createApiIndex|indexFor|SymbolIndex)\b|\b(?:[iI]ndex\w*|idx|resolver)\??(?:\.|\[['"])resolve\b/
  const SOURCES = /\.(?:[cm]?[jt]sx?|astro)$/
  const WHERE = /^(?:src(?!\/(?:data|content)\/)|scripts)\//
  const READ: Record<string, string> = {
    'scripts/check-dev.mjs': 'asks an index which page a name has; links nothing',
    'src/components/ProseText.astro': 'template prose, with the port it names: decideMention; the notices it carries are read in api-links-rendered.test.ts',
    'src/components/api/ApiCommandParameters.astro': 'passes the index to ApiDoc',
    'src/components/api/ApiDoc.astro': 'the renderer: docSpans, which the collector calls too',
    'src/components/api/ApiEntry.astro': 'passes the index to ApiDoc; resolves the type an entry inherits from, to a page of this site',
    'src/components/api/ApiProse.astro': 'passes the index to ApiDoc',
    'src/components/api/ApiReference.astro': 'passes the index to ApiDoc',
    'src/components/api/ApiScalarMembers.astro': 'passes the index to ApiDoc',
    'src/components/api/ApiSignatureParameters.astro': 'passes the index to ApiType',
    'src/components/api/ApiType.astro': 'links a type: linkType, which the collector calls on every signature',
    'src/components/api/ProductApiPage.astro': 'builds the index the page renders with',
    'src/lib/api-models.ts': 'builds the index (createApiIndex)',
    'src/lib/api-sections.ts': 'reads which symbols a signature names, to list related types; links nothing',
    'src/lib/code-layout.ts': 'links the types of a signature (linkType)',
    'src/lib/link-preview.ts': 'a hover card names only the references that resolve to a page of this site; any other link is text on the card',
    'src/lib/mcp-preview.ts': 'tokenizes MCP tool text, which names no library symbol',
    'src/lib/mcp-rest.ts': 'resolves an MCP reference to a page of this site',
    'src/lib/product-api.ts': 'builds the product index',
    'src/lib/prose-markdown.ts': 'the Markdown copy of a page: the prose linker, as the rendered page asks it',
    'src/lib/prose-resolver.ts': 'the prose linker and its resolver',
    'src/lib/symbol-markdown.ts': 'the Markdown copy of a symbol: docSpans, as the page links it, and types',
    'src/lib/tmux-links.ts': 'adds tmux links to spans docSpans has made',
    'src/lib/tmux-reference.ts': 'builds an index to resolve a reference to a page of this site',
    'src/plugins/rehype-api-links.ts': 'the page linker: decideMention, with what the page says of its language',
  }
  const read = (listing: [string, string][]) => listing.filter(([file, source]) => WHERE.test(file) && SOURCES.test(file) && LINKER.test(source)).map(([file]) => file).sort()
  const disk = (): [string, string][] => globSync('{src,scripts}/**/*', { cwd: new URL('..', import.meta.url).pathname })
    .filter((file) => SOURCES.test(file))
    .map((file) => [file, readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')])

  it('are each read: every file that links, or holds an index to link with, is listed with what it does with an address outside the site', () => {
    expect(read(disk())).toEqual(Object.keys(READ).sort())
  })

  it('notice a file that starts to link prose, however it calls the linker and wherever it lives', () => {
    const planted = (file: string, source: string) => expect(read([[file, source]]), `${file}: ${source}`).toEqual([file])
    planted('src/lib/x.ts', 'for (const span of index.linkText(summary, context)) {}')
    planted('src/lib/x.ts', 'const parts = this.docSpans(text)')
    planted('src/lib/x.ts', 'index.linkType(annotation, symbol)')
    planted('src/lib/x.ts', 'const link = index.resolve(name, "any", symbol)')
    planted('src/lib/x.ts', 'const link = index.linkDoc(spans, symbol)')
    planted('src/lib/x.ts', "const f = index['linkText']; f(text)")
    planted('src/lib/x.ts', 'const { linkType } = index')
    planted('src/lib/x.ts', 'const a = index?.resolve(name)')
    planted('src/lib/x.ts', 'const index = productApiIndex(model, version)')
    planted('src/components/x.tsx', 'index.linkText(text)')
    planted('src/lib/x.mts', 'index.linkText(text)')
    planted('src/utils/x.ts', 'index.linkText(text)')
    planted('src/pages/x.astro', 'index.linkText(text)')
    planted('src/layouts/x.astro', 'index.linkText(text)')
    planted('scripts/x.mjs', 'index.linkText(text)')
    planted('src/lib/x.ts', 'const link = createProseLinker(product)')
    planted('src/lib/x.ts', 'const how = decideMention(text, context, resolver, models)')
    // A local helper of the same name, and a file that is not code, are not the linker.
    expect(read([['src/lib/x.ts', 'spans.push(...linkTextOf(offset, range.start))']])).toEqual([])
    expect(read([['src/lib/x.md', 'index.linkText(text)'], ['src/data/x.ts', 'index.linkText(text)']])).toEqual([])
  })

  it('draw no card mention of an address outside the site: a card names references to this site\'s own pages and shows any other link as text', () => {
    const external: string[] = []
    let mentions = 0
    for (const [port, model] of Object.entries(API_MODELS)) {
      const version = defaultVersionFor(port)
      for (const symbol of model.symbols) {
        for (const part of symbolPreview(model, symbol, version).descriptionParts ?? []) {
          if (typeof part === 'string') continue
          mentions += 1
          if (!part.href.startsWith('/')) external.push(`${symbol.id}: ${part.href}`)
        }
      }
    }
    expect(external).toEqual([])
    expect(mentions).toBeGreaterThan(0)
  })
})

describe('a name in prose and in a symbol\'s docs', () => {
  it('reaches the documentation of one language: a Kotlin Flow or a Scala Vector is not the JDK\'s', () => {
    const prose = createProseLinker()
    const differing: string[] = []
    let compared = 0
    for (const [port, names] of Object.entries(BUILTINS)) {
      if (!indexes[port]) continue
      for (const name of Object.keys(names)) {
        const said = prose(name, { pagePort: port })
        const proseHref = said.kind === 'link' && /^https?:/.test(said.href) ? said.href : undefined
        const symbol = indexes[port].resolve(name, 'any')
        const symbolHref = symbol?.external ? symbol.href : undefined
        if (!proseHref || !symbolHref) continue
        compared += 1
        if (languageOfUrl(proseHref) !== languageOfUrl(symbolHref)) differing.push(`${port} ${name}: ${proseHref} / ${symbolHref}`)
      }
    }
    expect(differing).toEqual([])
    expect(compared).toBeGreaterThan(300)
  })
})

describe('the links the pages show', () => {
  const destinations = collectApiDestinations({ root })

  /** An oracle written without the model's own tables: each field named, each text linked as `ApiDoc` links it, fences and all. */
  const shown = new Map<string, string>()
  const record = (href: string | undefined, where: string) => {
    if (href && apiHostOf(href) && !shown.has(href)) shown.set(href, where)
  }
  for (const { port, symbol } of symbols) {
    const index = indexes[port]
    const read = (field: string, text: string | undefined, form: 'inline' | 'blocks' = 'inline') => {
      if (!text) return
      const runs = form === 'inline' ? [text] : parseApiProse(text).flatMap((block) => (block.kind === 'p' ? [block.text] : block.kind === 'ul' || block.kind === 'ol' ? flat(block.items) : []))
      for (const run of runs) {
        for (const span of index.linkText(run, symbol)) {
          if (span.kind === 'link') record(span.href, `${symbol.id} ${field}`)
          else if (span.kind === 'ref' && span.link?.external) record(span.link.href, `${symbol.id} ${field}`)
          else if (span.kind === 'ref' && !span.link) for (const part of index.linkLiteral(span.label, symbol)) record(part.link?.external ? part.link.href : undefined, `${symbol.id} ${field}`)
        }
      }
    }
    const flat = (items: { text: string; children: typeof items }[]): string[] => items.flatMap((item) => [item.text, ...flat(item.children)])
    const doc = symbol.doc
    read('summary', doc?.summary)
    read('body', doc?.body, 'blocks')
    read('deprecated', doc?.deprecated, 'blocks')
    read('changed', doc?.changed, 'blocks')
    for (const admonition of doc?.admonitions ?? []) read('admonition', admonition.text, 'blocks')
    for (const reference of doc?.references ?? []) read('reference', reference.text)
    for (const example of doc?.examples ?? []) { read('example.intro', example.intro); read('example.outro', example.outro) }
    for (const signature of symbol.signatures ?? []) {
      read('signature.summary', signature.doc?.summary, 'blocks')
      read('signature.body', signature.doc?.body, 'blocks')
      for (const param of signature.params ?? []) {
        read('param.doc', param.doc); read('param.doc', param.doc, 'blocks')
        read('binding', parameterBindingText(param))
        for (const fact of parameterBindingFacts(param)) read('binding fact', fact.value)
      }
      read('returnsDoc', signature.returnsDoc)
      for (const raised of signature.raises ?? []) read('raises.doc', raised.doc)
      for (const parameter of signature.typeParameters ?? []) read('typeParameter.doc', (parameter as { doc?: string }).doc, 'blocks')
    }
    for (const parameter of (symbol as { typeParameters?: { doc?: string }[] }).typeParameters ?? []) read('typeParameter.doc', parameter.doc, 'blocks')
    if (symbol.command) for (const fact of commandFacts(symbol.command)) read('command fact', fact.value)
  }

  it('are all destinations: every API link a field shows is one the verifier collects', () => {
    const missing = [...shown].filter(([href]) => !destinations.has(normalizeAddress(href))).map(([href, where]) => `${href} (${where})`)
    expect(missing).toEqual([])
    expect(shown.size).toBeGreaterThan(0)
  })

  it('are linked alike by the collector\'s index and the site\'s, so the verifier reads what the pages link and not a copy of it', () => {
    const collector = apiIndexes({ root }).indexes as Record<string, SymbolIndex>
    const offSite = (index: SymbolIndex, symbol: ApiSymbol, text: string) => index.docSpans(text, symbol)
      .flatMap((span) => (span.kind === 'link' ? [span.href] : span.kind === 'ref' ? (span.link ? [span.link.href] : (span.parts ?? []).flatMap((part) => (part.link ? [part.link.href] : []))) : []))
      .filter((href) => /^https?:/.test(href))
    const differing: string[] = []
    for (const { port, symbol } of symbols) {
      for (const { text } of proseTexts(symbol)) {
        const site = offSite(indexes[port], symbol, text)
        const ours = offSite(collector[port], symbol, text)
        if (JSON.stringify(site) !== JSON.stringify(ours)) differing.push(`${port}:${symbol.id}: ${site.join(' ')} / ${ours.join(' ')}`)
      }
    }
    expect(differing).toEqual([])
  })

  it('would fail the check on a link the verifier does not collect', () => {
    const [first] = [...shown.keys()]
    const without = new Map([...destinations].filter(([href]) => href !== first))
    expect([...shown].filter(([href]) => !without.has(href)).map(([href]) => href)).toEqual([first])
  })

  it('do not send a reader\'s own variable, a prose word or a printed [object Object] to a documentation page', () => {
    const hrefs = [...shown.keys()]
    expect(hrefs.filter((href) => /about_variables/.test(href))).toEqual([])
    expect(hrefs.filter((href) => /library\/string\.html#module-string$/.test(href))).toEqual([])
    expect(hrefs.filter((href) => /Global_Objects\/Object$/.test(href))).toEqual([])
  })
})
