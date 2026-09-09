---
title: Swift MCP topics
description: Understand readonly defaults, exact tool selections, daemon-bound references, and waits.
port: swift
product: mcp
sidebar:
  label: Topics
  order: 1
---

Swift's MCP server defaults to readonly tools on the `default` socket.
The executable reads environment variables and accepts no flags.

## Tier and exact selection

`LIBTMUX_SAFETY` chooses readonly, mutating, or destructive.
An invalid value falls back to readonly with a diagnostic.
`LIBTMUX_MCP_TOOLS` is an exact comma-separated allowlist intersected
with the tier. An unknown or malformed tool name selects no tools.

Embedding code can use `ToolAuthority` with typed `ToolOperation`
values. An exact selection does not automatically include newly added
operations.

A mutating selection includes `run_shell` and `send_keys`.
The tier classifies tool intent; it does not confine a pane's shell or
the host user.

## Preserve opaque references

Hierarchy rows carry opaque references bound to the current tmux daemon.
They expire when the MCP process restarts. Re-list to obtain fresh
references; do not substitute raw pane IDs.

A window can have multiple session-local occurrences. `windowRef`
identifies the global window, while `linkRef` identifies a particular
session link. Preserve the reference appropriate to the operation.

## Wait without resubmitting work

`run_shell` waits for deterministic command completion.
If it reports `timedOut`, the command may still be running.
Inspect the pane before deciding whether another command is needed.

`wait_for_output` handles output produced elsewhere and accepts success
and stop patterns. `watch_format` observes a state field when terminal
text is not the condition you need.

The default wait ceiling is 120 seconds. Configuration is clamped between
1 and 300 seconds.

## Workspace application

`apply_workspace` accepts structured workspace data and refuses an
existing session. Failed builds attempt cleanup of the exact new session;
cleanup failure is reported with the original error.

[Executable configuration](https://github.com/libtmux/libtmux-swift/blob/f02a4668570e1cc5198c941413750e021f42c214/Sources/libtmux-mcp/README.md),
[reference semantics](https://github.com/libtmux/libtmux-swift/blob/f02a4668570e1cc5198c941413750e021f42c214/Sources/LibTmuxMCP/README.md),
and [workspace behavior](../../workspace/internals/topics/).
