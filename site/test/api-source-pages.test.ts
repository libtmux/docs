import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isGeneratedSource, lineFragment, pinnedSource, sourceFilesFor, sourcePageHref } from '../src/lib/api-source-pages'

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
