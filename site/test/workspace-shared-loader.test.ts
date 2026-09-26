import { EventEmitter } from 'node:events'
import { statSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { LoaderContext } from 'astro/loaders'
import { afterEach, expect, it, vi } from 'vitest'
import { PORTS as ALL_PORTS } from '../src/lib/ports'
import { workspaceDocsLoader } from '../src/loaders/workspace-shared'
import { KNOWN_PORTS } from '../src/lib/workspace-shared-slots'

// Ruby ships its own released workspace CLI and Lua has none, so the loader
// excludes both from shared-page synthesis (KNOWN_PORTS); this suite covers
// only the ports that mechanism actually reaches.
const PORTS = ALL_PORTS.filter((port) => KNOWN_PORTS.has(port.slug))

vi.mock('astro/loaders', () => ({ glob: () => ({ load: async () => {} }) }))

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'workspace-loader-'))
  roots.push(root)
  const shared = join(root, 'src/content/_workspace-shared')
  await mkdir(join(shared, 'workspace'), { recursive: true })
  const file = join(shared, 'workspace/index.md')
  await writeFile(file, '---\ntitle: Shared\n---\ninitial body')
  type Entry = Parameters<LoaderContext['store']['set']>[0]
  const entries = new Map<string, Entry>([['ordinary', { id: 'ordinary', data: { title: 'Ordinary' } }]])
  const watcher = Object.assign(new EventEmitter(), { add: vi.fn() })
  const writes = vi.fn((entry: Entry) => entries.set(entry.id, entry))
  const render = vi.fn(async (body: string) => ({ html: body }))
  const parseData = vi.fn(async ({ data }: { data: Record<string, unknown> }) => data)
  const infos = vi.fn()
  const errors = vi.fn()
  const context = {
    config: { root: pathToFileURL(`${root}/`) },
    store: {
      set: writes,
      get: (id: string) => entries.get(id),
      delete: (id: string) => entries.delete(id),
      keys: () => [...entries.keys()],
      entries: () => [...entries.entries()],
      values: () => [...entries.values()],
    },
    parseData,
    generateDigest: (body: string) => body,
    renderMarkdown: render,
    logger: { info: infos, warn: vi.fn(), error: errors },
    watcher,
  } as unknown as LoaderContext
  await workspaceDocsLoader().load(context)
  const emit = async (event: string, path = file) => {
    const stats = event === 'unlink' ? undefined : statSync(path)
    await Promise.all(watcher.listeners(event).map((listener) => Promise.resolve(listener(path, stats))))
  }
  const notify = (event: string, path = file) => watcher.emit(event, path, event === 'unlink' ? undefined : statSync(path))
  const bodies = () => PORTS.map(({ slug }) => entries.get(`ports/${slug}/workspace`)?.body)
  return { shared, file, entries, writes, render, parseData, infos, errors, emit, notify, bodies }
}

it('removes deleted or renamed shared pages without removing ordinary docs', async () => {
  const { file, entries, emit } = await fixture()
  expect(entries.size).toBe(PORTS.length + 1)
  const renamed = join(file, '..', 'renamed.mdx')
  await rename(file, renamed)
  await emit('unlink')
  await emit('add', renamed)
  for (const { slug } of PORTS) {
    expect(entries.has(`ports/${slug}/workspace`)).toBe(false)
    expect(entries.get(`ports/${slug}/workspace/renamed`)?.body).toContain('initial body')
  }
  await rm(renamed)
  await emit('unlink', renamed)
  expect([...entries.keys()]).toEqual(['ordinary'])
})

it('does not recreate a page deleted during rendering', async () => {
  const { file, entries, writes, render, emit } = await fixture()
  writes.mockClear()
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  render.mockImplementationOnce(async (body) => {
    entered.resolve()
    await release.promise
    return { html: body }
  })
  await writeFile(file, '---\ntitle: Shared\n---\npending body')
  const change = emit('change')
  await entered.promise
  await rm(file)
  const deletion = emit('unlink')
  release.resolve()
  await Promise.all([change, deletion])
  expect([...entries.keys()]).toEqual(['ordinary'])
  expect(writes).not.toHaveBeenCalled()
})

it('converges to the latest edit when watcher events overlap', async () => {
  const { file, render, emit, bodies } = await fixture()
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  render.mockImplementationOnce(async (body) => {
    entered.resolve()
    await release.promise
    return { html: body }
  })
  await writeFile(file, '---\ntitle: Shared\n---\nfirst edit')
  const first = emit('change')
  await entered.promise
  await writeFile(file, '---\ntitle: Shared\n---\nlatest edit')
  const latest = emit('change')
  release.resolve()
  await Promise.all([first, latest])
  expect(bodies()).toEqual(PORTS.map(() => '\nlatest edit'))
})

it.each(['render', 'schema', 'render dependency'] as const)('retains complete previous entries on %s failure and recovers on the next edit', async (failure) => {
  const { file, shared, entries, render, parseData, infos, errors, emit, bodies } = await fixture()
  const original = [...entries]
  let calls = 0
  if (failure === 'schema') {
    parseData.mockImplementation(async ({ data }) => {
      if (++calls === 3) throw new Error('invalid shared metadata')
      return data
    })
  } else {
    render.mockImplementation(async (body) => {
      if (++calls === 3) throw Object.assign(new Error('invalid shared page'), { code: failure === 'render dependency' ? 'ENOENT' : undefined })
      return { html: body }
    })
  }
  await writeFile(file, '---\ntitle: Shared\n---\nbroken edit')
  await expect(emit('change')).resolves.toBeUndefined()
  expect(errors).toHaveBeenCalled()
  expect([...entries]).toEqual(original)
  await writeFile(file, '---\ntitle: Shared\n---\nrecovered edit')
  await emit('change')
  expect(bodies()).toEqual(PORTS.map(() => '\nrecovered edit'))
  render.mockClear()
  infos.mockClear()
  const sibling = `${shared}-backup/workspace/index.md`
  const text = join(shared, 'notes.txt')
  const outside = join(shared, '..', 'outside.md')
  await mkdir(join(sibling, '..'), { recursive: true })
  for (const ignored of [sibling, text, outside]) await writeFile(ignored, 'ignored')
  await emit('change', sibling)
  await emit('add', text)
  await emit('change', outside)
  expect(render).not.toHaveBeenCalled()
  expect(infos).not.toHaveBeenCalled()
  expect(await readFile(file, 'utf8')).toContain('recovered edit')
})

it('contains watcher failures when the emitter ignores the returned promise', async () => {
  const { file, render, errors, notify, emit, bodies } = await fixture()
  const logged = Promise.withResolvers<void>()
  errors.mockImplementation(() => logged.resolve())
  render.mockRejectedValueOnce(new Error('invalid shared page'))
  await writeFile(file, '---\ntitle: Shared\n---\nbroken edit')
  expect(notify('change')).toBe(true)
  await logged.promise
  await writeFile(file, '---\ntitle: Shared\n---\nrecovered edit')
  await emit('change')
  expect(bodies()).toEqual(PORTS.map(() => '\nrecovered edit'))
})

it('skips unchanged sources during a full reconciliation', async () => {
  const { shared, file, render, emit, bodies } = await fixture()
  const second = join(shared, 'workspace/second.mdx')
  await writeFile(second, '---\ntitle: Second\n---\nsecond body')
  render.mockClear()
  await emit('add', second)
  expect(render).toHaveBeenCalledTimes(PORTS.length)
  render.mockClear()
  await emit('change')
  expect(render).not.toHaveBeenCalled()
  await writeFile(file, '---\ntitle: Shared\n---\nchanged body')
  await emit('change')
  expect(render).toHaveBeenCalledTimes(PORTS.length)
  expect(bodies()).toEqual(PORTS.map(() => '\nchanged body'))
})
