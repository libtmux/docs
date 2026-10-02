#!/usr/bin/env node
/*
 * Proof that check-quote-coverage.mjs fails, and fails for the stated reason,
 * on each way a quoted example can go unaccounted for — and that the list of
 * exemptions can only shrink.
 *
 * The controls matter as much as the defects: a check that rejected every
 * input would satisfy all four failure cases and still be worthless, and this
 * one has to keep passing the registry the repository actually ships.
 *
 * Reads nothing, so it runs wherever the rest of the suite does.
 */
import { NOT_IN_THE_ARENA, isReasonCode, runCheck } from './check-quote-coverage.mjs'

let failures = 0
function expect(name, results, key, wantStatus, fragment) {
  const got = results.find((r) => r.key === key)
  const ok = got && got.status === wantStatus && (!fragment || got.reason.includes(fragment))
  if (ok) console.log(`ok      ${name}`)
  else {
    failures += 1
    console.error(`FAILED  ${name}: ${got ? `got ${got.status} — ${got.reason}` : `no result for ${key}`}`)
  }
}

const exempt = (code) => new Map([['port:examples/excused.rs', { code, why: 'why', gate: 'the port runner' }]])

// Control: the registry this repository ships accounts for every quoted
// source. Without this the four defects below could all pass while the real
// check was broken.
const live = runCheck()
const unaccounted = live.filter((r) => r.status === 'fail')
if (unaccounted.length === 0) console.log('ok      the shipped registry accounts for every quoted source')
else {
  failures += 1
  console.error(`FAILED  the shipped registry: ${unaccounted.map((r) => `${r.key} — ${r.reason}`).join('; ')}`)
}

// Control: an artifact runs it, so nothing more is asked of it.
expect(
  'a quoted source an artifact runs',
  runCheck({ quoted: { 'port:examples/run.rs': '' }, executed: ['port:examples/run.rs'], exempt: new Map() }),
  'port:examples/run.rs',
  'run',
)

// Control: quoted, unrun, listed with a code from the table — the case the
// list exists for.
expect(
  'a quoted source listed with a reason code',
  runCheck({ quoted: { 'port:examples/excused.rs': '' }, executed: [], exempt: exempt('serves-stdio') }),
  'port:examples/excused.rs',
  'exempt',
  'the port runner',
)

// The defect this check was written for: a page quotes a program nothing in
// the arena runs, and nobody decided to allow it.
expect(
  'a quoted source nothing runs and nothing excuses',
  runCheck({ quoted: { 'port:examples/new.rs': '' }, executed: [], exempt: new Map() }),
  'port:examples/new.rs',
  'fail',
  'run by no arena artifact',
)

// The ratchet: an entry that an artifact now runs has to go, or the list
// becomes a record of things that used to be true.
expect(
  'an exemption an artifact now runs',
  runCheck({
    quoted: { 'port:examples/excused.rs': '' },
    executed: ['port:examples/excused.rs'],
    exempt: exempt('serves-stdio'),
  }),
  'port:examples/excused.rs',
  'fail',
  'delete the entry',
)

// The ratchet, the other way: the page went, so the exemption is excusing
// nothing.
expect(
  'an exemption no page quotes',
  runCheck({ quoted: {}, executed: [], exempt: exempt('serves-stdio') }),
  'port:examples/excused.rs',
  'fail',
  'no page quotes it',
)

// A reason has to cite the shared table. Free text here would let each
// exemption invent its own category, which is how a table stops meaning
// anything.
expect(
  'an exemption with an invented code',
  runCheck({ quoted: { 'port:examples/excused.rs': '' }, executed: [], exempt: exempt('too-slow') }),
  'port:examples/excused.rs',
  'fail',
  'not one of the shared reason codes',
)

// `platform:` carries a name, so it is matched by prefix rather than listed.
// Both halves are asserted: a bare `platform` is not a code.
for (const [code, want] of [['platform:windows', true], ['platform', false], ['platform:', false]]) {
  if (isReasonCode(code) === want) console.log(`ok      "${code}" ${want ? 'is' : 'is not'} a reason code`)
  else {
    failures += 1
    console.error(`FAILED  "${code}": isReasonCode returned ${isReasonCode(code)}`)
  }
}

// Every shipped exemption cites the table, checked directly rather than only
// through the registry above, so a future entry cannot pass by being unquoted.
for (const [key, entry] of NOT_IN_THE_ARENA) {
  if (isReasonCode(entry.code) && entry.gate && entry.why) console.log(`ok      ${key} cites ${entry.code} and names its gate`)
  else {
    failures += 1
    console.error(`FAILED  ${key}: code "${entry.code}", gate "${entry.gate}"`)
  }
}

if (failures) {
  console.error(`quote coverage (negative): ${failures} expectation(s) failed`)
  process.exit(1)
}
console.log('quote coverage (negative): every defect rejected; the controls passed')
