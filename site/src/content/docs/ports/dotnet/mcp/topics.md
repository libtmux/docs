---
title: .NET MCP topics
description: Understand surface tiers, cursor and job lifetimes, bounded output, and resource subscriptions.
port: dotnet
product: mcp
sidebar:
  label: Topics
  order: 1
---

The .NET MCP server registers tools according to a startup tier and
bounds the size and duration of responses.

## Surface and endpoint

`LIBTMUX_SAFETY` chooses `readonly`, `mutating`, or `destructive`.
The default is mutating. Unknown values fall back to readonly. A tool above
the tier is not registered and cannot be called.

A positional launcher argument selects the default socket, otherwise
`LIBTMUX_SOCKET` supplies it. Tool calls that accept a socket argument
can choose another endpoint. The default socket is not a confinement
boundary.

Removing dedicated kill tools does not stop `tmux_send_keys` or
`tmux_run` from submitting equivalent shell commands.

## Commands and retained handles

`tmux_run` waits for a command's real exit status. A timed-out command
may still be running; repeating the call submits another command.
Use `tmux_start_job` and `tmux_job` for work that needs a durable handle
between calls.

Job handles bind to the exact socket, tmux process, and pane.
Collection advances only after the complete result fits the response
budget. `tmux_tail_pane` cursors also bind to the daemon and pane and
expire when the MCP server restarts. Omit an expired cursor to establish
a fresh position.

## Results and subscriptions

Terminal results retain the newest lines and report discarded content.
The default limits are 500 lines and 128000 bytes per serialized result.
A result that still cannot fit becomes a small error explaining how to
narrow the call or raise the limit.

Waits use control-mode output as a wake-up signal when available and
capture rendered text for the answer. They fall back to bounded polling
if control mode cannot start.

Hierarchy subscriptions start a separate control client on the first
subscription and release it after the last. Optional MCP tasks let clients
collect certain long waits later; `tmux_start_job` supplies the durable
command handle when that is the needed lifecycle.

[Behavior and lifetime contract](https://github.com/libtmux/libtmux-dotnet/blob/6656a563ec9e07ab52e0c3ac96f7704fc94cc0c0/docs/mcp/README.md).
