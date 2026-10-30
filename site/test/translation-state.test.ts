import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { CollectionEntry } from 'astro:content'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// `i18n/resolve` imports Astro's content and config modules, which a bare vitest run cannot load.
vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []) }))
const project = vi.hoisted(() => ({ root: undefined as URL | undefined }))
vi.mock('astro:config/server', () => ({ get root() { return project.root } }))
const { translationState } = await import('../src/i18n/resolve')

/**
 * One origin with four commits, cloned in full and shallow:
 *
 *   A adds a.md and b.md
 *   B edits a.md
 *   C edits b.md
 *   D adds an unrelated file
 *
 * A depth-1 clone holds only D, so it cannot know when a.md or b.md last
 * changed. A depth-3 clone holds D, C and B: it sees C change b.md, but B is
 * its boundary, so it cannot tell B from an older change to a.md.
 *
 * The pages live under `site/`, the Astro project directory, and are named by
 * the path the content loader reports: relative to that directory.
 */
const root = mkdtempSync(join(tmpdir(), 'translation-state-'))
const origin = join(root, 'origin')
const sha: Record<string, string> = {}
const LOADER_PATH = (page: string) => `src/content/docs/${page}`

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', stdio: 'pipe' }).trim()

function commit(name: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(origin, path)), { recursive: true })
    writeFileSync(join(origin, path), text)
  }
  git(origin, 'add', '-A')
  git(origin, 'commit', '-q', '-m', name)
  sha[name] = git(origin, 'rev-parse', 'HEAD')
}

function clone(name: string, ...options: string[]) {
  const directory = join(root, name)
  git(root, 'clone', '-q', ...options, `file://${origin}`, directory)
  return directory
}

const checkouts: Record<string, string> = {}

beforeAll(() => {
  mkdirSync(origin, { recursive: true })
  git(origin, 'init', '-q', '-b', 'main')
  commit('A', { [`site/${LOADER_PATH('a.md')}`]: 'one', [`site/${LOADER_PATH('b.md')}`]: 'one' })
  commit('B', { [`site/${LOADER_PATH('a.md')}`]: 'two' })
  commit('C', { [`site/${LOADER_PATH('b.md')}`]: 'two' })
  commit('D', { 'other.txt': 'unrelated' })
  checkouts.full = clone('full')
  checkouts.depth1 = clone('depth1', '--depth', '1')
  checkouts.depth3 = clone('depth3', '--depth', '3')
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

/** The state of `page`, declared as made from `declared`, in a build whose Astro root is the checkout's `site/`. */
function stateOf(checkout: string, page: 'a.md' | 'b.md', declared: string) {
  project.root = pathToFileURL(`${join(checkouts[checkout]!, 'site')}/`)
  return translationState(
    { id: `ja/${page}`, data: { source_commit: declared }, filePath: LOADER_PATH(`ja/${page}`) } as unknown as CollectionEntry<'docs'>,
    { id: page, data: {}, filePath: LOADER_PATH(page) } as unknown as CollectionEntry<'docs'>,
  )
}

describe('translationState against a full history', () => {
  it('reads current only for the commit that last changed the page', () => {
    expect(stateOf('full', 'a.md', sha.B!)).toBe('translated')
    expect(stateOf('full', 'a.md', sha.A!)).toBe('stale')
    expect(stateOf('full', 'b.md', sha.C!)).toBe('translated')
    expect(stateOf('full', 'b.md', sha.B!)).toBe('stale')
  })
})

describe('translationState against a shallow checkout', () => {
  it('does not read the boundary commit as the page last changing there', () => {
    // A depth-1 clone answers HEAD for every file. The pages did not change in D.
    expect(stateOf('depth1', 'a.md', sha.B!)).toBe('translated')
    expect(stateOf('depth1', 'b.md', sha.C!)).toBe('translated')
  })

  it('still reads a change that its history shows', () => {
    expect(stateOf('depth3', 'b.md', sha.C!)).toBe('translated')
    expect(stateOf('depth3', 'b.md', sha.B!)).toBe('stale')
  })

  it('cannot tell a change at its own boundary from an older one', () => {
    expect(stateOf('depth3', 'a.md', sha.B!)).toBe('translated')
  })
})

describe('lastCommitOf from different starting directories', () => {
  // A build runs from the project directory, but nothing says a test or a
  // script does. Each lookup runs in a process of its own, started in the
  // directory named, because a process cannot change directory inside a
  // worker thread.
  const MODULE = pathToFileURL(fileURLToPath(new URL('../src/i18n/last-commit.ts', import.meta.url))).href
  const program = `import { lastCommitOf } from ${JSON.stringify(MODULE)}
process.stdout.write(String(lastCommitOf(process.argv[1], process.argv[2])))`

  it('resolves the loader path against the Astro root, not the directory it starts in', () => {
    const site = join(checkouts.full!, 'site')
    for (const cwd of [site, checkouts.full!, root]) {
      const out = execFileSync(process.execPath, ['--input-type=module', '-e', program, LOADER_PATH('b.md'), site], { cwd, encoding: 'utf8' })
      expect(out, `started in ${cwd}`).toBe(sha.C)
    }
  })
})
