import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { API_MODELS } from '../src/lib/api-models'
import { assertPaired, isGeneratedSource, lineFragment, pinnedSource, sourceFilesFor, sourcePageHref, type SourceData } from '../src/lib/api-source-pages'
import { sourceRoutes } from '../src/lib/source-declarations'

const dataDir = new URL('../src/data/api-sources/', import.meta.url)
const modelsDir = new URL('../src/data/api/', import.meta.url)
const read = (dir: URL, name: string) => JSON.parse(readFileSync(new URL(name, dir), 'utf8'))
const ports = readdirSync(dataDir).map((name) => name.replace(/\.json$/, ''))

describe('the pinned source cache', () => {
  it.each(ports)('%s: every entry matches its checksum and the revision its model cites', (port) => {
    const data = read(dataDir, `${port}.json`)
    const model = read(modelsDir, `${port}.json`)
    const cited = new Map<string, { repo: string; revision: string }>()
    for (const symbol of model.symbols) {
      for (const source of [symbol.source, ...(symbol.signatures ?? []).map((signature: { source?: unknown }) => signature.source)]) {
        if (source?.file) cited.set(source.file, { repo: source.repo ?? model.repo, revision: source.revision ?? model.revision })
      }
    }
    expect(Object.keys(data.files).length).toBeGreaterThan(0)
    for (const [file, entry] of Object.entries<{ repo: string; revision: string; sha256: string; content: string }>(data.files)) {
      expect(createHash('sha256').update(entry.content).digest('hex'), file).toBe(entry.sha256)
      expect(cited.get(file), file).toEqual({ repo: entry.repo, revision: entry.revision })
    }
    expect(data.generated ?? []).toEqual(Object.keys(model.generatedSources ?? {}).sort())
  })

  it('caches the file every Go symbol cites at the model revision, with no generated sources', () => {
    const model = read(modelsDir, 'go.json')
    expect(model.generatedSources).toBeUndefined()
    const cited = new Set<string>(model.symbols.map((symbol: { source: { file: string } }) => symbol.source.file).filter(Boolean))
    expect(cited.has('tmux/pane_capture.go')).toBe(true)
    for (const file of cited) expect(pinnedSource('go', file), file).toBeDefined()
    expect(pinnedSource('go', 'tmux/pane_capture.go')).toMatchObject({ repo: model.repo, revision: model.revision })
    expect(pinnedSource('go', 'tmux/pane_capture.go')?.content).toContain('func (p Pane) Capture(')
  })
})

describe('sourcePageHref', () => {
  it('links a cached file to its page under the reference, with the line and the page it came from', () => {
    const href = sourcePageHref('go', 'tmux/pane_capture.go', [112, 129], 'tmux-pane-capture')
    expect(href).toMatch(/\/reference\/sources\/tmux\/pane_capture\.go\/\?from=tmux-pane-capture#L112-L129$/)
    expect(sourcePageHref('go', 'tmux/pane_capture.go', 123)).toMatch(/\/reference\/sources\/tmux\/pane_capture\.go\/#L123$/)
    expect(sourcePageHref('go', 'tmux/pane_capture.go')).toMatch(/\/reference\/sources\/tmux\/pane_capture\.go\/$/)
  })

  it('is undefined without a pinned copy, so no link points at a page that was not built', () => {
    expect(sourcePageHref('go', 'tmux/not_a_file.go')).toBeUndefined()
    expect(sourcePageHref('not-a-port', 'tmux/pane_capture.go')).toBeUndefined()
    expect(pinnedSource('go', 'tmux/not_a_file.go')).toBeUndefined()
    expect(pinnedSource('not-a-port', 'tmux/pane_capture.go')).toBeUndefined()
  })

  it('links a file the model embeds as well as a pinned copy', () => {
    const [generated] = sourceFilesFor('kotlin').filter((file) => isGeneratedSource('kotlin', file))
    expect(generated).toBeDefined()
    expect(pinnedSource('kotlin', generated!)).toBeUndefined()
    expect(sourcePageHref('kotlin', generated!)).toContain(`/reference/sources/${generated}/`)
  })

  it('writes a fragment only for a usable line', () => {
    expect(lineFragment(7)).toBe('#L7')
    expect(lineFragment([7, 7])).toBe('#L7')
    expect(lineFragment([7, 9])).toBe('#L7-L9')
    expect([lineFragment(), lineFragment(0), lineFragment(1.5)]).toEqual(['', '', ''])
  })
})

describe('source copies and a model of another revision', () => {
  const other = 'b'.repeat(40)
  const at = (revision: string) => ({
    ...API_MODELS.go!,
    revision,
    symbols: API_MODELS.go!.symbols.map((symbol) => ({ ...symbol, source: { ...symbol.source, revision } })),
  })

  it('are never built into source pages: the model cites lines of its own revision', () => {
    expect(() => sourceRoutes('go', API_MODELS.go!)).not.toThrow()
    expect(() => sourceRoutes('go', at(other))).toThrow(/are not the files the model cites at bbbbbbbbbbbb; run node scripts\/gen-api-sources\.mjs --port go/)
  })

  it('are refused one file at a time, by revision, repository and citation', () => {
    const model = API_MODELS.go!
    const entry = { repo: model.repo!, revision: model.revision!, sha256: '0', content: '' }
    const data = (files: SourceData['files']): SourceData => ({ port: 'go', files })
    const cited = 'tmux/pane_capture.go'
    expect(() => assertPaired('go', model, data({ [cited]: entry }))).not.toThrow()
    expect(() => assertPaired('go', model, data({ [cited]: { ...entry, revision: other } }))).toThrow(/pane_capture\.go/)
    expect(() => assertPaired('go', model, data({ [cited]: { ...entry, repo: 'another/repo' } }))).toThrow(/pane_capture\.go/)
    expect(() => assertPaired('go', model, data({ 'tmux/not_cited.go': entry }))).toThrow(/not_cited\.go/)
  })
})
