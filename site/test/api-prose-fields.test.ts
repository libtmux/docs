import { globSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  PROSE_FIELDS, RENDERED_TEXTS, STRUCTURAL_FIELDS, commandFacts, isStructuralField, parameterBindingFacts, parameterBindingText, proseTexts, unclassifiedFields,
  type ApiSymbol, type SymbolIndex,
} from '@libtmux/api-model'
import { apiHostOf, apiIndexes, collectApiDestinations } from '../../scripts/lib/api-destinations.mjs'
import { parseApiProse } from '../src/lib/api-prose'
import { API_MODELS } from '../src/lib/api-models'
import { defaultVersionFor } from '../src/lib/versions'
import { symbolPreview } from '../src/lib/link-preview'

/**
 * The link verifier reads the links of the prose the site renders. These tests hold the verifier to
 * the page: a string the model grows, an expression a component starts rendering as prose, and a
 * link a page shows that the verifier never sees each fail here.
 */
const root = new URL('../../', import.meta.url).pathname
const { models, indexes: built } = apiIndexes({ root })
const indexes = built as Record<string, SymbolIndex>
const RENDERED = /<Api(?:Doc|Prose)\b[^>]*?\btext=\{([^}]+)\}/g
const symbols = Object.entries(models).flatMap(([port, model]) => (model.symbols as ApiSymbol[]).map((symbol) => ({ port, symbol })))

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
  const components = globSync('src/components/**/*.astro', { cwd: new URL('..', import.meta.url).pathname })
  const sources = components.map((file) => [file, readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')] as const)
  const rendered = new Map<string, string[]>()
  for (const [file, source] of sources) {
    for (const match of source.matchAll(RENDERED)) rendered.set(match[1], [...(rendered.get(match[1]) ?? []), file])
  }

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
  const LINKS_PROSE = /\w\.(?:linkText|linkLiteral|docSpans)\(/
  /**
   * Every file of the site that asks the index to link documentation text, and what it does with an address outside the site. A file that
   * starts to link prose must be added here, with the reason it needs no destination of its own, or the test fails.
   */
  const CALLERS: Record<string, string> = {
    'src/components/api/ApiDoc.astro': 'renders every link, through docSpans, which the collector calls too',
    'src/lib/symbol-markdown.ts': 'the Markdown export links the same fields, whose names the collector also resolves (its `exported` pass)',
    'src/lib/link-preview.ts': 'a hover card names only the references that resolve to a page of this site; any other link is text on the card',
  }
  const files = globSync('src/{components,lib,pages,layouts,integrations,plugins}/**/*.{ts,astro,mjs}', { cwd: new URL('..', import.meta.url).pathname })

  it('are each listed with what they do with an address outside the site, so a new one fails until it is read', () => {
    const callers = files.filter((file) => LINKS_PROSE.test(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')))
    expect(callers.sort()).toEqual(Object.keys(CALLERS).sort())
  })

  it('notice a file that starts to link prose, and not a local helper of the same name', () => {
    const links = LINKS_PROSE
    expect(links.test('for (const span of index.linkText(summary, context)) {}')).toBe(true)
    expect(links.test('const parts = this.docSpans(text)')).toBe(true)
    expect(links.test('spans.push(...linkText(offset, range.start))')).toBe(false)
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
    const missing = [...shown].filter(([href]) => !destinations.has(href)).map(([href, where]) => `${href} (${where})`)
    expect(missing).toEqual([])
    expect(shown.size).toBeGreaterThan(0)
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
