#!/usr/bin/env node
/*
 * Proof that site-bundle refuses a tree that is not the one that was packed.
 *
 * The control packs a small tree, unpacks it elsewhere, and requires every
 * file to come back: a bundle that rejected everything would satisfy each
 * case below on its own. Each case then damages one thing a CI job could
 * receive, a flipped archive byte, a cut archive, another job's archive
 * under this job's manifest, a file removed or altered after extraction, and
 * a digest the producing job did not report.
 *
 * A hostile archive can also carry the legitimate tree digest and still write
 * outside the destination or through a link it creates, so the second group
 * of cases builds archives by hand, gives each the real manifest digest, and
 * requires unpack to refuse it before the destination exists. Names hidden in
 * GNU long-name, pax and ustar-prefix headers, and a pax `size=0` header that
 * makes a reader skip a different distance than tar does, are among them. The
 * controls are a GNU-format and a pax-format archive of the same tree, whose
 * long names and relative links are legitimate.
 *
 * The third group stands in a fake `tar` for the cases a real one cannot
 * produce: a listing the scan cannot read and a listing that ends in failure.
 * scripts/site-bundle.mutations.mjs then switches each refusal off in a copy
 * and requires this file to fail, so no rule is here by accident.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, truncateSync, unlinkSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = process.env.LIBTMUX_SITE_BUNDLE_SCRIPT ?? join(dirname(fileURLToPath(import.meta.url)), 'site-bundle.mjs')
const scratch = mkdtempSync(join(tmpdir(), 'libtmux-site-bundle-'))
const runWith = (env, ...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env })
const run = (...args) => runWith(process.env, ...args)

function fixture(name, page) {
  const tree = join(scratch, name)
  mkdirSync(join(tree, 'en', 'guides'), { recursive: true })
  writeFileSync(join(tree, 'en', 'index.html'), page)
  writeFileSync(join(tree, 'en', 'guides', 'a page with spaces.html'), '<p>guide</p>')
  writeFileSync(join(tree, 'empty.txt'), '')
  symlinkSync('en/index.html', join(tree, 'home'))
  // A name past the 100 bytes a tar header holds, and a link that climbs and
  // stays inside the tree: both are legitimate and must not trip the scan.
  const long = join(tree, 'en', 'd'.repeat(70), 'd'.repeat(70))
  mkdirSync(long, { recursive: true })
  writeFileSync(join(long, 'index.html'), '<p>long</p>')
  symlinkSync('../home', join(tree, 'en', 'up'))
  return tree
}

const pad = (bytes) => Buffer.concat([bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512)])
/** One tar header block, every field a hostile writer might set. */
function header({ name = '', type = '0', link = '', size = 0, prefix = '', magic = 'ustar\0', version = '00' }) {
  const block = Buffer.alloc(512)
  block.write(name, 0, 100, 'utf8')
  block.write('0000644\0', 100)
  block.write('0000000\0', 108)
  block.write('0000000\0', 116)
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124)
  block.write('00000000000\0', 136)
  block.fill(0x20, 148, 156)
  block.write(type, 156)
  block.write(link, 157, 100, 'utf8')
  block.write(magic, 257, 6, 'latin1')
  block.write(version, 263, 2, 'latin1')
  block.write(prefix, 345, 155, 'utf8')
  block.write(`${block.reduce((total, byte) => total + byte, 0).toString(8).padStart(6, '0')}\0 `, 148)
  return block
}
/** A member: a header block and its content, padded to whole blocks. */
function member({ content = '', ...fields }) {
  const body = Buffer.from(content)
  return Buffer.concat([header({ size: body.length, ...fields }), pad(body)])
}
/** A pax extended (`x`) or global (`g`) header holding these records. */
function pax(records, type = 'x') {
  const text = Object.entries(records).map(([key, value]) => {
    const body = ` ${key}=${value}\n`
    let length = Buffer.byteLength(body) + 1
    while (String(length).length + Buffer.byteLength(body) !== length) length = String(length).length + Buffer.byteLength(body)
    return `${length}${body}`
  }).join('')
  return member({ name: 'PaxHeader/x', type, content: text })
}
/** A GNU long name (`L`) or long link target (`K`) for the member that follows. */
const gnuLong = (text, type = 'L') => member({ name: '././@LongLink', type, content: `${text}\0`, magic: 'ustar ', version: ' \0' })

function pack(tree, name) {
  const bundle = join(scratch, name)
  const result = run('pack', tree, bundle)
  assert.equal(result.status, 0, `pack failed:\n${result.stderr}`)
  return { bundle, digest: /^tree=([0-9a-f]{64})$/m.exec(result.stdout)[1] }
}

try {
  const original = fixture('tree', '<p>built</p>')
  const { bundle, digest } = pack(original, 'bundle')

  const control = run('unpack', bundle, join(scratch, 'control'), '--digest', digest)
  assert.equal(control.status, 0, `the untouched bundle must unpack:\n${control.stderr}`)
  assert.equal(readFileSync(join(scratch, 'control', 'en', 'guides', 'a page with spaces.html'), 'utf8'), '<p>guide</p>')
  assert.equal(run('verify', join(scratch, 'control'), bundle, '--digest', digest).status, 0)
  console.log('ok   an untouched bundle unpacks to the packed tree')

  const cases = [
    {
      name: 'an archive with one flipped byte',
      trips: /site\.tar\.zst hashes to/,
      damage: (copy) => {
        const archive = join(copy, 'site.tar.zst')
        const bytes = readFileSync(archive)
        bytes[Math.floor(bytes.length / 2)] ^= 0xff
        writeFileSync(archive, bytes)
      },
    },
    {
      name: 'a truncated archive',
      trips: /site\.tar\.zst hashes to/,
      damage: (copy) => truncateSync(join(copy, 'site.tar.zst'), 20),
    },
    {
      name: 'another job\'s archive under this manifest',
      trips: /site\.tar\.zst hashes to/,
      damage: (copy) => {
        const other = pack(fixture('other', '<p>stale</p>'), 'other-bundle')
        copyFileSync(join(other.bundle, 'site.tar.zst'), join(copy, 'site.tar.zst'))
      },
    },
    {
      name: 'another job\'s whole bundle against the digest this job reported',
      trips: /the bundle manifest hashes to/,
      damage: (copy) => {
        const other = pack(fixture('swap', '<p>swapped</p>'), 'swap-bundle')
        for (const file of ['site.tar.zst', 'files.sha256', 'manifest.json']) copyFileSync(join(other.bundle, file), join(copy, file))
      },
    },
    {
      name: 'a manifest that is not JSON',
      trips: /is missing or is not JSON/,
      damage: (copy) => writeFileSync(join(copy, 'manifest.json'), 'tree=oops'),
    },
  ]
  for (const [index, { name, trips, damage }] of cases.entries()) {
    const copy = join(scratch, `damaged-${index}`)
    mkdirSync(copy)
    for (const file of ['site.tar.zst', 'files.sha256', 'manifest.json']) copyFileSync(join(bundle, file), join(copy, file))
    damage(copy)
    const result = run('unpack', copy, join(scratch, `out-${index}`), '--digest', digest)
    assert.equal(result.status, 1, `${name}: expected a failure, got ${result.status}\n${result.stdout}`)
    assert.match(result.stderr, trips, `${name}: wrong reason\n${result.stderr}`)
    console.log(`ok   unpack fails on ${name}`)
  }

  const wrong = run('unpack', bundle, join(scratch, 'wrong-digest'), '--digest', 'f'.repeat(64))
  assert.equal(wrong.status, 1, 'a digest the producer did not report must fail')
  assert.match(wrong.stderr, /not the f{64} the producing job reported/)
  console.log('ok   unpack fails on a digest the producing job did not report')

  const occupied = join(scratch, 'occupied')
  mkdirSync(occupied)
  writeFileSync(join(occupied, 'leftover.html'), 'x')
  const mixed = run('unpack', bundle, occupied, '--digest', digest)
  assert.equal(mixed.status, 1, 'a non-empty destination must fail')
  assert.match(mixed.stderr, /is not empty/)
  console.log('ok   unpack fails into a directory that already holds files')

  const afterwards = [
    ['a file removed after extraction', (tree) => unlinkSync(join(tree, 'en', 'guides', 'a page with spaces.html'))],
    ['a file edited after extraction', (tree) => appendFileSync(join(tree, 'en', 'index.html'), ' ')],
    ['a file added after extraction', (tree) => writeFileSync(join(tree, 'en', 'extra.html'), 'x')],
    ['a symlink retargeted after extraction', (tree) => { unlinkSync(join(tree, 'home')); symlinkSync('empty.txt', join(tree, 'home')) }],
  ]
  for (const [index, [name, damage]] of afterwards.entries()) {
    const tree = join(scratch, `after-${index}`)
    assert.equal(run('unpack', bundle, tree, '--digest', digest).status, 0)
    damage(tree)
    const result = run('verify', tree, bundle, '--digest', digest)
    assert.equal(result.status, 1, `${name}: expected a failure, got ${result.status}`)
    assert.match(result.stderr, /does not match the bundle's manifest; first differences: /, `${name}: wrong reason\n${result.stderr}`)
    console.log(`ok   verify fails on ${name}`)
  }

  /** Unpack these archive bytes under the real bundle's manifest and digest. */
  const bytesIn = (name, bytes, env = process.env) => {
    const work = join(scratch, `hostile-${name.replaceAll(/\W+/g, '-')}`)
    mkdirSync(join(work, 'bundle'), { recursive: true })
    writeFileSync(join(work, 'bundle', 'site.tar.zst'), bytes)
    copyFileSync(join(bundle, 'files.sha256'), join(work, 'bundle', 'files.sha256'))
    const manifest = JSON.parse(readFileSync(join(bundle, 'manifest.json'), 'utf8'))
    manifest.tar = createHash('sha256').update(bytes).digest('hex')
    writeFileSync(join(work, 'bundle', 'manifest.json'), JSON.stringify(manifest))
    const dest = join(work, 'dest')
    return { ...runWith(env, 'unpack', join(work, 'bundle'), dest, '--digest', digest), work, dest }
  }
  const compressed = (members) => {
    const packed = spawnSync('zstd', ['-q', '-c'], { input: Buffer.concat([...members, Buffer.alloc(1024)]) })
    assert.equal(packed.status, 0, 'zstd could not compress the hand-made archive')
    return packed.stdout
  }
  const hostile = (name, members) => bytesIn(name, compressed(members))
  const legit = member({ name: 'en/index.html', content: '<p>built</p>' })
  const outside = join(scratch, 'outside')
  mkdirSync(outside)
  const long = 'a'.repeat(120)
  const hidden = Buffer.concat([member({ name: 'lnk', type: '2', link: '../outside' }), member({ name: 'lnk/pwn.txt', content: 'x' })])
  const dir = (name) => member({ name, type: '5' })
  const tail = member({ name: 'short', content: 'x' })

  const archives = [
    { name: 'a member with a .. segment', members: [legit, member({ name: '../escaped.txt', content: 'x' })], trips: /member "\.\.\/escaped\.txt" has a "\.\." path segment/ },
    { name: 'a member that climbs out from inside the tree', members: [legit, member({ name: 'en/../../escaped.txt', content: 'x' })], trips: /member "en\/\.\.\/\.\.\/escaped\.txt" has a "\.\." path segment/ },
    { name: 'an absolute member', members: [legit, member({ name: join(outside, 'escaped.txt'), content: 'x' })], trips: /member ".*escaped\.txt" is an absolute path/ },
    { name: 'an absolute directory', members: [legit, dir('/')], trips: /member "\/" is an absolute path/ },
    { name: 'an absolute symlink', members: [legit, member({ name: 'lnk', type: '2', link: outside })], trips: /symlink "lnk" -> ".*outside" points outside the destination/ },
    { name: 'a symlink that climbs out', members: [legit, member({ name: 'lnk', type: '2', link: '../../outside' })], trips: /symlink "lnk" -> "\.\.\/\.\.\/outside" points outside the destination/ },
    { name: 'a symlink that climbs out from a subdirectory', members: [legit, member({ name: 'en/lnk', type: '2', link: '../../outside' })], trips: /symlink "en\/lnk" -> "\.\.\/\.\.\/outside" points outside the destination/ },
    { name: 'a hard link to a file that was never extracted', members: [legit, member({ name: 'hard', type: '1', link: '/etc/passwd' })], trips: /hard link "hard" -> "etc\/passwd" does not name an earlier regular file/ },
    { name: 'a hard link that climbs out, which tar re-roots before listing and extracting', members: [legit, member({ name: 'hard', type: '1', link: '../outside' })], trips: /hard link "hard" -> "outside" does not name an earlier regular file/ },
    { name: 'a hard link to a file that comes later', members: [member({ name: 'hard', type: '1', link: 'en/index.html' }), legit], trips: /hard link "hard" -> "en\/index\.html" does not name an earlier regular file/ },
    { name: 'a hard link to a directory', members: [dir('en/'), legit, member({ name: 'hard', type: '1', link: 'en' })], trips: /hard link "hard" -> "en" does not name an earlier regular file/ },
    { name: 'a hard link that aliases a symlink, then a write through the alias', members: [legit, member({ name: 'en/s', type: '2', link: '..' }), member({ name: 'h', type: '1', link: 'en/s' }), member({ name: 'h/escaped.txt', content: 'x' })], trips: /hard link "h" -> "en\/s" does not name an earlier regular file/ },
    { name: 'a hard link through a symlink', members: [legit, member({ name: 'lnk', type: '2', link: 'en' }), member({ name: 'hard', type: '1', link: 'lnk/index.html' })], trips: /hard link "hard" -> "lnk\/index\.html" passes through the symlink "lnk"/ },
    { name: 'a member written through a symlink that stays inside', members: [legit, member({ name: 'lnk', type: '2', link: 'en' }), member({ name: 'lnk/escaped.txt', content: 'x' })], trips: /member "lnk\/escaped\.txt" passes through the symlink "lnk"/ },
    { name: 'a member written through a symlink in a subdirectory', members: [dir('en/'), member({ name: 'en/up', type: '2', link: '..' }), member({ name: 'en/up/pwn.txt', content: 'x' })], trips: /member "en\/up\/pwn\.txt" passes through the symlink "en\/up"/ },
    { name: 'a member written through a file', members: [legit, member({ name: 'en/index.html/escaped.txt', content: 'x' })], trips: /member "en\/index\.html\/escaped\.txt" passes through the file "en\/index\.html"/ },
    { name: 'a repeated name that swaps a file for a symlink', members: [legit, member({ name: 'en/dup', content: 'x' }), member({ name: 'en/dup', type: '2', link: '..' }), member({ name: 'en/dup/pwn.txt', content: 'x' })], trips: /member "en\/dup" repeats an earlier member/ },
    { name: 'a repeated directory', members: [dir('en/'), dir('en/'), legit], trips: /member "en\/" repeats an earlier member/ },
    { name: 'a symlink over a directory an earlier member created', members: [legit, member({ name: 'en', type: '2', link: '.' })], trips: /member "en" replaces a directory an earlier member created/ },
    { name: 'a symlink that is the destination itself', members: [member({ name: './', type: '2', link: 'en' })], trips: /member ".\/" is the destination itself but is not a directory/ },
    { name: 'a device node', members: [legit, member({ name: 'dev', type: '3' })], trips: /member "dev" has the unsupported member type "c"/ },
    { name: 'a fifo', members: [legit, member({ name: 'fifo', type: '6' })], trips: /member "fifo" has the unsupported member type "p"/ },
    { name: 'a contiguous file', members: [legit, member({ name: 'contiguous', type: '7', content: 'x' })], trips: /member "contiguous" has the unsupported member type "C"/ },
    { name: 'a .. segment hidden in a GNU long name', members: [legit, gnuLong('../escaped-long.txt'), tail], trips: /member "\.\.\/escaped-long\.txt" has a "\.\." path segment/ },
    { name: 'a .. segment past the first 100 bytes of a GNU long name', members: [legit, gnuLong(`${long}/../../../escaped.txt`), tail], trips: /has a "\.\." path segment/ },
    { name: 'a symlink target in a GNU long link that climbs out', members: [legit, gnuLong(`../../${long}`, 'K'), member({ name: 'lnk', type: '2', link: 'short' })], trips: /symlink "lnk" -> "\.\.\/\.\.\/a+" points outside the destination/ },
    { name: 'a .. segment hidden in a pax path', members: [legit, pax({ path: '../escaped-pax.txt' }), tail], trips: /member "\.\.\/escaped-pax\.txt" has a "\.\." path segment/ },
    { name: 'an absolute pax path', members: [legit, pax({ path: join(outside, 'escaped-pax.txt') }), tail], trips: /escaped-pax\.txt" is an absolute path/ },
    { name: 'a symlink target in a pax linkpath that climbs out', members: [legit, pax({ linkpath: '../../outside' }), member({ name: 'lnk', type: '2', link: 'short' })], trips: /symlink "lnk" -> "\.\.\/\.\.\/outside" points outside the destination/ },
    { name: 'a pax path through a symlink', members: [legit, member({ name: 'lnk', type: '2', link: 'en' }), pax({ path: 'lnk/pwn.txt' }), tail], trips: /member "lnk\/pwn\.txt" passes through the symlink "lnk"/ },
    { name: 'a newline hiding a .. segment in a pax path', members: [legit, pax({ path: 'ok\n/../../escaped-nl.txt' }), tail], trips: /has a "\.\." path segment/ },
    { name: 'a .. segment in the ustar prefix', members: [legit, member({ name: 'escaped-prefix.txt', prefix: '..', content: 'x' })], trips: /member "\.\.\/escaped-prefix\.txt" has a "\.\." path segment/ },
    { name: 'a ustar prefix that leads through a symlink', members: [legit, member({ name: 'lnk', type: '2', link: 'en' }), member({ name: 'pwn.txt', prefix: 'lnk', content: 'x' })], trips: /member "lnk\/pwn\.txt" passes through the symlink "lnk"/ },
    { name: 'a pax size=0 header that hides a symlink and a write inside a file', members: [legit, pax({ size: '0' }), member({ name: 'holder', content: hidden })], trips: /symlink "lnk" -> "\.\.\/outside" points outside the destination/ },
    { name: 'a global pax size=0 header that hides a symlink and a write inside a file', members: [legit, pax({ size: '0' }, 'g'), member({ name: 'holder', content: hidden })], trips: /symlink "lnk" -> "\.\.\/outside" points outside the destination/ },
  ]
  for (const { name, members, trips } of archives) {
    const result = hostile(name, members)
    assert.equal(result.status, 1, `${name}: expected a failure, got ${result.status}\n${result.stdout}`)
    assert.match(result.stderr, trips, `${name}: wrong reason\n${result.stderr}`)
    assert.doesNotMatch(result.stderr, /at .*\.mjs:\d+/, `${name}: failed with a stack trace\n${result.stderr}`)
    assert.equal(existsSync(result.dest), false, `${name}: the destination was created before the scan refused the archive`)
    assert.equal(readdirSync(outside).length, 0, `${name}: something was written outside the destination`)
    console.log(`ok   unpack refuses ${name}, carrying the real tree digest`)
  }

  // The same hand-made layout without the hostile member unpacks, so each case
  // above is refused for its member and not for the archive around it.
  const plain = hostile('only the legitimate member', [legit])
  assert.equal(plain.status, 1, 'the digest check must still refuse an archive missing the rest of the tree')
  assert.match(plain.stderr, /does not match the bundle's manifest/)
  console.log('ok   a hand-made archive without a hostile member passes the scan and meets the digest check')

  // What the scan accepts: names a tar header cannot hold, and a link that climbs and stays inside.
  const accepted = hostile('legitimate long names and links', [legit, gnuLong(`${long}/b.html`), tail, gnuLong(`${long}/target`, 'K'), member({ name: 'en/up', type: '2', link: '../en/index.html' }), pax({ path: `${long}/c.html` }), tail])
  assert.match(accepted.stderr, /does not match the bundle's manifest/, `long names and an inside link must pass the scan:\n${accepted.stderr}`)
  console.log('ok   long names and a symlink that climbs and stays inside pass the scan')

  // A name can carry a newline and then a workflow command; the log must not
  // gain a line that starts with one, from the refusal or from tar's own notes.
  const injected = hostile('a newline and a workflow command in a pax path', [legit, pax({ path: 'ok\n::error::injected\n/../x' }), tail])
  assert.equal(injected.status, 1)
  assert.match(injected.stderr, /has a "\.\." path segment/)
  assert.deepEqual(injected.stderr.split('\n').filter((line) => line.startsWith('::')), [], `a name put a command in the log:\n${injected.stderr}`)
  // tar's own warning about a re-rooted hard link target quotes the target, so
  // this archive passes the scan and still puts its newline in tar's output.
  const warned = hostile('a newline and a workflow command in a hard link target', [legit, member({ name: 'h', type: '1', link: 'ok\n::error::injected\n/../en/index.html' })])
  assert.match(warned.stderr, /tar said: .*Removing leading/, `the scan should have passed with a warning from tar:\n${warned.stderr}`)
  assert.deepEqual(warned.stderr.split('\n').filter((line) => line.startsWith('::')), [], `tar's warning put a command in the log:\n${warned.stderr}`)
  console.log('ok   a newline in a name cannot start a line of the log')

  // Bytes tar itself skips are not members, to the scan or to the extraction:
  // the header inside this file-named-as-a-directory is never read by either.
  const inert = hostile('a header inside a trailing-slash file', [legit, member({ name: 'd/', content: member({ name: '../escaped-slash.txt', content: 'x' }) })])
  assert.match(inert.stderr, /does not match the bundle's manifest/, `tar and the scan must agree the inner header is data:\n${inert.stderr}`)
  assert.equal(existsSync(join(inert.work, 'escaped-slash.txt')), false)
  assert.equal(existsSync(join(inert.dest, '..', 'escaped-slash.txt')), false)
  console.log('ok   a header that tar treats as file data is not read as a member, and nothing is written for it')

  // Failures that are not a hostile member.
  const cut = compressed([legit, member({ name: 'big.html', content: 'x'.repeat(40_000) })])
  const truncated = bytesIn('a zstd stream cut short, with a matching manifest', cut.subarray(0, cut.length - 30))
  assert.equal(truncated.status, 1)
  assert.match(truncated.stderr, /tar could not read .*site\.tar\.zst/)
  assert.equal(existsSync(truncated.dest), false)
  console.log('ok   unpack refuses a zstd stream cut short even when the manifest records its hash')

  const missing = join(scratch, 'missing-archive')
  mkdirSync(missing)
  for (const file of ['files.sha256', 'manifest.json']) copyFileSync(join(bundle, file), join(missing, file))
  const absent = run('unpack', missing, join(scratch, 'missing-out'), '--digest', digest)
  assert.equal(absent.status, 1)
  assert.match(absent.stderr, /site\.tar\.zst is missing/)
  assert.doesNotMatch(absent.stderr, /at .*\.mjs:\d+/)
  console.log('ok   unpack names a missing archive instead of throwing')

  const unextractable = hostile('a name tar cannot create', [legit, gnuLong('x'.repeat(300)), tail])
  assert.equal(unextractable.status, 1)
  assert.match(unextractable.stderr, /tar could not extract the archive/)
  assert.doesNotMatch(unextractable.stderr, /at .*\.mjs:\d+/)
  console.log('ok   unpack names a tar that fails while extracting instead of throwing')

  // A stand-in tar for the listings a real one cannot be made to print.
  const fake = join(scratch, 'fake-tar')
  mkdirSync(fake)
  writeFileSync(join(fake, 'tar'), '#!/usr/bin/env bash\nprintf "%s\\n" "$FAKE_LISTING"\nexit "${FAKE_STATUS:-0}"\n', { mode: 0o755 })
  const listed = (name, listing, status = 0) => {
    const dest = join(scratch, `fake-${name.replaceAll(/\W+/g, '-')}`)
    return { ...runWith({ ...process.env, PATH: `${fake}:${process.env.PATH}`, FAKE_LISTING: listing, FAKE_STATUS: String(status) }, 'unpack', bundle, dest, '--digest', digest), dest }
  }
  const row = (name, flags = '-rw-r--r--') => `${flags} 0/0 1 2026-01-01 00:00:00 ${name}`
  const unreadable = [
    ['a listing line in no known shape', 'not a listing', /tar listed a member this check cannot read: not a listing/],
    ['a name quoted with an escape the scan does not know', row('"a\\qb"'), /tar quoted "a\\qb" with an escape this check cannot read/],
    ['a clean listing that ends in a tar failure', row('"en/index.html"'), /tar could not read .*site\.tar\.zst/, 2],
    ['a hard link to an absolute path, from a tar that does not re-root it', `${row('"en/index.html"')}\n${row('"hard" link to "/etc/passwd"', 'hrw-r--r--')}`, /hard link "hard" -> "\/etc\/passwd" points outside the destination/],
    ['a hard link that climbs out, from a tar that does not re-root it', `${row('"en/index.html"')}\n${row('"hard" link to "../outside"', 'hrw-r--r--')}`, /hard link "hard" -> "\.\.\/outside" points outside the destination/],
  ]
  for (const [name, listing, trips, status] of unreadable) {
    const result = listed(name, listing, status)
    assert.equal(result.status, 1, `${name}: expected a failure, got ${result.status}`)
    assert.match(result.stderr, trips, `${name}: wrong reason\n${result.stderr}`)
    assert.equal(existsSync(result.dest), false, `${name}: the destination was created`)
    console.log(`ok   unpack refuses ${name}`)
  }
  // tar pads a time with a short fraction, and a size column of any width, with
  // extra spaces; a real tar printed both while the archives were being made.
  const shapes = [
    ['a clean listing', row('"en/index.html"')],
    ['a time with a short fraction, padded to nine digits', '-rw-r--r-- 1000/1000 12 2026-10-20 23:09:55.66755254  "en/index.html"'],
    ['a time with a full fraction', '-rw-r--r-- 1000/1000 12 2026-10-20 23:09:55.667552541 "en/index.html"'],
    ['a wide size column', '-rw-r--r-- 1000/1000     123456789012 2026-10-20 23:09:55 "en/index.html"'],
    ['a device size column', 'crw-r--r-- 0/0 0,0 2026-10-20 23:09:55 "dev"'],
  ]
  for (const [name, listing] of shapes.slice(0, -1)) {
    const clean = listed(name, listing)
    assert.equal(existsSync(clean.dest), true, `${name} must get past the scan to extraction:\n${clean.stderr}`)
  }
  console.log('ok   listings in each width tar prints, ending in success, get past the scan')
  const device = listed(shapes.at(-1)[0], shapes.at(-1)[1])
  assert.match(device.stderr, /unsupported member type "c"/)
  console.log('ok   a device row is read as a device, not as an unreadable line')

  const paxBundle = join(scratch, 'pax')
  mkdirSync(paxBundle)
  execFileSync('tar', ['--format=pax', '--use-compress-program=zstd -3', '-cf', join(paxBundle, 'site.tar.zst'), '-C', original, '.'])
  copyFileSync(join(bundle, 'files.sha256'), join(paxBundle, 'files.sha256'))
  const paxManifest = JSON.parse(readFileSync(join(bundle, 'manifest.json'), 'utf8'))
  paxManifest.tar = createHash('sha256').update(readFileSync(join(paxBundle, 'site.tar.zst'))).digest('hex')
  writeFileSync(join(paxBundle, 'manifest.json'), JSON.stringify(paxManifest))
  const paxRun = run('unpack', paxBundle, join(scratch, 'pax-out'), '--digest', digest)
  assert.equal(paxRun.status, 0, `a pax-format archive of the same tree must unpack:\n${paxRun.stderr}`)
  console.log('ok   a pax-format archive of the same tree, with long names and a relative link, unpacks')
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
