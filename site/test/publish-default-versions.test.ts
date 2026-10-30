import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { PORTS } from '../src/lib/ports'

// The publisher the deploy runs, not a copy of it.
const script = fileURLToPath(new URL('../../scripts/publish-default-versions.sh', import.meta.url))
const KVS_ARN = 'arn:aws:cloudfront::123456789012:key-value-store/test'

const scratch: string[] = []
afterEach(() => scratch.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })))

// A recording `aws` that answers the two reads from a fixed store, and fails
// whichever subcommand FAIL names. A manifest is written only when a test
// passes `defaultVersion`, since the publisher must not depend on one.
function fixture(storeItems: { Key: string; Value: string }[], defaultVersion?: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), 'libtmux-publish-default-versions-'))
  scratch.push(directory)
  writeFileSync(join(directory, 'reserved-prefixes.txt'), `${PORTS.map((port) => port.slug).join('\n')}\n`)
  if (defaultVersion) {
    mkdirSync(join(directory, 'dist'), { recursive: true })
    writeFileSync(join(directory, 'dist/versions.json'), JSON.stringify({ schema: 1, ports: {}, defaultVersion }))
  }
  writeFileSync(join(directory, 'store.json'), JSON.stringify({ Items: storeItems }))
  const executable = join(directory, 'bin/aws')
  mkdirSync(dirname(executable), { recursive: true })
  writeFileSync(executable, [
    '#!/bin/bash',
    'printf \'%s\\t\' "$@" >> "$AWS_RECORD"; echo >> "$AWS_RECORD"',
    'if [[ "$2" == "${FAIL:-}" ]]; then echo "An error occurred (AccessDenied)" >&2; exit 254; fi',
    'if [[ "$2" == describe-key-value-store ]]; then echo \'{"ETag":"etag-1"}\'',
    'elif [[ "$2" == list-keys ]]; then cat "$STORE_FILE"; fi',
  ].join('\n') + '\n', { mode: 0o755 })
  return directory
}

function publish(directory: string, env: Record<string, string> = {}) {
  const record = join(directory, 'aws.tsv')
  const result = spawnSync('bash', [script], {
    cwd: directory, encoding: 'utf8', timeout: 10000,
    env: {
      ...process.env, PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
      KVS_ARN, AWS_RECORD: record, STORE_FILE: join(directory, 'store.json'), ...env,
    },
  })
  expect(result.error, result.stderr).toBeUndefined()
  // Split without trimming: the recorder ends each line with a tab, and a
  // whole-file trim would drop the last call's final argument.
  const commands = existsSync(record)
    ? readFileSync(record, 'utf8').split('\n').filter((line) => line.length > 0)
      .map((line) => line.split('\t').slice(0, -1))
    : []
  return { ...result, commands }
}

const subcommands = (commands: string[][]) => commands.map((args) => args[1])

const rowFor = (port: { slug: string }, value: string) => ({ Key: `${port.slug}:default`, Value: value })
const putsOf = (commands: string[][]) => {
  const update = commands.find((args) => args[1] === 'update-keys')
  return update ? update.slice(update.indexOf('--puts') + 1) : []
}

describe('shell default-version publication', { timeout: 30_000 }, () => {
  it('points every port root at "latest", whatever versions.json pins as the default', () => {
    const directory = fixture([], Object.fromEntries(PORTS.map((port) => [port.slug, 'v0.46.2'])))
    const result = publish(directory)
    expect(result.status, result.stderr).toBe(0)
    expect(putsOf(result.commands).sort()).toEqual(
      PORTS.map((port) => `Key=${port.slug}:default,Value=latest`).sort(),
    )
  })

  it('writes a row for each listed slug and none for a slug only the manifest names', () => {
    const directory = fixture([], { py: 'v0.46.2', tmux: 'v1' })
    writeFileSync(join(directory, 'reserved-prefixes.txt'), 'py\n\nts\n')
    const result = publish(directory)
    expect(result.status, result.stderr).toBe(0)
    expect(putsOf(result.commands).sort()).toEqual(['Key=py:default,Value=latest', 'Key=ts:default,Value=latest'])
  })

  it('needs no version manifest', () => {
    const directory = fixture([])
    expect(existsSync(join(directory, 'dist/versions.json'))).toBe(false)
    const result = publish(directory)
    expect(result.status, result.stderr).toBe(0)
    expect(putsOf(result.commands)).toHaveLength(PORTS.length)
  })

  it('rewrites only the rows that still hold a pinned release', () => {
    const [first, ...rest] = PORTS
    const directory = fixture([rowFor(first, 'latest'), ...rest.map((port) => rowFor(port, 'v0.46.2'))])
    const result = publish(directory)
    expect(result.status, result.stderr).toBe(0)
    const update = result.commands.find((args) => args[1] === 'update-keys')
    expect(update, result.stderr).toBeDefined()
    expect(update).toEqual(expect.arrayContaining(['--if-match', 'etag-1']))
    expect(putsOf(result.commands).sort()).toEqual(
      rest.map((port) => `Key=${port.slug}:default,Value=latest`).sort(),
    )
  })

  it('writes nothing when every row already matches the store', () => {
    const directory = fixture(PORTS.map((port) => rowFor(port, 'latest')))
    const result = publish(directory)
    expect(result.status, result.stderr).toBe(0)
    expect(subcommands(result.commands)).toEqual(['describe-key-value-store', 'list-keys'])
  })

  it('rejects missing port metadata before any AWS operation', () => {
    const directory = fixture([])
    rmSync(join(directory, 'reserved-prefixes.txt'))
    const result = publish(directory)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('reserved-prefixes.txt')
    expect(result.commands).toEqual([])
  })

  it('warns and skips when KVS_ARN is unset', () => {
    const directory = fixture([])
    const result = publish(directory, { KVS_ARN: '' })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toContain('::warning::KVS_ARN is not set')
    expect(result.commands).toEqual([])
  })

  it.each(['describe-key-value-store', 'list-keys'])('fails without writing when %s fails', (failing) => {
    const directory = fixture([])
    const result = publish(directory, { FAIL: failing })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('AccessDenied')
    expect(subcommands(result.commands)).not.toContain('update-keys')
  })
})
