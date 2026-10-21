#!/usr/bin/env node
/*
 * Hand an assembled tree from one CI job to the next as one verified archive.
 *
 * Artifacts upload one file at a time and the assembly holds a very large
 * number of them, so the audit jobs share it as a single compressed tar. The
 * archive is not trusted on its own: `pack` also records a digest of every
 * file, and `unpack` refuses to hand back a tree whose files do not hash to
 * it. The producing job passes the tree digest through a job output, a
 * channel the artifact cannot alter, and each consumer compares against that
 * too.
 *
 * The archive is also read before anything is extracted. A hostile archive can
 * carry the legitimate digest of the files it extracts and still write
 * elsewhere, so `unpack` lists it with the same tar binary and options that
 * extract it, which leaves no second parser to disagree about where a member
 * starts. From that listing it refuses an absolute name, a `..` segment, a
 * link that leads outside the destination, a member that passes through a
 * symlink or a file, a hard link to anything but an earlier regular file, a
 * repeated name, and any member that is not a file, directory or link.
 *
 * Usage:
 *   site-bundle.mjs pack   <tree> <bundle>              prints tree=, files=, bytes=
 *   site-bundle.mjs unpack <bundle> <tree> [--digest D] verifies, scans, extracts, verifies
 *   site-bundle.mjs verify <tree> <bundle> [--digest D] hashes an extracted tree
 */
import { createHash } from 'node:crypto'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const ARCHIVE = 'site.tar.zst'
const FILES = 'files.sha256'
const MANIFEST = 'manifest.json'
const DIGEST = /^[0-9a-f]{64}$/

/**
 * Text from an archive, on one line. CI reads `::command::` lines from the
 * logs, and a member name can hold a newline followed by one.
 */
const printable = (text) => Array.from(text, (char) => {
  const code = char.charCodeAt(0)
  if (code >= 0x20 && code !== 0x7f) return char
  return char === '\n' ? '\\n' : `\\x${code.toString(16).padStart(2, '0')}`
}).join('')

const fail = (message) => {
  console.error(`site-bundle: ${printable(message)}`)
  process.exit(1)
}
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

function hashFile(path) {
  const hash = createHash('sha256')
  const buffer = Buffer.allocUnsafe(1 << 20)
  const descriptor = openSync(path, 'r')
  try {
    for (let read = readSync(descriptor, buffer, 0, buffer.length, null); read > 0;
      read = readSync(descriptor, buffer, 0, buffer.length, null)) hash.update(buffer.subarray(0, read))
  } finally {
    closeSync(descriptor)
  }
  return hash.digest('hex')
}

/** One line per file and symlink, in code-unit order of the path. */
function inventory(root) {
  const entries = []
  let bytes = 0
  const walk = (directory) => {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = directory ? `${directory}/${entry.name}` : entry.name
      if (/[\r\n]/.test(path)) fail(`a path holds a line break: ${JSON.stringify(path)}`)
      const full = join(root, path)
      if (entry.isDirectory()) walk(path)
      else if (entry.isSymbolicLink()) entries.push([path, `l ${sha256(readlinkSync(full))} 0 ${path}`])
      else if (entry.isFile()) {
        const size = lstatSync(full).size
        bytes += size
        entries.push([path, `f ${hashFile(full)} ${size} ${path}`])
      } else fail(`neither a file nor a symlink: ${path}`)
    }
  }
  walk('')
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const lines = entries.map(([, line]) => line)
  return { lines, bytes, tree: sha256(`${lines.join('\n')}\n`) }
}

function requireZstd() {
  try {
    execFileSync('zstd', ['--version'], { stdio: 'ignore' })
  } catch {
    fail('zstd is required to pack or unpack a bundle')
  }
}

const manifestOf = (bundle) => {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(bundle, MANIFEST), 'utf8'))
  } catch {
    fail(`${join(bundle, MANIFEST)} is missing or is not JSON`)
  }
  if (manifest.schema !== 1 || !DIGEST.test(manifest.tree ?? '') || !DIGEST.test(manifest.tar ?? '')) {
    fail(`${join(bundle, MANIFEST)} does not describe a bundle`)
  }
  return manifest
}

function expectDigest(actual, expected, what) {
  if (expected !== undefined && !DIGEST.test(expected)) fail('--digest takes a sha256')
  if (expected !== undefined && actual !== expected) {
    fail(`${what} hashes to ${actual}, not the ${expected} the producing job reported`)
  }
}

/**
 * What lists an archive also extracts it, with the same options, so the two
 * cannot read member boundaries differently. Names and link targets come back
 * C-quoted, one member per line, whatever bytes they hold.
 */
const TAR_OPTIONS = ['--use-compress-program=unzstd', '--no-same-owner', '--numeric-owner', '--quoting-style=c']
const TAR_ENV = { ...process.env, LC_ALL: 'C', TAR_OPTIONS: '' }
const LISTING = /^(\S)\S{9} +\S+ +\S+ +\S+ +\S+ +("(?:[^"\\]|\\.)*")(?: (?:->|link to) ("(?:[^"\\]|\\.)*"))?$/
const KINDS = { '-': 'file', d: 'dir', l: 'symlink', h: 'hard link' }
const ESCAPES = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, '\\': 92, '"': 34 }

/** The bytes a C-quoted token stands for. */
function unquote(token) {
  const body = token.slice(1, -1)
  const bytes = []
  for (let at = 0; at < body.length; at += 1) {
    if (body[at] !== '\\') bytes.push(body.charCodeAt(at))
    else if (/[0-7]/.test(body[at + 1])) {
      const octal = /^[0-7]{1,3}/.exec(body.slice(at + 1))[0]
      bytes.push(Number.parseInt(octal, 8) & 0xff)
      at += octal.length
    } else if (body[at + 1] in ESCAPES) {
      bytes.push(ESCAPES[body[at + 1]])
      at += 1
    } else fail(`tar quoted ${token} with an escape this check cannot read`)
  }
  return Buffer.from(bytes).toString('utf8')
}

/** Why a member path could leave the destination, if it could. */
function escapeOf(name) {
  if (name.startsWith('/')) return 'is an absolute path'
  if (name.split('/').includes('..')) return 'has a ".." path segment'
  return undefined
}
const segmentsOf = (name) => name.split('/').filter((segment) => segment !== '' && segment !== '.')

/**
 * Refuses an archive that could write outside the directory it is extracted
 * into, or through a link it creates, before tar has written a byte.
 */
async function scan(archive) {
  const kinds = new Map()
  const listed = new Set()
  const tar = spawn('tar', ['--list', '--verbose', '--full-time', ...TAR_OPTIONS, '-f', archive], { env: TAR_ENV, stdio: ['ignore', 'pipe', 'pipe'] })
  let said = ''
  tar.stderr.on('data', (chunk) => { said += chunk })
  const closed = new Promise((resolve) => tar.on('close', resolve))
  let count = 0
  for await (const line of createInterface({ input: tar.stdout, crlfDelay: Infinity })) {
    const parsed = LISTING.exec(line)
    if (!parsed) fail(`tar listed a member this check cannot read: ${line}`)
    const [, flag, quotedName, quotedLink] = parsed
    const name = unquote(quotedName)
    const link = quotedLink === undefined ? undefined : unquote(quotedLink)
    count += 1
    const kind = KINDS[flag]
    if (!kind) fail(`member "${name}" has the unsupported member type ${JSON.stringify(flag)}`)
    const problem = escapeOf(name)
    if (problem) fail(`member "${name}" ${problem}`)
    const segments = segmentsOf(name)
    const path = segments.join('/')
    const parents = segments.slice(0, -1).map((_, at) => segments.slice(0, at + 1).join('/'))
    const throughOf = (parentsOfPath, what) => {
      for (const parent of parentsOfPath) {
        if (kinds.get(parent) === 'symlink') fail(`${what} passes through the symlink "${parent}"`)
        if (kinds.get(parent) === 'file') fail(`${what} passes through the file "${parent}"`)
      }
    }
    throughOf(parents, `member "${name}"`)
    if (path === '' && kind !== 'dir') fail(`member "${name}" is the destination itself but is not a directory`)
    if (listed.has(path)) fail(`member "${name}" repeats an earlier member`)
    if (kind !== 'dir' && kinds.get(path) === 'dir') fail(`member "${name}" replaces a directory an earlier member created`)
    if (kind === 'symlink') {
      if (link === '' || link.startsWith('/')) fail(`symlink "${name}" -> "${link}" points outside the destination`)
      const resolved = segments.slice(0, -1)
      for (const part of link.split('/')) {
        if (part === '' || part === '.') continue
        if (part !== '..') resolved.push(part)
        else if (resolved.pop() === undefined) fail(`symlink "${name}" -> "${link}" points outside the destination`)
      }
    } else if (kind === 'hard link') {
      if (escapeOf(link)) fail(`hard link "${name}" -> "${link}" points outside the destination`)
      const target = segmentsOf(link)
      throughOf(target.slice(0, -1).map((_, at) => target.slice(0, at + 1).join('/')), `hard link "${name}" -> "${link}"`)
      if (kinds.get(target.join('/')) !== 'file') fail(`hard link "${name}" -> "${link}" does not name an earlier regular file`)
    }
    listed.add(path)
    kinds.set(path, kind === 'hard link' ? 'file' : kind)
    for (const parent of parents) if (!kinds.has(parent)) kinds.set(parent, 'dir')
  }
  if ((await closed) !== 0) fail(`tar could not read ${archive}: ${said}`)
  if (said !== '') console.error(`site-bundle: tar said: ${printable(said)}`)
  return count
}

function verify(tree, bundle, expected) {
  const manifest = manifestOf(bundle)
  const found = inventory(tree)
  if (found.tree !== manifest.tree) {
    const recorded = new Map(readFileSync(join(bundle, FILES), 'utf8').split('\n').filter(Boolean)
      .map((line) => [line.split(' ').slice(3).join(' '), line]))
    const present = new Map(found.lines.map((line) => [line.split(' ').slice(3).join(' '), line]))
    const differing = [...new Set([...recorded.keys(), ...present.keys()])]
      .filter((path) => recorded.get(path) !== present.get(path)).slice(0, 10)
    fail(`the tree does not match the bundle's manifest; first differences: ${differing.join(', ')}`)
  }
  expectDigest(found.tree, expected, 'the tree')
  console.error(`site-bundle: ${found.lines.length} files verified against ${found.tree}`)
}

const [command, first, second, ...rest] = process.argv.slice(2)
const digestAt = rest.indexOf('--digest')
const expected = digestAt === -1 ? undefined : rest[digestAt + 1]

if (command === 'pack' && first && second) {
  requireZstd()
  mkdirSync(second, { recursive: true })
  const found = inventory(first)
  writeFileSync(join(second, FILES), `${found.lines.join('\n')}\n`)
  execFileSync('tar', ['--use-compress-program=zstd -T0 -3', '-cf', join(second, ARCHIVE), '-C', first, '.'], { stdio: 'inherit' })
  const tar = hashFile(join(second, ARCHIVE))
  const manifest = { schema: 1, files: found.lines.length, bytes: found.bytes, tree: found.tree, tar }
  writeFileSync(join(second, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`)
  console.error(`site-bundle: packed ${manifest.files} files, ${manifest.bytes} bytes, tree ${manifest.tree}`)
  console.log(`tree=${manifest.tree}\nfiles=${manifest.files}\nbytes=${manifest.bytes}`)
} else if (command === 'unpack' && first && second) {
  requireZstd()
  const manifest = manifestOf(first)
  expectDigest(manifest.tree, expected, 'the bundle manifest')
  if (!existsSync(join(first, ARCHIVE))) fail(`${join(first, ARCHIVE)} is missing`)
  const archive = hashFile(join(first, ARCHIVE))
  if (archive !== manifest.tar) fail(`${ARCHIVE} hashes to ${archive}, not the ${manifest.tar} its manifest records`)
  const scanned = await scan(join(first, ARCHIVE))
  console.error(`site-bundle: ${scanned} members stay inside the destination`)
  mkdirSync(second, { recursive: true })
  if (readdirSync(second).length > 0) fail(`${second} is not empty`)
  const extracted = spawnSync('tar', ['--extract', ...TAR_OPTIONS, '-f', join(first, ARCHIVE), '-C', second], { env: TAR_ENV, encoding: 'utf8' })
  if (extracted.status !== 0) fail(`tar could not extract the archive: ${extracted.stderr}`)
  verify(second, first, expected)
} else if (command === 'verify' && first && second) {
  verify(first, second, expected)
} else {
  console.error('usage: site-bundle.mjs pack <tree> <bundle> | unpack <bundle> <tree> [--digest D] | verify <tree> <bundle> [--digest D]')
  process.exit(2)
}
