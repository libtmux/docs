#!/usr/bin/env node
/**
 * What each Perl distribution's latest CPAN release documents, for the links
 * from a reference page to its POD on MetaCPAN.
 *
 * A reference page for `LibTmux::Server->new` may link to the method's POD
 * section only if that section exists in a release. MetaCPAN's pages cannot be
 * requested by a script, so this reads its API instead (see `lib/perl-pod.mjs`)
 * and records, per distribution, the release, the document that each provided
 * package belongs to, and for each document its file's SHA-256 and the
 * fragments of its rendered POD. `site/src/data/perl-pod.json` is the result.
 * A page's link is built from it offline, and shown only for source whose
 * SHA-256 matches the release's, or labelled with the release where it does
 * not.
 *
 * The distributions are the Perl port's packages in `site/src/lib/ports.ts`,
 * so a package added there is recorded, or reported as missing, without
 * another list to edit. Nothing in the file depends on when it was written, so
 * `--check` fails only when MetaCPAN's latest release changed.
 *
 * Usage:
 *   node scripts/gen-perl-pod.mjs [--out <path>] [--check] [--offline]
 *
 *   --out <path>  Write there (default: site/src/data/perl-pod.json).
 *   --check       Write nothing; exit 1 if the file differs from what MetaCPAN reports now.
 *   --offline     With --check, request nothing: read the file and report what is wrong with it.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORTS } from '../site/src/lib/ports.ts'
import { SCHEMA, observeDistribution, problemsWith } from './lib/perl-pod.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_OUT = join(root, 'site', 'src', 'data', 'perl-pod.json')
const USER_AGENT = 'libtmux-docs gen-perl-pod.mjs'

function parseArgs(argv) {
  const opts = { out: DEFAULT_OUT, check: false, offline: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--out') opts.out = argv[++i]
    else if (arg === '--check') opts.check = true
    else if (arg === '--offline') opts.offline = true
    else if (arg === '-h' || arg === '--help') opts.help = true
    else throw new Error(`unrecognised argument: ${arg}`)
  }
  return opts
}

const opts = parseArgs(process.argv.slice(2))
if (opts.help) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0])
  process.exit(0)
}
if (opts.offline && !opts.check) throw new Error('--offline only applies to --check')

const dists = PORTS.find((port) => port.slug === 'perl').packages.map((entry) => entry.name)
const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '')

if (opts.check && opts.offline) {
  const text = read(opts.out)
  const data = text ? JSON.parse(text) : undefined
  const problems = data ? problemsWith(data, dists) : [`${opts.out} does not exist`]
  if (data && `${JSON.stringify(data, null, 2)}\n` !== text) problems.push('the file is not what the generator writes byte for byte')
  for (const problem of problems) console.error(`  ${problem}`)
  if (problems.length > 0) {
    console.error(`${problems.length} problem${problems.length === 1 ? '' : 's'} in ${opts.out}. Run: node scripts/gen-perl-pod.mjs`)
    process.exit(1)
  }
  console.log(`${opts.out} is well formed`)
  process.exit(0)
}

let last = 0
/** One GET with a pause between requests, so a run is polite to the API; a 5xx or a dropped request is tried again. */
async function get(url) {
  for (let attempt = 0; ; attempt += 1) {
    const wait = last + 150 - Date.now()
    if (wait > 0) await new Promise((resolveWait) => setTimeout(resolveWait, wait))
    last = Date.now()
    try {
      const response = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) })
      const bytes = Buffer.from(await response.arrayBuffer())
      if (response.status >= 500 && attempt < 3) throw new Error(`HTTP ${response.status}`)
      return { status: response.status, bytes, text: bytes.toString('utf8') }
    } catch (error) {
      if (attempt >= 3) throw error
      await new Promise((resolveWait) => setTimeout(resolveWait, 1000 * (attempt + 1)))
    }
  }
}

const distributions = {}
for (const dist of dists) distributions[dist] = await observeDistribution(get, dist)
const payload = { schema: SCHEMA, distributions }
const problems = problemsWith(payload, dists)
if (problems.length > 0) {
  for (const problem of problems) console.error(`  ${problem}`)
  throw new Error('MetaCPAN reported a release this file cannot hold')
}
const text = `${JSON.stringify(payload, null, 2)}\n`

if (opts.check) {
  if (read(opts.out) !== text) {
    console.error(`${opts.out} is out of date. Run: node scripts/gen-perl-pod.mjs`)
    for (const [dist, release] of Object.entries(distributions)) {
      const before = JSON.parse(read(opts.out) || '{"distributions":{}}').distributions[dist]
      if (JSON.stringify(before) !== JSON.stringify(release)) console.error(`  ${dist}: ${before?.release ?? 'none'} -> ${release.release}`)
    }
    process.exit(1)
  }
  console.log(`${opts.out} is current`)
} else {
  writeFileSync(opts.out, text)
  console.log(`wrote ${opts.out}`)
  for (const [dist, release] of Object.entries(distributions)) {
    console.log(`  ${dist.padEnd(18)} ${release.release} ${Object.keys(release.documents).length} documents, ${Object.keys(release.packages).length} packages`)
  }
}
