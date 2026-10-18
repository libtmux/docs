import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readInventory, targetKey } from '@libtmux/api-model'
import { apiInventoryIdentity, installFragmentAlias, mergeTargets, renderedTargets, type InventoryPage } from '../src/lib/inventory-targets'
import type { ApiSymbol } from '@libtmux/api-model'
import { publishAssembledInventories } from '../src/lib/inventory-publisher'
import type { VersionManifest } from '../src/lib/versions'
import { parse, type DefaultTreeAdapterTypes } from 'parse5'

const page: InventoryPage = { scope: 'rs', product: 'mcp', identity: 'tool:inspect', title: 'Inspect', version: 'stable' }
const html = (page: InventoryPage, content: string) => `<html><head><meta name="libtmux-inventory" content='${JSON.stringify(page)}'></head><body><nav id="chrome">Navigation</nav><main>${content}</main></body></html>`
const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('rendered inventory targets', () => {
  it('owns API sections independently of route slugs and excludes generated control IDs', () => {
    const content = '<dl data-inventory-owner="Stable.API" data-inventory-anchor="old-id"><dt id="old-id" data-inventory-category="api" data-inventory-id="Stable.API">API</dt><dd><section id="old-id.examples">Example</section><span role="dialog" id="generated-1"><span id="generated-1-title">Help</span></span></dd></dl>'
    const original = renderedTargets(html(page, content), '/en/old/')
    const moved = renderedTargets(html({ ...page, identity: 'moved-page' }, content), '/en/new/')
    expect(original.filter((target) => target.category === 'section').map(targetKey)).toEqual(moved.filter((target) => target.category === 'section').map(targetKey))
    expect(original.find((target) => target.category === 'section')?.identity).toBe('Stable.API.examples')
    expect(original.some((target) => target.href.includes('generated-1'))).toBe(false)
  })
  it('keeps named C enumerators independent of anonymous Doxygen enum IDs', () => {
    const symbol = { id: 'c:enum:tmux.h:@first::KEYC_ESCAPE', publicId: 'c:enum:tmux.h:@first::KEYC_ESCAPE', kind: 'constant', name: 'KEYC_ESCAPE', source: { file: 'tmux.h' } } as ApiSymbol
    const updated = { ...symbol, id: symbol.id.replace('@first', '@changed'), publicId: symbol.publicId!.replace('@first', '@changed') }
    expect(apiInventoryIdentity(symbol, 'c', 'enum')).toBe('c:enumerator:tmux.h:KEYC_ESCAPE')
    expect(apiInventoryIdentity(updated, 'c', 'enum')).toBe(apiInventoryIdentity(symbol, 'c', 'enum'))
  })
  it('uses actual fragments, including nested pointers, and ignores repeated member presentations', () => {
    const result = renderedTargets(html(page, '<h2 id="arguments">Arguments</h2><li id="inspect.input/$defs/A~1B" data-inventory-category="schema" data-inventory-id="inspect.input/$defs/A~1B">A</li><dl data-inventory-ignore><dt id="other">Other member</dt></dl>'), '/pr-42/en/rs/stable/mcp/tools/inspect/')
    expect(result.map((target) => target.category)).toEqual(['doc', 'heading', 'schema'])
    expect(result[2].href).toBe('/pr-42/en/rs/stable/mcp/tools/inspect/#inspect.input%2F%24defs%2FA~1B')
    expect(result[2].identity).toBe('inspect.input/$defs/A~1B')
    expect(result.some((target) => target.href.endsWith('#chrome'))).toBe(false)
  })
  it('fails when a targeted fragment occurs more than once in the HTML', () => {
    expect(() => renderedTargets(html(page, '<h2 id="same">A</h2><h2 id="same">B</h2>'), '/en/guide/')).toThrow('duplicate HTML IDs')
  })
  it('uses the document target instead of a repeated imported page-top anchor', () => {
    const targets = renderedTargets(html(page, '<h1 id="_top">Manual</h1><div id="_top"></div><h2 id="commands">Commands</h2>'), '/en/manual/')
    expect(targets.map((target) => target.category)).toEqual(['doc', 'heading'])
    expect(targets.some((target) => target.href.endsWith('#_top'))).toBe(false)
  })
  it('retains historical keys while moving a page and changing its title', () => {
    const original = renderedTargets(html(page, '<h2 id="arguments">Arguments</h2>'), '/en/old/')[0]
    const moved = { ...original, href: '/en/moved/', display: 'New title', identity: 'renamed' }
    const result = mergeTargets([moved], [{ scope: 'rs', from: targetKey(original), to: targetKey(moved) }])
    expect(result[0].aliases).toEqual([targetKey(original)])
    expect(() => mergeTargets([original, { ...original, href: '/en/conflict/' }])).toThrow('two destinations')
    expect(() => mergeTargets([moved], [{ scope: 'rs', from: 'missing', to: 'missing' }])).toThrow('no destination')
  })
  it('excludes translation placeholders and pages without content ownership', () => {
    expect(renderedTargets(html({ ...page, exclude: true }, '<h2 id="x">X</h2>'), '/ja/guide/')).toEqual([])
    expect(renderedTargets('<main id="unowned">An upstream redirect</main>', '/en/old/')).toEqual([])
  })
  it('keeps an old declaration in archived snapshots while aliasing its renamed latest identity', () => {
    const old = renderedTargets(html(page, ''), '/en/rs/stable/old/')[0]
    const current = { ...old, identity: 'renamed', href: '/en/rs/latest/new/', version: 'latest' }
    const archivedNew = { ...current, href: '/en/rs/stable/new/', version: 'stable' }
    const targets = mergeTargets([old, current, archivedNew], [{ scope: 'rs', from: targetKey(old), to: targetKey(current) }])
    expect(targets.find((target) => target.href === old.href)?.aliases).toBeUndefined()
    expect(targets.find((target) => target.href === archivedNew.href)?.aliases).toBeUndefined()
    expect(targets.find((target) => target.href === current.href)?.aliases).toEqual([targetKey(old)])
  })
  it('preserves a retired fragment and refuses to capture another existing fragment', () => {
    const content = html(page, '<h2 title="A > B" id="current">Arguments</h2><h2 id="occupied">Other</h2>')
    const target = renderedTargets(content, '/en/guide/')[1]
    const alias = { scope: 'rs', from: 'old-key', to: targetKey(target), fragment: 'old-fragment' }
    const updated = installFragmentAlias(content, target, alias)
    expect(updated).toContain('id="old-fragment"')
    expect(installFragmentAlias(updated, target, alias)).toBe(updated)
    expect(renderedTargets(updated, '/en/guide/')).toEqual(renderedTargets(content, '/en/guide/'))
    expect(() => installFragmentAlias(content, target, { ...alias, fragment: 'occupied' })).toThrow('conflicts')
  })
  it('places a retired row fragment inside its cell instead of outside the table', () => {
    const content = html(page, '<table><tbody><tr><td>Earlier</td></tr><tr id="current"><td>Configuration</td></tr></tbody></table>')
    const target = renderedTargets(content, '/en/config/').find((target) => target.href.endsWith('#current'))!
    const updated = installFragmentAlias(content, target, { scope: 'rs', from: 'old-key', to: targetKey(target), fragment: 'old-row' })
    const nodes = (node: DefaultTreeAdapterTypes.Node): DefaultTreeAdapterTypes.Node[] => [node, ...('childNodes' in node ? node.childNodes.flatMap(nodes) : [])]
    const alias = nodes(parse(updated)).find((node): node is DefaultTreeAdapterTypes.Element => 'attrs' in node && node.attrs.some((attr) => attr.name === 'id' && attr.value === 'old-row'))!
    const cell = alias.parentNode as DefaultTreeAdapterTypes.Element
    expect(cell.tagName).toBe('td')
    expect((cell.parentNode as DefaultTreeAdapterTypes.Element).attrs).toContainEqual({ name: 'id', value: 'current' })
  })
})

describe('assembled inventories', () => {
  it('selects configured defaults, keeps tmux versions distinct, and makes each port discoverable', () => {
    const out = mkdtempSync(join(tmpdir(), 'libtmux-inventories-')); dirs.push(out)
    const writePage = (path: string, metadata: InventoryPage, body = '<h2 id="details">Details</h2>') => {
      const file = join(out, path, 'index.html'); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, html(metadata, body))
    }
    writePage('', { ...page, scope: 'site', product: 'core', version: undefined, identity: 'index' })
    for (const version of ['latest', 'stable']) writePage(`rs/${version}/`, { ...page, version })
    for (const version of ['3.6', '3.7']) writePage(`tmux/${version}/reference/cmd/`, { ...page, scope: `tmux@${version}`, product: 'core', version }, '<dt id="cmd" data-inventory-id="cmd" data-inventory-category="api" data-inventory-native=\'[{"type":"c:struct","name":"cmd"}]\' data-inventory-legacy-type="c:struct" data-inventory-legacy-name="cmd">cmd</dt>')
    const manifest: VersionManifest = { schema: 1, defaultVersion: { rs: 'stable' }, ports: {
      rs: ['latest', 'stable'].map((slug) => ({ slug, label: slug, kind: 'alias', supported: true })), py: [],
    } }
    const result = publishAssembledInventories(out, '/pr-42/en/', manifest)
    expect(result.excluded).toEqual(['py'])
    const entries = readInventory(readFileSync(join(out, 'objects-full.inv'))).entries
    expect(entries.some((entry) => entry.uri.startsWith('rs/latest/'))).toBe(false)
    expect(entries.some((entry) => entry.uri.startsWith('rs/stable/'))).toBe(true)
    expect(entries.filter((entry) => entry.type === 'c:struct').map((entry) => entry.name)).toContain('tmux@3.7:cmd')
    const port = readInventory(readFileSync(join(out, 'rs/stable/objects.inv'))).entries
    expect(port.every((entry) => !entry.uri.startsWith('/') && !entry.uri.includes('latest/'))).toBe(true)
    expect(() => publishAssembledInventories(out, '/pr-42/en/', { ...manifest, defaultVersion: { rs: 'missing' } })).toThrow('not assembled')
  })
})
