---
title: TypeScript MCP topics
description: Understand immutable tool selection, tmux provenance, pane protections, and output cursors.
port: ts
product: mcp
sidebar:
  label: Topics
  order: 1
---

The TypeScript MCP server selects its endpoint and tool surface at startup.
Later environment changes do not retarget a running process.

## Toolsets and startup provenance

`inspect`, `manage`, `execute`, and `teardown` are independent sets.
`LIBTMUX_TOOLSETS` selects sets, `LIBTMUX_TOOLS` adds exact names, and
`LIBTMUX_EXCLUDE_TOOLS` removes names last. Exclusions also govern nested
operations in `call_read_tools_batch`.

An explicitly empty selection starts with no tools. Unknown names, empty
comma-separated elements, and retired safety/allowlist variables fail
startup before contacting tmux.

Without socket or configuration variables, the executable selects
`libtmux-mcp`. If it creates that daemon with the shipped minimal
configuration and verifies its startup marker, all four sets are enabled
by default. Existing or explicitly selected daemons default to
`inspect,manage,execute`.

Tool filtering controls this MCP interface. A shell command still acts
with the tmux user's authority, and a socket name does not confine
processes.

## Pane input and human activity

Input preflight checks caller context, attached human clients, pane modes,
and synchronized-input membership. A `force` argument confirms only the
exact MCP caller pane; it does not override the other checks.

`run_shell_command` requires one live supported POSIX shell and refuses
a synchronized input cohort. It checks before setup and immediately before
dispatch. These observations are not an atomic tmux transaction.

## Commands, waits, and cursors

Use `run_shell_command` for authored commands. Its result separates
command output from the echoed wrapper and includes the real exit status.
It runs the command in a subshell, so directory and environment changes do
not persist in the parent shell.

Use `wait_for_text` for output produced elsewhere and `capture_since`
for repeated reads. Waits report why they stopped, their effective timeout,
and captured output. Cancelling a request stops its wait.

Setting `LIBTMUX_MCP_LIVE=0` prevents control-mode connections.
`wait_for_text` remains listed but returns a `no_stream` error;
`capture_since` returns a bounded non-streaming capture.

[Tool and runtime semantics](https://github.com/libtmux/libtmux-ts/blob/f85b8de551353f746d50eaf36bf0112f4fe5a528/packages/mcp/README.md).
