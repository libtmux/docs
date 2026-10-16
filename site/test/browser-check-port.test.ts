import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../scripts/check-dev.mjs', import.meta.url), 'utf8')
// Exercise the script's configuration without creating a mirror or server.
const settings = source.slice(source.indexOf('const sampleOnly ='), source.indexOf('Object.assign(process.env,'))
const start = source.slice(source.indexOf('const startServer ='), source.indexOf('server = await startServer()'))
function config(port?: string, args: string[] = []) {
  return runInNewContext(`${settings}\n${start}\nstartServer()`, {
    process: { env: port === undefined ? {} : { LIBTMUX_DOCS_BROWSER_PORT: port }, argv: args },
    PORTS: [], productAvailable: () => false, assert, join, root: '/site', mirror: '/mirror',
    dev: (options: unknown) => options,
  })
}

describe('browser check port selection', () => {
  it.each([[], ['--sample']])('keeps an ephemeral port for automated checks %j', (...args) => {
    const options = config(undefined, args)
    expect(options.server.port).toBe(0)
    expect(options.vite.server?.strictPort).toBeUndefined()
  })

  it('keeps the existing serve default', () => {
    expect(config(undefined, ['--serve']).server.port).toBe(53971)
  })

  it.each(['1', '53971', '65535'])('uses explicit port %s without fallback', (port) => {
    for (const args of [[], ['--sample'], ['--serve']]) {
      const options = config(port, args)
      expect(options.server.port).toBe(Number(port))
      expect(options.vite.server.strictPort).toBe(true)
    }
  })

  it.each(['', '0', '-1', '65536', '1.5', '1e3', '0x50', ' 80 ', 'NaN', 'Infinity'])('rejects invalid explicit port %j', (port) => {
    expect(() => config(port)).toThrow('LIBTMUX_DOCS_BROWSER_PORT must be an integer from 1 to 65535')
  })
})
