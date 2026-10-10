import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../', import.meta.url))

it('reaps example processes after failure, timeout and controller death', () => {
  const output = execFileSync('python3', ['-B', 'scripts/test_example_environment.py', '-v'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  expect(output).toContain('Runner receipts:')
}, 35_000)
