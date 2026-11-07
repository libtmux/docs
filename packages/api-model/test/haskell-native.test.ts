import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('preserves native Haskell declarations and source/exporter provenance', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  const result = spawnSync('python3', ['-m', 'unittest', 'packages/api-model/test/test_haskell_export.py'], {
    cwd: root, encoding: 'utf8',
  })
  expect(result.error).toBeUndefined()
  expect(result.status, result.stderr).toBe(0)
  expect(result.stderr).toMatch(/Ran [1-9]\d* tests?/)
})
