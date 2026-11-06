#!/usr/bin/env node
import { controlIn, controlOut, controlStart, isControlInvocation, runMark, runShim } from './lib/core-trace.mjs'

/**
 * The two programs a recording puts on a program's PATH, as one entry point:
 * `core-trace.mjs shim <tmux arguments>` stands in for tmux and
 * `core-trace.mjs mark <step> <json>` records that an API call returned.
 * gen-core-recording.mjs writes a `tmux` and a `docs-mark` wrapper that run
 * them. See lib/core-trace.mjs.
 */
const [mode, ...args] = process.argv.slice(2)
if (mode === 'shim') await runShim(args)
else if (mode === 'mark') await runMark(args)
else if (mode === 'is-control') process.exit(isControlInvocation(args) ? 0 : 1)
else if (mode === 'control-start') controlStart(args[0], args.slice(1))
else if (mode === 'control-in') controlIn(args[0], args[1], args.slice(2))
else if (mode === 'control-out') await controlOut(...args)
else throw new Error(`usage: core-trace.mjs shim <tmux arguments> | mark <step> <json> | is-control | control-start | control-in | control-out, not ${mode}`)
