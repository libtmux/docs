#!/usr/bin/env node
// Mark every file the bucket already holds byte for byte, so the `aws s3 sync`
// calls in publish-root.sh skip it.
//
// Sync uploads a file when its size differs or its mtime is newer than the
// object's. Every build writes every file afresh, so without this each deploy
// re-uploaded the whole locale: over 43,000 objects and fifteen minutes for
// `en`, nearly all of them unchanged. Here a file whose MD5 and size match the
// object's ETag and size gets an mtime of the epoch, which sync reads as older
// and skips; anything else keeps its build mtime and is uploaded as before.
// Deletion is untouched: `--delete` still removes what the build dropped.
//
// An ETag is the content MD5 only for a single-part upload without SSE-KMS.
// Any other ETag matches no MD5, so that object is re-uploaded, never skipped.
//
// The one thing sync would then miss is a header change on unchanged content.
// An object written before --policy-since is always re-uploaded, so a change
// to the headers publish-root.sh sets moves that date with it
// (deploy-workflow.test.ts fails until it does).

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, utimesSync } from 'node:fs'
import { join, resolve } from 'node:path'

function fail(message) {
  throw new Error(`skip-unchanged: ${message}`)
}

function parseArgs(argv) {
  const options = { dir: undefined, bucket: undefined, prefix: undefined, policySince: undefined }
  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i]
    if (argument === '--dir') options.dir = argv[++i]
    else if (argument === '--bucket') options.bucket = argv[++i]
    else if (argument === '--prefix') options.prefix = argv[++i]
    else if (argument === '--policy-since') options.policySince = argv[++i]
    else fail(`unrecognised argument ${argument}`)
  }
  if (!options.dir || !options.bucket || !options.prefix || !options.policySince) {
    fail('usage: --dir DIRECTORY --bucket BUCKET --prefix PREFIX/ --policy-since DATE')
  }
  if (!options.prefix.endsWith('/')) fail(`prefix ${options.prefix} must end in /`)
  if (Number.isNaN(Date.parse(options.policySince))) fail(`policy-since ${options.policySince} is not a date`)
  return options
}

/**
 * The local paths, relative to the published directory, that the bucket
 * already holds unchanged and under the current header policy.
 *
 * @param {{ path: string, size: number, md5: string }[]} files
 * @param {{ Key: string, ETag: string, Size: number, LastModified: string }[]} objects
 * @param {string} prefix
 * @param {string} policySince
 */
export function unchanged(files, objects, prefix, policySince) {
  const since = Date.parse(policySince)
  const remote = new Map(objects.map((object) => [object.Key, object]))
  return files.filter(({ path, size, md5 }) => {
    const object = remote.get(`${prefix}${path}`)
    return object !== undefined
      && object.Size === size
      && object.ETag.replaceAll('"', '') === md5
      && Date.parse(object.LastModified) >= since
  }).map(({ path }) => path)
}

function localFiles(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const absolute = join(entry.parentPath, entry.name)
      const bytes = readFileSync(absolute)
      return {
        path: absolute.slice(directory.length + 1),
        size: bytes.length,
        md5: createHash('md5').update(bytes).digest('hex'),
      }
    })
}

function remoteObjects(bucket, prefix) {
  const out = execFileSync('aws', [
    's3api', 'list-objects-v2', '--bucket', bucket, '--prefix', prefix,
    '--query', 'Contents[].{Key: Key, ETag: ETag, Size: Size, LastModified: LastModified}',
    '--output', 'json',
  ], { encoding: 'utf8', maxBuffer: 1 << 30 })
  // An empty prefix lists as `null`, not `[]`.
  return JSON.parse(out || 'null') ?? []
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const directory = resolve(options.dir)
  if (!statSync(directory).isDirectory()) fail(`${options.dir} is not a directory`)
  const files = localFiles(directory)
  const skipped = unchanged(files, remoteObjects(options.bucket, options.prefix), options.prefix, options.policySince)
  for (const path of skipped) utimesSync(join(directory, path), 0, 0)
  process.stderr.write(`skip-unchanged: ${skipped.length} of ${files.length} file(s) unchanged, ${files.length - skipped.length} to upload\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
