#!/usr/bin/env node
import { runMark, runShim } from './lib/core-trace.mjs'

/**
 * The two programs a recording puts on a program's PATH, as one entry point:
 * `core-trace.mjs shim <tmux arguments>` stands in for tmux and
 * `core-trace.mjs mark <step> <json>` records that an API call returned.
 * gen-core-recording.mjs writes a `tmux` and a `docs-mark` wrapper that run
 * them. See lib/core-trace.mjs.
 */
const [mode, ...args] = process.argv.slice(2)
if (mode === 'shim') runShim(args)
else if (mode === 'mark') await runMark(args)
else throw new Error(`usage: core-trace.mjs shim <tmux arguments> | mark <step> <json>, not ${mode}`)
