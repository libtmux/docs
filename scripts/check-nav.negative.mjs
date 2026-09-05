#!/usr/bin/env node
/*
 * Proof that each of check-nav's four checks can fail.
 *
 * A check that cannot fail is worse than no check: it reports green forever
 * and the reader stops looking. Five have been found in this repository, so
 * every check now ships with the input that breaks it.
 *
 * The fixtures are compiled by the real `compileNav` and written as real
 * sidecars, then read by the real `scripts/check-nav.mjs`. Hand-written
 * diagnostics would prove only that the script can read a file it was handed.
 *
 * The `clean` case is the one that makes the others mean anything: a fixture
 * with nothing wrong must exit 0. Without it a script that always failed would
 * pass every negative case here.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { compileNav } from '../packages/api-model/src/nav.ts'

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-nav.mjs')
const sym = (name, file = 'src/thing.ts') => ({ name, id: name, kind: 'class', source: { file } })
const bucket = (id, match) => ({ id, label: id, match })
const ctx = { conceptIds: {}, moduleOf: () => '' }

/** Each case: the ports to write, and the check its input must trip. */
const CASES = {
  unmatched: {
    trips: 'unmatched',
    ports: {
      py: {
        symbols: [sym('Server'), sym('Orphan')],
        buckets: [bucket('server', { kind: 'name', re: 'Server' })],
      },
    },
  },
  ambiguous: {
    trips: 'ambiguous',
    ports: {
      py: {
        // No `not` clauses: exactly the CapturePaneRequest case, where two
        // unrelated buckets both claim and declaration order decides.
        symbols: [sym('FooBar')],
        buckets: [
          bucket('foo', { kind: 'name', prefix: 'Foo' }),
          bucket('bar', { kind: 'name', suffix: 'Bar' }),
        ],
      },
    },
  },
  stale: {
    trips: 'stale',
    ports: {
      py: {
        symbols: [sym('Server')],
        buckets: [bucket('server', { kind: 'name', re: 'Server' })],
        unsettled: { Server: 'an exemption that outlived the rule it excused' },
      },
    },
  },
  dead: {
    trips: 'dead',
    // Two ports, because a bucket empty in one port is not a dead rule. This
    // fails only if `ghost` is empty in BOTH.
    ports: {
      py: {
        symbols: [sym('Server')],
        buckets: [
          bucket('server', { kind: 'name', re: 'Server' }),
          bucket('ghost', { kind: 'name', re: 'NothingIsCalledThis' }),
        ],
      },
      ts: {
        symbols: [sym('Server')],
        buckets: [
          bucket('server', { kind: 'name', re: 'Server' }),
          bucket('ghost', { kind: 'name', re: 'NothingIsCalledThis' }),
        ],
      },
    },
  },
  orphaned: {
    trips: 'orphaned',
    ports: {
      // A child bucket that holds symbols and is missing from the tree the
      // sidecar writes. This is what splitting a bucket into children does if
      // the writer forgets to descend: the pages build, the links resolve,
      // and the sidebar quietly stops listing them.
      py: {
        symbols: [sym('Server'), sym('ServerOptions')],
        buckets: [bucket('server', { kind: 'name', re: 'Server' })],
        hideChildren: true,
        extraChild: { id: 'server-options', match: { kind: 'name', suffix: 'Options' } },
      },
    },
  },
  clean: {
    trips: undefined,
    ports: {
      py: {
        symbols: [sym('Server')],
        buckets: [bucket('server', { kind: 'name', re: 'Server' })],
      },
      ts: {
        symbols: [sym('Server')],
        buckets: [bucket('server', { kind: 'name', re: 'Server' })],
      },
    },
  },
}

/** A bucket empty in every port must also be empty in one, so `dead` is only
 * reachable if the cross-port intersection is what decides. */
let failures = 0
for (const [name, spec] of Object.entries(CASES)) {
  const dir = mkdtempSync(join(tmpdir(), `check-nav-${name}-`))
  try {
    for (const [port, { symbols, buckets, unsettled, hideChildren, extraChild }] of Object.entries(
      spec.ports,
    )) {
      // The compiled nav knows about the child; the written tree will not.
      const withChild = extraChild
        ? buckets.map((b, i) =>
            i === 0
              ? { ...b, children: [{ id: extraChild.id, label: extraChild.id, match: extraChild.match }] }
              : b,
          )
        : buckets
      const nav = compileNav({ port, buckets: withChild, unsettled }, symbols, ctx)
      const byId = new Map(symbols.map((s) => [s.id, s]))
      writeFileSync(
        join(dir, `${port}.nav.json`),
        JSON.stringify({
          port,
          buckets: withChild.map((b) => ({
            id: b.id,
            label: b.label,
            collapsed: false,
            // `hideChildren` is the defect being provoked: a tree written
            // without the children the assignments refer to.
            ...(b.children && !hideChildren
              ? { children: b.children.map((c) => ({ id: c.id, label: c.label, collapsed: false })) }
              : {}),
          })),
          assignments: Object.fromEntries(
            Object.entries(nav.assignments).map(([b, ids]) => [
              b,
              ids.map((id) => ({ id, name: byId.get(id).name, slug: id, kind: 'class' })),
            ]),
          ),
          placement: {},
          unplaced: nav.unplaced.map((id) => ({
            id,
            name: byId.get(id).name,
            slug: id,
            kind: 'class',
          })),
          diagnostics: nav.diagnostics,
        }),
      )
    }

    let exit = 0
    let out = ''
    try {
      out = execFileSync('node', [script, '--dir', dir], { encoding: 'utf8', stdio: 'pipe' })
    } catch (err) {
      exit = err.status
      out = `${err.stdout ?? ''}${err.stderr ?? ''}`
    }

    if (spec.trips === undefined) {
      if (exit !== 0) {
        console.error(`FAIL clean — a fixture with nothing wrong exited ${exit}:\n${out}`)
        failures++
      } else console.log(`ok   clean      exits 0, so the four below mean something`)
      continue
    }

    if (exit === 0) {
      console.error(`FAIL ${name} — check-nav passed input that should trip '${spec.trips}'`)
      failures++
    } else if (!out.includes(`check-nav: ${spec.trips}`)) {
      console.error(`FAIL ${name} — exited ${exit} but never named '${spec.trips}':\n${out}`)
      failures++
    } else {
      console.log(`ok   ${name.padEnd(10)} exits ${exit} naming '${spec.trips}'`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (failures) {
  console.error(`\n${failures} of check-nav's checks cannot fail on input that should fail them.`)
  process.exit(1)
}
const proven = Object.values(CASES).filter((c) => c.trips).length
console.log(`\ncheck-nav.negative: ${proven} checks fail on input that should fail them`)
