import { execFile, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../', import.meta.url))
const runFile = promisify(execFile)

it('rejects stale sources and keeps native doctest output checks', async () => {
  const started = performance.now()
  const names: string[] = JSON.parse(execFileSync('python3', ['-B', 'scripts/test_example_sources.py', '--list-tests'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }))
  expect(Array.isArray(names) && names.every((name) => typeof name === 'string')).toBe(true)
  expect(names.length).toBeGreaterThan(0)
  expect(new Set(names).size).toBe(names.length)
  const shards = Array.from({ length: Math.min(4, names.length) }, () => [] as string[])
  names.forEach((name, index) => shards[index % shards.length].push(name))
  const timeout = 10_000 - Math.ceil(performance.now() - started)
  if (timeout <= 0) throw new Error('Source test discovery exhausted the ten-second deadline')
  const results = await Promise.allSettled(shards.map((shard) => runFile('python3', [
    '-B', 'scripts/test_example_sources.py', ...shard, '-v',
  ], {
    cwd: root,
    encoding: 'utf8',
    timeout: Math.max(1, 10_000 - Math.ceil(performance.now() - started)),
  })))
  const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason)
  if (performance.now() - started >= 10_000) failures.push(new Error('Native doctest source checks exceeded the ten-second deadline'))
  if (failures.length) throw new AggregateError(failures, 'Native doctest source checks failed')
}, 15_000)

it('reaps example processes after failure, timeout and controller death', () => {
  const output = execFileSync('python3', ['-B', 'scripts/test_example_environment.py', '-v'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  expect(output).toContain('Runner receipts:')
}, 35_000)
