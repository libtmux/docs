#!/usr/bin/env node
/*
 * Proof that check-type-links fails on the situations it exists for.
 *
 * The mangled-USR fixture reproduces the real markup, which nests one span per
 * fragment. That detail is the test: a first attempt at this detector matched
 * non-greedily to the first `</span>` and so read `s:s8CopyableP` as `s`,
 * reporting zero on a build carrying 527 of them. A fixture that wrote the USR
 * as flat text would have passed that broken detector.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-type-links.mjs')
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const { API_MODEL_PORTS: PORT_DEFS } = await import(`file://${join(repoRoot, 'site/src/lib/ports.ts')}`)
const PORTS = PORT_DEFS.map((p) => p.slug)

const linked = (n) => `<span class="api-type"><a href="/x/" class="api-type-link">${n}</a></span>`
const plain = (n) => `<span class="api-type"><span class="api-punct">${n}</span></span>`
/** As `ApiType` renders an unresolved USR: one span per fragment, nested. */
const usr = () =>
  '<span class="api-type"><span class="api-punct">s</span>' +
  '<span class="api-punct">:</span><span class="api-punct">s8CopyableP</span></span>'

/** A site where every port has `n` plain names, plus optional extras. */
function site({ n = 0, mangled = false, markup = '' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'check-type-links-'))
  for (const p of PORTS) {
    const d = join(dir, p, 'latest', 'reference', 'thing')
    mkdirSync(d, { recursive: true })
    const body =
      linked('Server') +
      Array.from({ length: n }, (_, i) => plain(`Plain${i}`)).join('') +
      (mangled ? usr() : '') + markup
    writeFileSync(join(d, 'index.html'), `<html><body>${body}</body></html>`)
  }
  return dir
}

function run(dir, ceilings, extra = [], omit = []) {
  const f = join(dir, 'ceiling.json')
  const recordedPorts = PORTS.filter((p) => !omit.includes(p))
  writeFileSync(f, `${JSON.stringify(Object.fromEntries(recordedPorts.map((p) => [p, ceilings])), null, 2)}\n`)
  let code = 0
  let out = ''
  try {
    out = execFileSync('node', [script, dir, '--ceiling', f, ...extra], { encoding: 'utf8', stdio: 'pipe' })
  } catch (err) {
    code = err.status
    out = `${err.stdout ?? ''}${err.stderr ?? ''}`
  }
  return { code, out, recorded: JSON.parse(readFileSync(f, 'utf8')).go }
}

let failures = 0
const check = (name, ok, detail) => {
  if (ok) console.log(`ok   ${name}`)
  else {
    console.error(`FAIL ${name} — ${detail}`)
    failures++
  }
}

{
  // A mangled id is never acceptable, ceiling or no ceiling.
  const dir = site({ n: 0, mangled: true })
  const { code, out } = run(dir, 99)
  check(
    'a mangled id fails on sight',
    code !== 0 && out.includes('s:s8CopyableP'),
    `exited ${code} without naming the id:\n${out}`,
  )
  rmSync(dir, { recursive: true, force: true })
}

{
  // The control. Without it, a script that always failed would pass every
  // case above.
  const dir = site({ n: 5 })
  const { code, out } = run(dir, 5)
  check('a site at its ceiling passes', code === 0 && !out.includes('below the ceiling'), `exited ${code}:\n${out}`)
  rmSync(dir, { recursive: true, force: true })
}

{
  // A ceiling left above the count passes, and says which record can come down.
  const dir = site({ n: 3 })
  const { code, out } = run(dir, 5)
  check(
    'a site under its ceiling passes and names the headroom',
    code === 0 && out.includes('below the ceiling') && /\bgo\s+5 -> 3\b/.test(out),
    `exited ${code}:\n${out}`,
  )
  rmSync(dir, { recursive: true, force: true })
}

{
  const dir = site({ n: 9 })
  const { code, out } = run(dir, 5)
  check(
    'more plain names than the ceiling fails',
    code !== 0 && out.includes('ceiling allows'),
    `exited ${code}:\n${out}`,
  )
  rmSync(dir, { recursive: true, force: true })
}

{
  // The --update path, where a missing entry used to default to infinity and
  // so could never be judged a rise. Recording a first baseline and a renamed
  // slug arriving with no history look identical here, and only one of them
  // is intended.
  const dir = site({ n: 9 })
  const { code, out, recorded } = run(dir, 5, ['--update'], ['go'])
  check(
    'rebaselining an unrecorded port needs --force',
    code !== 0 && out.includes('refusing to raise') && out.includes('go') && recorded === undefined,
    `exited ${code}, go now ${recorded}:\n${out}`,
  )
  rmSync(dir, { recursive: true, force: true })
}

{
  const dir = site({ n: 9 })
  const { code, recorded } = run(dir, 5, ['--update', '--force'], ['go'])
  check('--force records the new port', code === 0 && recorded === 9, `exited ${code}, go now ${recorded}`)
  rmSync(dir, { recursive: true, force: true })
}

{
  /*
   * A port the record does not mention. Defaulting it happens to fail closed
   * in this direction, but it reports an unrecorded port as a resolution
   * regression, sending the reader after a defect that is not there.
   */
  const dir = site({ n: 5 })
  const { code, out } = run(dir, 5, [], ['go'])
  check(
    'an unrecorded port is named as such',
    code !== 0 && out.includes('no ceiling recorded for go'),
    `exited ${code}:\n${out}`,
  )
  rmSync(dir, { recursive: true, force: true })
}

{
  // The ratchet guard: refusing must leave the record untouched, which an
  // exit code alone cannot show.
  const dir = site({ n: 9 })
  const { code, out, recorded } = run(dir, 5, ['--update'])
  check(
    'raising the ceiling is refused',
    code !== 0 && out.includes('refusing to raise') && recorded === 5,
    `exited ${code}, ceiling now ${recorded}:\n${out}`,
  )
  rmSync(dir, { recursive: true, force: true })
}

{
  const dir = site({ n: 9 })
  const { code, recorded } = run(dir, 5, ['--update', '--force'])
  check(
    '--force writes the true count',
    code === 0 && recorded === 9,
    `exited ${code}, ceiling now ${recorded} (wanted 9)`,
  )
  rmSync(dir, { recursive: true, force: true })
}

{
  const dir = site({ n: 2 })
  const { code, recorded } = run(dir, 5, ['--update'])
  check('lowering the ceiling is allowed', code === 0 && recorded === 2, `exited ${code}, ceiling now ${recorded}`)
  rmSync(dir, { recursive: true, force: true })
}

for (const markup of [
  '<span class="api-punct" data-api-role="syntax">receiver</span>',
  "<span data-extra='x > y' data-api-role='syntax' class='api-punct'>T</span>",
  '<span data-api-role=syntax class=api-punct>label</span>',
]) {
  const dir = site({ markup })
  const { code, out } = run(dir, 0)
  check('grammar-owned syntax is outside the type count', code === 0, `exited ${code}:\n${out}`)
  rmSync(dir, { recursive: true, force: true })
}

for (const markup of [
  '<span class="api-punct" data-extra="x > y">Unknown</span>',
  "<span data-api-role='type' class='api-punct'>Unknown</span>",
  '<span data-api-role=unrecognized class=api-punct>Unknown</span>',
  `<span class=api-punct data-extra='data-api-role="syntax"'>Unknown</span>`,
  '<span data-api-role="syntax" class="api-type"><span class="api-punct">Unknown</span></span>',
  '<span class="api-punct" data-api-role="syntax"><span class="api-punct">Unknown</span></span>',
]) {
  const dir = site({ markup })
  const { code, out } = run(dir, 0)
  check('unknown types remain counted through attributes and parents', code !== 0 && out.includes('Unknown(1)'), `exited ${code}:\n${out}`)
  rmSync(dir, { recursive: true, force: true })
}

{
  // The existing ceiling covers single-class spans, not chips. Expanding that
  // metric needs a separately reviewed source-backed inventory.
  const dir = site({ markup: '<span class="api-punct api-literal">ChipGap</span>' + plain('Unknown') })
  const { code, out } = run(dir, 1, ['--list'])
  check('the recorded single-class metric does not expand to chips', code === 0 && out.includes('Unknown(1)') && !out.includes('ChipGap'), out)
  rmSync(dir, { recursive: true, force: true })
}

{
  /*
   * A repeat is a type drawn in full elsewhere, such as a table row that summarizes an entry on a product page or
   * a variant's own page for an enum page. The gate skips a span with a second class, so the name is counted where
   * its declaration is drawn and the repeat adds none. It pairs nothing: a repeat with no original is not counted
   * either, and site/test/field-table-pages.test.ts (product pages) and site/test/enum-variants.test.ts (enum pages)
   * fail a page whose original is missing. These cases hold the boundary, so a change to either side is noticed.
   */
  const original = plain('Unknown')
  const repeat = '<span class="api-type"><span class="api-punct api-type-repeat">Unknown</span></span>'
  const listing = (markup) => {
    const dir = site({ markup })
    const { code, out } = run(dir, 99, ['--list'])
    rmSync(dir, { recursive: true, force: true })
    return { code, out }
  }
  const both = listing(original + repeat)
  check('a name and its repeat are counted once', both.code === 0 && both.out.includes('Unknown(1)'), both.out)
  const twice = listing(original + original)
  check('the same name drawn twice without the flag is counted twice (control)', twice.code === 0 && twice.out.includes('Unknown(2)'), twice.out)
  const orphan = listing(repeat)
  check('a repeat with no original adds no name: the page tests own that pairing', orphan.code === 0 && !orphan.out.includes('Unknown'), orphan.out)
  const dir = site({ markup: '<span class="api-type"><span class="api-punct api-type-repeat">s</span>:<span class="api-punct api-type-repeat">s8CopyableP</span></span>' })
  const { code, out } = run(dir, 99)
  check('a repeat cannot hide a mangled id', code !== 0 && out.includes('s:s8CopyableP'), `exited ${code}:\n${out}`)
  rmSync(dir, { recursive: true, force: true })
}

for (const markup of [
  '<span data-api-role="syntax" class="api-type"><span class="api-punct" data-api-role="syntax">s</span>:<span class="api-punct" data-api-role="syntax">s8CopyableP</span></span>',
  "<span data-extra='x > y' class='api-type'><span class='api-punct'>s</span>:<span class='api-punct'>s8CopyableP</span></span>",
  '<span class="api-type extra" data-api-role="syntax"><span class="api-punct api-literal">s</span>:<span class="api-punct api-literal">s8CopyableP</span></span>',
  `<span class="api-type"><span class="api-punct" data-extra='x > y'>s</span>:<span class="api-punct">s8CopyableP</span></span>`,
]) {
  const dir = site({ markup })
  const { code, out } = run(dir, 99)
  check('syntax metadata and attribute order cannot hide mangled types', code !== 0 && out.includes('s:s8CopyableP'), `exited ${code}:\n${out}`)
  rmSync(dir, { recursive: true, force: true })
}

for (const quote of ["'", '"']) {
  const comment = `<!-- ${quote} -->`
  const markup = '<span class="api-type"><span class="api-punct" data-api-role="syntax">s</span>' +
    comment + '<span class="api-punct" data-api-role="syntax">:</span>' +
    '<span class="api-punct" data-api-role="syntax">s8CopyableP</span></span>'
  const dir = site({ markup })
  const { code, out } = run(dir, 99)
  check('quoted HTML comments cannot hide a visible mangled id', code !== 0 && out.includes('s:s8CopyableP'), `exited ${code}:\n${out}`)
  rmSync(dir, { recursive: true, force: true })

  const unknown = site({ markup: `<span class="api-type"><span class="api-punct">Un${comment}known</span></span>` })
  const result = run(unknown, 0)
  check('quoted HTML comments cannot hide a visible unknown type', result.code !== 0 && result.out.includes('Unknown(1)'), `exited ${result.code}:\n${result.out}`)
  rmSync(unknown, { recursive: true, force: true })
}

for (const quote of ["'", '"']) {
  const fragment = (value, note) => `<span data-note=${quote}${note}${quote}>${value}</span>`
  const attributeMangled = site({ markup: `<span class="api-type">${fragment('s', '<!--')}:${fragment('s8CopyableP', '-->')}</span>` })
  const mangledResult = run(attributeMangled, 99)
  check('comment delimiters in quoted attributes cannot hide a mangled id',
    mangledResult.code !== 0 && mangledResult.out.includes('s:s8CopyableP'), `exited ${mangledResult.code}:\n${mangledResult.out}`)
  rmSync(attributeMangled, { recursive: true, force: true })

  const attributeUnknown = site({ markup: `<span class="api-punct">${fragment('Un', '<!--')}${fragment('known', '-->')}</span>` })
  const unknownResult = run(attributeUnknown, 0)
  check('comment delimiters in quoted attributes preserve the complete unknown name',
    unknownResult.code !== 0 && unknownResult.out.includes('Unknown(1)'), `exited ${unknownResult.code}:\n${unknownResult.out}`)
  rmSync(attributeUnknown, { recursive: true, force: true })

  const comment = `<!-- ${quote} --!>`
  const bangMangled = site({ markup: `<span class="api-type">s${comment}:s8CopyableP</span>` })
  const bangResult = run(bangMangled, 99)
  check('bang-ended quoted comments cannot hide a visible mangled id',
    bangResult.code !== 0 && bangResult.out.includes('s:s8CopyableP'), `exited ${bangResult.code}:\n${bangResult.out}`)
  rmSync(bangMangled, { recursive: true, force: true })

  const bangUnknown = site({ markup: `<span class="api-punct">Un${comment}known</span>` })
  const result = run(bangUnknown, 0)
  check('bang-ended quoted comments cannot hide a visible unknown type',
    result.code !== 0 && result.out.includes('Unknown(1)'), `exited ${result.code}:\n${result.out}`)
  rmSync(bangUnknown, { recursive: true, force: true })
}

for (const comment of ['<!-->', '<!--->']) {
  const dir = site({ markup: plain(`Un${comment}known`) })
  const { code, out } = run(dir, 0)
  check('abrupt empty comments preserve a visible unknown type', code !== 0 && out.includes('Unknown(1)'), `exited ${code}:\n${out}`)
  rmSync(dir, { recursive: true, force: true })
}

for (const quote of ["'", '"']) {
  const hidden = plain('Unknown') + usr()
  const comment = site({ markup: `<!-- ${quote} ${hidden} --!>` })
  const result = run(comment, 0)
  check('commented type markup contributes no names', result.code === 0, `exited ${result.code}:\n${result.out}`)
  rmSync(comment, { recursive: true, force: true })

  const value = quote === '"' ? hidden.replaceAll('"', "'") : hidden
  const attribute = site({ markup: `<div data-note=${quote}${value}${quote}></div>` })
  const { code, out } = run(attribute, 0)
  check('type markup inside a quoted attribute contributes no names', code === 0, `exited ${code}:\n${out}`)
  rmSync(attribute, { recursive: true, force: true })
}

if (failures) {
  console.error(`\ncheck-type-links cannot detect ${failures} of the situations it exists for.`)
  process.exit(1)
}
console.log('\ncheck-type-links.negative: mangled ids fail, the ceiling holds, and it only moves down')
