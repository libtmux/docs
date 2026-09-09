import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DOC_PRODUCTS, PORTS } from '../src/lib/ports'

const workflow = readFileSync(new URL('../../.github/workflows/deploy-shell.yml', import.meta.url), 'utf8')
const publishStep = workflow.split('      - name: Sync top-level directories, denylist-checked\n')[1]?.split('\n      # Only the two entry points')[0]
const inline = publishStep?.split('        run: |\n')[1]
if (!inline) throw new Error('Production shell publisher was not found in deploy-shell.yml')
const script = inline.split('\n').map((line) => line.replace(/^ {10}/, '')).join('\n')
const scratch: string[] = []
afterEach(() => scratch.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })))

function write(path: string, value = '<html>Documentation</html>'): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, value)
}

function fixture(products = false): string {
  const directory = mkdtempSync(join(tmpdir(), 'libtmux-publish-prefixes-'))
  scratch.push(directory)
  write(join(directory, 'reserved-prefixes.txt'), PORTS.map((port) => port.slug).join('\n') + '\n')
  write(join(directory, 'reserved-products.txt'), Object.keys(DOC_PRODUCTS).join('\n') + '\n')
  write(join(directory, 'dist/index.html'))
  write(join(directory, 'dist/robots.txt'), 'User-agent: *\n')
  write(join(directory, 'dist/_astro/shell.js'), 'export {}\n')
  for (const port of PORTS) {
    write(join(directory, `dist/${port.slug}/index.html`))
    if (products) for (const product of Object.keys(DOC_PRODUCTS)) {
      write(join(directory, `dist/${port.slug}/latest/${product}/index.html`))
      write(join(directory, `dist/${port.slug}/latest/${product}/tools.json`), '{}\n')
    }
  }
  const recorder = join(directory, 'record-aws.mjs')
  write(recorder, "import { appendFileSync } from 'node:fs'; appendFileSync(process.env.AWS_RECORD, JSON.stringify(process.argv.slice(2)) + '\\n');\n")
  const executable = join(directory, 'bin/aws')
  mkdirSync(dirname(executable), { recursive: true })
  writeFileSync(executable, '#!/bin/bash\nexec "$PUBLISH_TEST_NODE" "$PUBLISH_TEST_RECORDER" "$@"\n', { mode: 0o755 })
  return directory
}

function publish(directory: string, locale = 'en') {
  const record = join(directory, 'aws.jsonl')
  const result = spawnSync('bash', ['-c', script.replaceAll('${{ matrix.locale }}', locale)], {
    cwd: directory, encoding: 'utf8', timeout: 10000,
    env: {
      ...process.env, PATH: `${join(directory, 'bin')}:${process.env.PATH}`, BUCKET: 'docs-test',
      RUNNER_TEMP: directory, AWS_RECORD: record,
      PUBLISH_TEST_NODE: process.execPath, PUBLISH_TEST_RECORDER: join(directory, 'record-aws.mjs'),
    },
  })
  expect(result.error, result.stderr).toBeUndefined()
  const commands = existsSync(record) ? readFileSync(record, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as string[]) : []
  return { ...result, commands }
}

describe('production shell publication boundaries', () => {
  it.each(['en', 'ja'])('publishes %s products without replacing port, version, native API, or historical prefixes', (locale) => {
    const result = publish(fixture(true), locale)
    expect(result.status, result.stderr).toBe(0)
    const syncs = result.commands.filter((args) => args[0] === 's3' && args[1] === 'sync')
    const destinations = syncs.map((args) => args[3])
    expect(destinations).toContain(`s3://docs-test/${locale}/_astro/`)
    for (const port of PORTS) for (const product of Object.keys(DOC_PRODUCTS)) {
      expect(destinations).toContain(`s3://docs-test/${locale}/${port.slug}/latest/${product}/`)
    }
    const productPrefixes = new Set(PORTS.flatMap((port) => Object.keys(DOC_PRODUCTS)
      .map((product) => `s3://docs-test/${locale}/${port.slug}/latest/${product}/`)))
    for (const args of syncs) {
      const destination = args[3]
      expect(args).toContain('--delete')
      expect(destination === `s3://docs-test/${locale}/_astro/` || productPrefixes.has(destination), destination).toBe(true)
      for (const port of PORTS) for (const preserved of ['latest/api/index.html', 'stable/api/index.html', 'v0.1.0/mcp/index.html']) {
        expect(`s3://docs-test/${locale}/${port.slug}/${preserved}`.startsWith(destination), `${destination} preserves ${preserved}`).toBe(false)
      }
    }
    const copies = result.commands.filter((args) => args[1] === 'cp')
    expect(copies.some((args) => args.includes('--recursive'))).toBe(false)
    expect(copies.map((args) => args[3]).sort()).toEqual([
      ...PORTS.map((port) => `s3://docs-test/${locale}/${port.slug}/index.html`),
      `s3://docs-test/${locale}/index.html`, `s3://docs-test/${locale}/robots.txt`, 's3://docs-test/robots.txt',
    ].sort())
  })

  it.each([
    'py/latest/api/index.html', 'go/stable/mcp/index.html', 'go/v0.1.0/mcp/index.html',
    'go/unknown/index.html', 'go/.unknown/index.html', 'go/latest/unknown/index.html', 'go/latest/.unknown/index.html',
  ])('rejects unexpected %s before any AWS operation', (path) => {
    const directory = fixture()
    write(join(directory, 'dist', path))
    const result = publish(directory)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('::error::')
    expect(result.commands).toEqual([])
  })

  it('rejects the reserved manifest prefix before any AWS operation', () => {
    const directory = fixture()
    write(join(directory, 'dist/manifest/index.html'))
    const result = publish(directory)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('::error::')
    expect(result.commands).toEqual([])
  })

  it('rejects missing port metadata before any AWS operation', () => {
    const directory = fixture(true)
    rmSync(join(directory, 'reserved-prefixes.txt'))
    const result = publish(directory)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('reserved-prefixes.txt')
    expect(result.commands).toEqual([])
  })

  it('rejects missing product metadata before any AWS operation', () => {
    const directory = fixture(true)
    rmSync(join(directory, 'reserved-products.txt'))
    const result = publish(directory)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('reserved-products.txt')
    expect(result.commands).toEqual([])
  })

  it.each(['.outside', '_astro/outside', 'go/latest/mcp/outside'])('rejects symlink %s before any AWS operation', (path) => {
    const directory = fixture(true)
    write(join(directory, 'outside/index.html'))
    symlinkSync(join(directory, 'outside'), join(directory, 'dist', path), 'dir')
    const result = publish(directory)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('symlink')
    expect(result.commands).toEqual([])
  })
})
