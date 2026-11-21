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

The repository ships seven programs under `examples/`. The test runner executes
each one against a private tmux daemon, and each prints or asserts the result
it is meant to show. Run one from a source checkout with the pinned toolchain,
for example `mise exec -- sbcl --script examples/managed-daemon.lisp`. The
[capture pane output](../examples/capture-pane-output/) page builds one
program up in steps.

| Program | What it demonstrates | Guide |
| --- | --- | --- |
| [quickstart.lisp](https://github.com/libtmux/libtmux-lisp/blob/9f364931a38fafce7bfea7cb4f7e6b32ef49ebb4/examples/quickstart.lisp) | Start an isolated daemon, create the `demo` session, split a pane, add a window, send text, capture it and traverse the snapshot. | [Getting started](../guides/getting-started/) |
| [managed-daemon.lisp](https://github.com/libtmux/libtmux-lisp/blob/9f364931a38fafce7bfea7cb4f7e6b32ef49ebb4/examples/managed-daemon.lisp) | Start an isolated daemon, create a session and return pane data after closing the client and daemon. | [Getting started](../guides/getting-started/) |
| [drive-panes.lisp](https://github.com/libtmux/libtmux-lisp/blob/9f364931a38fafce7bfea7cb4f7e6b32ef49ebb4/examples/drive-panes.lisp) | Start an isolated daemon, split a pane, send it text, capture its screen and resize the window and pane. | [Getting started](../guides/getting-started/) |
| [configuration.lisp](https://github.com/libtmux/libtmux-lisp/blob/9f364931a38fafce7bfea7cb4f7e6b32ef49ebb4/examples/configuration.lisp) | Start an isolated daemon, read false and inherited options, inspect a hook and read a hidden environment entry. | Source only |
| [control.lisp](https://github.com/libtmux/libtmux-lisp/blob/9f364931a38fafce7bfea7cb4f7e6b32ef49ebb4/examples/control.lisp) | Own a daemon, queue input over one control connection and read pane output notifications until the expected bytes arrive. The control system refuses an older daemon before it starts; see [Capabilities and limits](../guides/capabilities/). | Source only |
| [workspace.lisp](https://github.com/libtmux/libtmux-lisp/blob/9f364931a38fafce7bfea7cb4f7e6b32ef49ebb4/examples/workspace.lisp) | Describe a topology as native data, create it, rename a shared window and report configuration. `run.lisp` loads it and asserts the result. | [REPL tutorial](../guides/tutorial/) |
| [owned-workspace.lisp](https://github.com/libtmux/libtmux-lisp/blob/9f364931a38fafce7bfea7cb4f7e6b32ef49ebb4/examples/owned-workspace.lisp) | Create an owned workspace, reapply it without changes, reconcile an edit, and end one apply with a bad layout checksum to inspect the stopped work. | [Workspace guide](../workspace/source-guide/) |

## Support files

- [run.lisp](https://github.com/libtmux/libtmux-lisp/blob/9f364931a38fafce7bfea7cb4f7e6b32ef49ebb4/examples/run.lisp) loads `workspace.lisp` against a caller-supplied socket and
  asserts the graph it creates.
- [worker.lisp](https://github.com/libtmux/libtmux-lisp/blob/9f364931a38fafce7bfea7cb4f7e6b32ef49ebb4/examples/worker.lisp) is the small application the REPL tutorial's pane runs: it
  signals that it initialized, consumes one request and prints a receipt.
- [workspace.json](https://github.com/libtmux/libtmux-lisp/blob/9f364931a38fafce7bfea7cb4f7e6b32ef49ebb4/examples/workspace.json) and [owned-workspace.json](https://github.com/libtmux/libtmux-lisp/blob/9f364931a38fafce7bfea7cb4f7e6b32ef49ebb4/examples/owned-workspace.json) are the JSON
  documents the workspace command validates and plans.
