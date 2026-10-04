import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'

const publicationAudit = readFileSync(new URL('../../scripts/test-all.sh', import.meta.url), 'utf8')

describe('publication server deadlines', () => {
  it('skips an optional browser audit when its server accepts a connection but never responds', async () => {
    const server = createServer((socket) => socket.destroy())
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('missing probe server address')
      const probes = [...publicationAudit.matchAll(/if (curl [^\n]+); then/g)].map((match) => match[1])
      expect(probes).toHaveLength(2)
      expect(probes[1]).toContain('--connect-timeout 1 --max-time 3')
      // spawnSync blocks this process from handling the accepted connection,
      // so the real curl must hit its deadline instead of receiving a reply.
      const started = performance.now()
      const result = spawnSync('bash', ['-c', `exec ${probes[0]}`], {
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, SERVE_SITE: `http://127.0.0.1:${address.port}` },
      })
      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr).toBe(28)
      expect(performance.now() - started).toBeGreaterThanOrEqual(2500)
    } finally {
      server.close()
    }
  }, 8000)
})
