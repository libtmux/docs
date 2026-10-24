import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * `just clean` removes ignored output and nothing the build depends on.
 *
 * The recipes run in a scratch repository that has this repository's own
 * .gitignore plus the .env rules a developer adds. The build cache and the lock
 * file are ignored, so only the recipe's exclusions keep them. `pnpm run clean`
 * remains the build-aware clean of generated site output.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const scratch = mkdtempSync(join(tmpdir(), 'just-clean-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

/** The command lines of one recipe, read from the justfile the project ships. */
export function recipe(justfile: string, name: string): string[] {
  const lines = justfile.split('\n')
  const start = lines.findIndex((line) => line.startsWith(`${name}:`))
  if (start === -1) throw new Error(`no recipe named ${name}`)
  const body: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (!/^\s+\S/.test(line)) break
    body.push(line.trim())
  }
  return body
}

/** A repository with ignored, kept and untracked files, ready to be cleaned. */
function fixture(): string {
  const dir = mkdtempSync(join(scratch, 'repo-'))
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir })
  git('init', '-q')
  copyFileSync(join(ROOT, '.gitignore'), join(dir, '.gitignore'))
  writeFileSync(join(dir, '.gitignore'), `${readFileSync(join(dir, '.gitignore'), 'utf8')}.env\n.env.*\n`)
  git('add', '.gitignore')
  git('commit', '-q', '-m', 'ignore rules')
  for (const path of ['node_modules/pkg/index.js', '.build-cache/shell-1/page.html', '_site/index.html', 'sub/.env']) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), 'x\n')
  }
  for (const path of ['.build.lock', '.env', '.env.local', 'untracked.txt', 'debug.log']) writeFileSync(join(dir, path), 'x\n')
  return dir
}

function run(dir: string, command: string): string[] {
  return execFileSync('sh', ['-c', command], { cwd: dir, encoding: 'utf8' }).split('\n').filter(Boolean)
}

describe('just clean', () => {
  const justfile = readFileSync(join(ROOT, 'justfile'), 'utf8')
  const exclusions = (command: string) => command.match(/-e '[^']+'/g) ?? []

  it('lists ignored output and keeps the build cache, the lock and .env files', () => {
    const [command] = recipe(justfile, 'clean-dry')
    const listed = run(fixture(), command)
    expect(listed).toContain('Would remove node_modules/')
    expect(listed).toContain('Would remove _site/')
    expect(listed).toContain('Would remove debug.log')
    for (const kept of ['.build-cache', '.build.lock', '.env', '.env.local', 'sub/', 'untracked.txt']) {
      expect(listed.filter((line) => line.includes(kept))).toEqual([])
    }
  })

  it('removes what the dry run lists and nothing more', () => {
    const dir = fixture()
    const [command] = recipe(justfile, 'clean')
    run(dir, command)
    const left = run(dir, 'find . -path ./.git -prune -o -type f -print').sort()
    expect(left).toEqual([
      './.build-cache/shell-1/page.html',
      './.build.lock',
      './.env',
      './.env.local',
      './.gitignore',
      './sub/.env',
      './untracked.txt',
    ])
  })

  it('previews with the exclusions it deletes with', () => {
    expect(exclusions(recipe(justfile, 'clean')[0])).toEqual(exclusions(recipe(justfile, 'clean-dry')[0]))
  })

  it('would delete the cache, the lock and .env files without the exclusions', () => {
    const listed = run(fixture(), 'git clean -ndX')
    for (const removed of ['.build-cache/', '.build.lock', '.env', '.env.local']) {
      expect(listed.filter((line) => line.includes(removed))).not.toEqual([])
    }
  })

  it('reads a recipe body and rejects an unknown recipe', () => {
    expect(recipe('a:\n    one\n    two\n\nb:\n    three\n', 'a')).toEqual(['one', 'two'])
    expect(() => recipe('a:\n    one\n', 'missing')).toThrow('no recipe named missing')
  })
})
