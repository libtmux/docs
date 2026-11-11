---
port: lisp
route: examples
title: Examples
description: Run the tested Common Lisp programs against private tmux daemons and compare each with its expected result.
sidebar:
  group: Examples
  label: Overview
  order: 1
---

The repository ships six programs under `examples/`. The test runner executes
each one against a private tmux daemon, and each prints or asserts the result
it is meant to show. Run one from a source checkout with the pinned toolchain,
for example `mise exec -- tools/lisp.sh examples/managed-daemon.lisp`. The
[capture pane output](../examples/capture-pane-output/) page builds one
program up in steps.

| Program | What it demonstrates | Guide |
| --- | --- | --- |
| [quickstart.lisp](https://github.com/libtmux/libtmux-lisp/blob/e6f319c4257789cfe39547af001c718975f0a2ef/examples/quickstart.lisp) | Split a pane in the `demo` session of a private socket you supply, add a window, send text, capture it and traverse the snapshot. | [Getting started](../guides/getting-started/) |
| [managed-daemon.lisp](https://github.com/libtmux/libtmux-lisp/blob/e6f319c4257789cfe39547af001c718975f0a2ef/examples/managed-daemon.lisp) | Start an isolated daemon, create a session and return pane data after closing the client and daemon. | [Getting started](../guides/getting-started/) |
| [configuration.lisp](https://github.com/libtmux/libtmux-lisp/blob/e6f319c4257789cfe39547af001c718975f0a2ef/examples/configuration.lisp) | Start an isolated daemon, read false and inherited options, inspect a hook and read a hidden environment entry. | Source only |
| [control.lisp](https://github.com/libtmux/libtmux-lisp/blob/e6f319c4257789cfe39547af001c718975f0a2ef/examples/control.lisp) | Own a daemon, queue input over one control connection and read pane output notifications until the expected bytes arrive. The control system refuses an older daemon before it starts; see [Capabilities and limits](../guides/capabilities/). | Source only |
| [workspace.lisp](https://github.com/libtmux/libtmux-lisp/blob/e6f319c4257789cfe39547af001c718975f0a2ef/examples/workspace.lisp) | Describe a topology as native data, create it, rename a shared window and report configuration. `run.lisp` loads it and asserts the result. | [REPL tutorial](../guides/tutorial/) |
| [owned-workspace.lisp](https://github.com/libtmux/libtmux-lisp/blob/e6f319c4257789cfe39547af001c718975f0a2ef/examples/owned-workspace.lisp) | Create an owned workspace, reapply it without changes, reconcile an edit, and end one apply with a bad layout checksum to inspect the stopped work. | [Workspace guide](../workspace/source-guide/) |

## Support files

- [run.lisp](https://github.com/libtmux/libtmux-lisp/blob/e6f319c4257789cfe39547af001c718975f0a2ef/examples/run.lisp) loads `workspace.lisp` against a caller-supplied socket and
  asserts the graph it creates.
- [worker.sh](https://github.com/libtmux/libtmux-lisp/blob/e6f319c4257789cfe39547af001c718975f0a2ef/examples/worker.sh) is the small application the REPL tutorial's pane runs: it
  signals that it initialized, consumes one request and prints a receipt.
- [workspace.json](https://github.com/libtmux/libtmux-lisp/blob/e6f319c4257789cfe39547af001c718975f0a2ef/examples/workspace.json) and [owned-workspace.json](https://github.com/libtmux/libtmux-lisp/blob/e6f319c4257789cfe39547af001c718975f0a2ef/examples/owned-workspace.json) are the JSON
  documents the workspace command validates and plans.
