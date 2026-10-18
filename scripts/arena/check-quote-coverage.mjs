#!/usr/bin/env node
/*
 * Fail on a page that quotes an example program the arena never runs.
 *
 * check-quote-drift.mjs asks the other direction — of the sources an artifact
 * runs, does the page show the same bytes. That leaves the gap this closes: a
 * page is free to fence a file no artifact has ever executed, and it renders
 * exactly as well as one that is tested every run. Until now that case was
 * printed as "quoted with no arena adapter yet" and the run still passed, so
 * the list of them could grow without anyone deciding to let it.
 *
 * A quoted source must therefore be one of two things. Either an artifact runs
 * it, or it is listed below with a reason code from the shared table, naming
 * the gate that does run it. An unlisted one fails; so does a listed one that
 * an artifact now runs, or that no page quotes any more, so the list can only
 * shrink.
 *
 * Reads two data files and nothing else: no worktree, no toolchain, no tmux.
 * So it runs in the gate every CI job executes, not the port lane — which is
 * the point, because a page is added in a checkout that has no ports.
 *
 * Usage:
 *   node scripts/arena/check-quote-coverage.mjs
 *   node scripts/arena/check-quote-coverage.mjs --json
 */
import sources from '../../site/src/data/example-sources.json' with { type: 'json' }
import { ARTIFACTS } from './artifacts.mjs'

/**
 * The reason codes an exemption may carry, from the shared table the ports and
 * the site both draw on. `platform:` takes a name, so it is matched by prefix.
 *
 * A code outside this set is a failure rather than a new code: the table is
 * meant to be argued over once and then cited, and a one-off string in a list
 * like this is how a table stops meaning anything.
 */
export const REASON_CODES = new Set([
  'needs-client',
  'needs-terminal',
  'serves-stdio',
  'unbounded-stream',
  'test-context',
  'ambient',
  'destructive',
  'no-tmux',
  'invalid-by-design',
  'config',
  'historical',
  'pseudo',
])

export const isReasonCode = (code) => REASON_CODES.has(code) || /^platform:\S+$/.test(code)

/**
 * Quoted sources the arena does not run, why, and what runs them instead.
 *
 * `code` cites the shared table. `why` says what about this particular program
 * makes the arena the wrong gate for it, in terms a reader can check against
 * the file. `gate` names what does execute it, so "the arena skips it" never
 * reads as "nothing tests it".
 */
export const NOT_IN_THE_ARENA = new Map([
  [
    'rs:crates/libtmux/examples/scratch.rs',
    {
      code: 'destructive',
      why: 'its subject is owning a server: it builds one on a socket path it chooses, asserts no session survives the scope, then shuts the server down and unlinks the socket. Lending it a server would stop the server, and the assertion would be about the supervisor\'s own sessions.',
      gate: 'the rs example runner, which gives it an owned server and matches its output; its row carries no artifact id, which is how that runner spells owned-only.',
    },
  ],
  [
    'rs:crates/tmux-mcp/examples/readonly.rs',
    {
      code: 'serves-stdio',
      why: 'it serves MCP on stdin and stdout until its peer hangs up. The arena reads its evidence line from stdout, so an adapter here would have to write evidence into the protocol stream the example exists to demonstrate.',
      gate: 'the rs example runner, which plays the peer: it writes an MCP handshake, waits for `serverInfo`, and closes.',
    },
  ],
])

/**
 * @param {object} [input]
 * @param {Record<string, unknown>} [input.quoted] example-sources.json
 * @param {Iterable<string>} [input.executed] every key some artifact runs
 * @param {Map<string, {code: string, why: string, gate: string}>} [input.exempt]
 */
export function runCheck({
  quoted = sources,
  executed = ARTIFACTS.flatMap((entry) => entry.runs),
  exempt = NOT_IN_THE_ARENA,
} = {}) {
  const runs = new Set(executed)
  const results = []

  for (const key of Object.keys(quoted).sort()) {
    const listed = exempt.get(key)
    if (runs.has(key)) {
      if (listed) {
        results.push({
          key,
          status: 'fail',
          reason: `listed as ${listed.code} but an arena artifact runs it now — delete the entry`,
        })
      } else {
        results.push({ key, status: 'run', reason: 'an arena artifact runs it' })
      }
      continue
    }
    if (!listed) {
      results.push({
        key,
        status: 'fail',
        reason: 'quoted by a page and run by no arena artifact — give it an artifact, or list it in NOT_IN_THE_ARENA with a reason code and the gate that does run it',
      })
      continue
    }
    if (!isReasonCode(listed.code)) {
      results.push({ key, status: 'fail', reason: `"${listed.code}" is not one of the shared reason codes` })
      continue
    }
    results.push({ key, status: 'exempt', reason: `${listed.code}: ${listed.gate}` })
  }

  // An entry outliving the page that justified it. Nobody reads a list of
  // exemptions looking for the one that no longer applies to anything.
  for (const key of exempt.keys()) {
    if (!Object.hasOwn(quoted, key)) {
      results.push({ key, status: 'fail', reason: 'listed in NOT_IN_THE_ARENA but no page quotes it — delete the entry' })
    }
  }

  return results
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const results = runCheck()
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(results, null, 2))
  } else {
    for (const r of results) console.log(`${r.status.padEnd(7)} ${r.key} — ${r.reason}`)
  }
  const tally = (status) => results.filter((r) => r.status === status).length
  console.log(`\nquote coverage: ${tally('run')} quoted source(s) run by the arena, ${tally('exempt')} exempt, ${tally('fail')} unaccounted for`)
  if (tally('fail')) process.exitCode = 1
}
