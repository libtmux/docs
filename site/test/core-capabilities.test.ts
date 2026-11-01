import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { unbalanced } from '../src/lib/example-blocks'
import { sliceExcerpt } from '../src/lib/example-excerpt'
import {
  CAPABILITIES, capabilityCacheKey, capabilityFiles, portCapabilities, validateCapability, workflowRuns,
  type CapabilityEntry, type CapabilityId, type CapabilityTable,
} from '../src/lib/core-capabilities'
import { checkoutFor } from '../src/plugins/remark-port-code.mjs'
import type { CachedSource } from '../src/lib/port-landing'
import { PORT_BY_SLUG } from '../src/lib/ports'
import TABLE from '../src/data/core-capabilities.json'
import SOURCES from '../src/data/example-sources.json'
import MODEL_TS from '../src/data/api/ts.json'

const table = TABLE as CapabilityTable
const cache = SOURCES as Record<string, CachedSource>
const entries = Object.entries(table).flatMap(([owner, items]) =>
  Object.entries(items).map(([id, entry]) => ({ owner, id: id as CapabilityId, entry: entry as CapabilityEntry })))
const ids = CAPABILITIES.map((capability) => capability.id as string)

describe('the capability showcase data', () => {
  it('names only known ports and capabilities', () => {
    for (const { owner, id } of entries) {
      expect(PORT_BY_SLUG[owner], owner).toBeDefined()
      expect(ids, id).toContain(id)
    }
  })

  it.each(entries.map((item) => [`${item.owner}/${item.id}`, item] as const))('%s records the evidence that its result is checked', (_name, { entry }) => {
    expect(validateCapability(entry)).toEqual([])
  })

  it('refuses an entry without that evidence', () => {
    const ok = table.ts!['typed-graph']!
    expect(validateCapability(ok)).toEqual([])
    expect(validateCapability({ ...ok, checkedBy: [] })).toContain('records no evidence that the exit status or output is checked')
    expect(validateCapability({ ...ok, checkedBy: undefined })).toHaveLength(1)
    expect(validateCapability({ ...ok, checkedBy: [{ file: ok.file, contains: ' ' }] })).toContain('records evidence with no file or text')
    expect(validateCapability({ ...ok, ci: { workflow: 'ci.yml', command: '' } })).toEqual(['names no workflow', 'names no CI command'])
    expect(validateCapability({ ...ok, tmux: '3.8' })).toContain('writes the tmux version unlike 3.8+')
    expect(() => portCapabilities('ts', { ts: { 'typed-graph': { ...ok, checkedBy: [] } } }, cache)).toThrow(/records no evidence/)
  })

  it.each(entries.map((item) => [`${item.owner}/${item.id}`, item] as const))('%s quotes the cached file at the revision its API model records', (_name, { owner, entry }) => {
    const model = (owner === 'ts' ? MODEL_TS : undefined) as { revision: string, repo: string } | undefined
    for (const file of capabilityFiles(entry)) {
      const cached = cache[capabilityCacheKey(owner, file)]
      expect(cached, `${file} is in the example cache`).toBeDefined()
      expect(cached).toMatchObject({ repository: model?.repo, revision: model?.revision })
    }
    const source = cache[capabilityCacheKey(owner, entry.file)]!
    for (const item of entry.checkedBy) {
      expect(cache[capabilityCacheKey(owner, item.file)]!.content, `${item.file} holds the check`).toContain(item.contains)
    }
    for (const range of [{ from: entry.from, to: entry.to }, ...(entry.more ?? [])]) {
      const text = sliceExcerpt(source.content, range, entry.file)
      expect(unbalanced(text, entry.lang), range.from).toBeUndefined()
      expect(text.split('\n').length, 'a step, not a line').toBeGreaterThanOrEqual(4)
      expect(text.split('\n').length).toBeLessThanOrEqual(45)
    }
  })

  it('shows the capabilities in the maintainer order and nothing else', () => {
    const shown = portCapabilities('ts', table, cache)
    expect(shown.map((item) => item.id)).toEqual(ids.filter((id) => table.ts![id as CapabilityId]))
    expect(portCapabilities('lua', table, cache)).toEqual([])
    for (const item of shown) expect(item.sourceUrl).toContain(`/blob/${MODEL_TS.revision}/${item.file}`)
  })

  // A checkout that is not present cannot be asked; the run says it skipped.
  for (const { owner, id, entry } of entries) {
    const checkout = checkoutFor(owner, undefined) || ''
    const local = [checkout, `${process.env.HOME}/work/libtmux/libtmux-${owner}`].find((path) => existsSync(`${path}/.git`))
    it.skipIf(!local)(`${owner}/${id} runs in the workflow at that revision`, () => {
      const model = owner === 'ts' ? MODEL_TS : undefined
      const workflow = execFileSync('git', ['-C', local!, 'show', `${model!.revision}:${entry.ci.workflow}`], { encoding: 'utf8', maxBuffer: 1 << 24 })
      expect(workflowRuns(workflow, entry.ci.command), `${entry.ci.workflow} runs ${entry.ci.command}`).toBe(true)
    })
  }
})
