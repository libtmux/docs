import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, truncateSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { expect } from 'vitest'

/** The largest object, in bytes, that CloudFront compresses itself. */
export const CLOUDFRONT_LIMIT = 10_000_000

export interface Upload {
  /** The object key as `s3://bucket/key`. */
  key: string
  /** The local file, relative to the directory the publisher ran in. */
  source: string
  args: string[]
}

/**
 * A `aws` that records each call, and keeps a copy of every file a `cp`
 * uploads: the publisher gzips into a scratch file it deletes afterwards.
 * Returns the environment that puts it on PATH.
 */
export function recordingAws(directory: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const executable = join(directory, 'bin/aws')
  mkdirSync(dirname(executable), { recursive: true })
  writeFileSync(executable, `#!/bin/bash
printf "%s\\0" "$#" "$@" >> "$AWS_RECORD"
if [[ "$1 $2" == "s3 cp" && -f "$3" && "$4" == s3://* ]]; then
  mkdir -p "$AWS_UPLOADS"
  cp "$3" "$AWS_UPLOADS/$(printf '%s' "$4" | tr '/:' '__')"
fi
`)
  chmodSync(executable, 0o755)
  return {
    ...process.env, PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
    AWS_RECORD: join(directory, 'aws.args'), AWS_UPLOADS: join(directory, 'aws.uploads'), ...extra,
  }
}

/** The calls `recordingAws` recorded, one argument list each. */
export function recordedCommands(directory: string): string[][] {
  const record = join(directory, 'aws.args')
  const fields = existsSync(record) ? readFileSync(record, 'utf8').split('\0').slice(0, -1) : []
  const commands: string[][] = []
  for (let index = 0; index < fields.length;) {
    const count = Number(fields[index++])
    expect(Number.isSafeInteger(count) && count >= 0 && index + count <= fields.length).toBe(true)
    commands.push(fields.slice(index, index + count))
    index += count
  }
  return commands
}

/** The bytes `aws s3 cp` was given for an object. */
export const storedBytes = (directory: string, key: string): Buffer =>
  readFileSync(join(directory, 'aws.uploads', key.replace(/[/:]/g, '_')))

/**
 * `aws s3 sync`'s `--exclude`: a pattern read against the path inside the
 * source directory, with Python's `fnmatch` rules, which the CLI uses: `*`, `?`,
 * and `[...]` (`[!...]` negated); a `[` with no closing `]` is literal.
 */
export function excluded(pattern: string, path: string): boolean {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')
  let body = ''
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]!
    if (char === '*') body += '.*'
    else if (char === '?') body += '.'
    else if (char === '[') {
      let end = index + 1
      if (pattern[end] === '!') end++
      if (pattern[end] === ']') end++
      end = pattern.indexOf(']', end)
      if (end < 0) { body += '\\['; continue }
      let set = pattern.slice(index + 1, end)
      const negated = set.startsWith('!')
      if (negated) set = set.slice(1)
      body += `[${negated ? '^' : ''}${set.replace(/[\\\]^]/g, '\\$&')}]`
      index = end
    } else body += escape(char)
  }
  return new RegExp(`^${body}$`, 's').test(path)
}

const filesUnder = (root: string): string[] =>
  readdirSync(root, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))

/**
 * Every object the recorded `aws s3 cp` and `aws s3 sync` calls would write,
 * as the CLI decides it: a recursive copy or a sync sends each file under its
 * source that no `--exclude` names, and a copy of one file sends that file.
 */
export function uploads(commands: string[][], cwd: string): Upload[] {
  const sent: Upload[] = []
  for (const args of commands) {
    if (args[0] !== 's3' || (args[1] !== 'cp' && args[1] !== 'sync')) continue
    const [source, destination] = [args[2], args[3]]
    if (source.startsWith('s3://') || !destination.startsWith('s3://')) continue
    const patterns = args.flatMap((arg, index) => args[index - 1] === '--exclude' ? [arg] : [])
    const local = join(cwd, source)
    if (args[1] === 'sync' || args.includes('--recursive')) {
      for (const path of filesUnder(local).filter((path) => !patterns.some((pattern) => excluded(pattern, path)))) {
        sent.push({ key: `${destination.replace(/\/?$/, '/')}${path}`, source: join(source, path), args })
      }
    } else {
      sent.push({ key: destination, source, args })
    }
  }
  return sent
}

/** The value after a flag in an argument list. */
export const flag = (args: string[], name: string): string | undefined => args.includes(name) ? args[args.indexOf(name) + 1] : undefined

/**
 * A file `size` bytes long that starts with its own name. The rest is zeros,
 * so gzip shrinks it and a test can tell one file's bytes from another's.
 */
export function writeSized(path: string, size: number): void {
  mkdirSync(dirname(path), { recursive: true })
  const head = JSON.stringify({ path: path.slice(path.lastIndexOf('dist/') + 5) })
  writeFileSync(path, head)
  truncateSync(path, Math.max(size, head.length))
}

/** The policy of every object under an `_astro` directory, whose names carry a content hash. */
export const IMMUTABLE = 'public, max-age=31536000, immutable'

/**
 * Hold what the publisher did to everything under `dist`, as the CLI would
 * carry it out: each JSON file above CloudFront's limit reaches `keyPrefix`
 * once, gzip-encoded, as JSON, under `cacheControl` (the immutable policy
 * inside an `_astro` directory), and decodes to the build's bytes; every other
 * file reaches it once, as it is. Returns the large files, so a caller can
 * hold that there were some.
 */
export function expectLargeJsonGzipped(directory: string, dist: string, keyPrefix: string, cacheControl: string): string[] {
  const sent = uploads(recordedCommands(directory), directory)
  const large: string[] = []
  for (const path of filesUnder(join(directory, dist))) {
    const file = join(directory, dist, path)
    const key = `${keyPrefix.replace(/\/$/, '')}/${path}`
    const objects = sent.filter((upload) => upload.key === key)
    expect(objects.map((upload) => upload.source), `${key} is written once`).toHaveLength(1)
    const [{ args }] = objects
    if (!path.endsWith('.json') || statSync(file).size <= CLOUDFRONT_LIMIT) {
      expect(args, `${key} keeps its bytes`).not.toContain('--content-encoding')
      continue
    }
    large.push(path)
    expect(flag(args, '--content-encoding'), `${key} is gzip-encoded`).toBe('gzip')
    expect(flag(args, '--content-type'), `${key} is JSON`).toBe('application/json')
    expect(flag(args, '--cache-control'), `${key} cache policy`).toBe(`/${path}`.includes('/_astro/') ? IMMUTABLE : cacheControl)
    expect(gunzipSync(storedBytes(directory, key)).equals(readFileSync(file)), `${key} decodes to the build`).toBe(true)
  }
  return large.sort()
}
