import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('keeps the Python lint boundary around docs-owned source', { timeout: 5_000 }, () => {
  const result = spawnSync('uv', ['run', '--locked', '--offline', 'python', '-B', '-m', 'pytest', '-q', '-p', 'no:cacheprovider', 'packages/api-model/test/test_python_scope.py'], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)), encoding: 'utf8', timeout: 3_000,
  })
  expect(result.error).toBeUndefined()
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(result.stdout).toMatch(/1 passed/)
})
