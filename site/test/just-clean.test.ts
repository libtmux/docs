import { execFileSync, spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process'
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
 * file are ignored, so only the recipe's exclusions keep them. Both deleting
 * recipes refuse while an assembly holds .build.lock, as `pnpm run clean` does.
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

/** The `git clean` line of a recipe body. */
function gitClean(body: string[]): string {
  const line = body.find((candidate) => candidate.startsWith('git clean'))
  if (line === undefined) throw new Error('recipe has no git clean line')
  return line
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

let scripts = 0

/** Runs a recipe body the way `just` does: a shebang body as a script, else one shell line. */
function attempt(dir: string, body: string[]): SpawnSyncReturns<string> {
  if (body[0]?.startsWith('#!')) {
    const script = join(scratch, `recipe-${scripts++}.sh`)
    writeFileSync(script, `${body.join('\n')}\n`)
    return spawnSync('bash', [script], { cwd: dir, encoding: 'utf8' })
  }
  return spawnSync('sh', ['-c', body.join('\n')], { cwd: dir, encoding: 'utf8' })
}

function run(dir: string, body: string[]): string[] {
  const result = attempt(dir, body)
  if (result.status !== 0) throw new Error(`recipe exited ${result.status}: ${result.stderr}`)
  return result.stdout.split('\n').filter(Boolean)
}

/** Every file in the repository outside .git, as the recipes leave it. */
function files(dir: string): string[] {
  return execFileSync('find', ['.', '-path', './.git', '-prune', '-o', '-type', 'f', '-print'], { cwd: dir, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .sort()
}

/** Holds `.build.lock` as an assembly does, until the returned function releases it. */
async function holdLock(dir: string): Promise<() => Promise<void>> {
  const holder = spawn('flock', [join(dir, '.build.lock'), 'sh', '-c', 'echo held; read release'], { stdio: ['pipe', 'pipe', 'inherit'] })
  await new Promise<void>((resolve, reject) => {
    holder.once('error', reject)
    holder.stdout.once('data', () => resolve())
  })
  return () =>
    new Promise<void>((resolve) => {
      holder.once('exit', () => resolve())
      holder.stdin.end('\n')
    })
}

describe('just clean', () => {
  const justfile = readFileSync(join(ROOT, 'justfile'), 'utf8')
  const exclusions = (command: string) => command.match(/-e '[^']+'/g) ?? []

  it('lists ignored output and keeps the build cache, the lock and .env files', () => {
    const listed = run(fixture(), recipe(justfile, 'clean-dry'))
    expect(listed).toContain('Would remove node_modules/')
    expect(listed).toContain('Would remove _site/')
    expect(listed).toContain('Would remove debug.log')
    for (const kept of ['.build-cache', '.build.lock', '.env', '.env.local', 'sub/', 'untracked.txt']) {
      expect(listed.filter((line) => line.includes(kept))).toEqual([])
    }
  })

  it('removes what the dry run lists and nothing more', () => {
    const dir = fixture()
    run(dir, recipe(justfile, 'clean'))
    expect(files(dir)).toEqual([
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
    expect(exclusions(gitClean(recipe(justfile, 'clean')))).toEqual(exclusions(gitClean(recipe(justfile, 'clean-dry'))))
  })

  it('would delete the cache, the lock and .env files without the exclusions', () => {
    const listed = run(fixture(), ['git clean -ndX'])
    for (const removed of ['.build-cache/', '.build.lock', '.env', '.env.local']) {
      expect(listed.filter((line) => line.includes(removed))).not.toEqual([])
    }
  })

  it('reads a recipe body and rejects an unknown recipe', () => {
    expect(recipe('a:\n    one\n    two\n\nb:\n    three\n', 'a')).toEqual(['one', 'two'])
    expect(() => recipe('a:\n    one\n', 'missing')).toThrow('no recipe named missing')
  })
})

describe.each(['clean', 'nuke'])('just %s while an assembly runs', (name) => {
  const justfile = readFileSync(join(ROOT, 'justfile'), 'utf8')

  it('refuses while .build.lock is held, deletes nothing, and runs once it is released', async () => {
    const dir = fixture()
    const before = files(dir)
    const release = await holdLock(dir)
    try {
      const refused = attempt(dir, recipe(justfile, name))
      expect(refused.status).toBe(1)
      expect(refused.stderr).toContain('an assembly holds .build.lock')
      expect(files(dir)).toEqual(before)
    } finally {
      await release()
    }
    const ran = attempt(dir, recipe(justfile, name))
    expect(ran.status).toBe(0)
    expect(files(dir)).not.toContain('./debug.log')
    expect(files(dir)).not.toEqual(before)
  })
})

describe('just clean-dry while an assembly runs', () => {
  it('previews anyway, since it deletes nothing', async () => {
    const justfile = readFileSync(join(ROOT, 'justfile'), 'utf8')
    const dir = fixture()
    const release = await holdLock(dir)
    try {
      const preview = attempt(dir, recipe(justfile, 'clean-dry'))
      expect(preview.status).toBe(0)
      expect(preview.stdout).toContain('Would remove node_modules/')
    } finally {
      await release()
    }
  })
})
