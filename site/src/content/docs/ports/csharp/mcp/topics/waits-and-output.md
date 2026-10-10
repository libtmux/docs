---
title: Waits and captured output
description: Choose command completion or text observation, handle bounded captures, and cancel the right operation.
port: csharp
product: mcp
sidebar:
  group: Topics
  order: 20
---

Use a command's exit status to determine whether it finished successfully.
Use terminal text observation when the process was started elsewhere or a
long-running service needs to report readiness. A text match does not prove
that a command exited.

## Command results

[`run_shell_command`](../../tools/run_shell_command/) sends a command to a
selected pane and waits for a tmux completion signal. Check the MCP result's
`isError` before interpreting its structured result, then read `exitStatus`,
`timedOut`, and `output`.

An unsuccessful shell exit and a tool failure are different results. The
shell can finish with a nonzero exit status while the MCP exchange succeeds.
If the wait times out or is cancelled, the command may still be running.
Inspect the pane before retrying or sending more input; a second submission
can start duplicate work.

`started: false` means the command wrapper was not seen to begin, usually
because the pane was not at an empty shell prompt. `paneExited` reports that
the pane's program ended before returning a status. Neither case provides a
successful shell exit. The [complete command example](../../examples/run-command/)
checks these fields along with captured output.

The command must target a pane that can accept the intended shell input.
Input refuses modal targets rather than leaving a human's copy mode for
them. `run_shell_command` also refuses a configured synchronized-input cohort
larger than one pane. These checks observe current state; they are not atomic
transactions with later tmux input delivery.

## Wait for text

[`wait_for_text`](../../tools/wait_for_text/) reads the pane and observes
control-mode notifications for changes. Notifications wake the wait; returned
text comes from a capture of tmux's rendered pane, not the raw event stream.
Layout and window-close events can also trigger a fresh read.

Control startup failure or stream loss ends the wait by default. Set
`LIBTMUX_MCP_ALLOW_POLLING_FALLBACK=true` only when repeated pane captures are
acceptable. Fallback waits 60 milliseconds between reads and remains bounded
by the original deadline and cancellation token. The capability resource
reports the configured policy, and an activated fallback reports
`pollingFallback: true` in the wait result.

`eventsDropped` reports lost session notifications while the wait held its
observer. That count can include other panes in the session. The server reads
the current pane again, but a fresh capture cannot reconstruct intermediate
output that is no longer available. A match establishes what the capture
contained, not a complete terminal transcript.

Polling fallback applies to pane text waits. `run_shell_command` and
[`wait_for_channel`](../../tools/wait_for_channel/) use tmux rendezvous
signals independently of that setting.

## Follow a pane

Use [`capture_pane`](../../tools/capture_pane/) for a bounded text capture or
[`snapshot_pane`](../../tools/snapshot_pane/) when pane metadata and content
should be returned together. Use [`capture_since`](../../tools/capture_since/)
to read subsequent output across several requests.

The first `capture_since` call omits a cursor and establishes a position.
Keep its returned opaque cursor and supply it on the next call for that same
pane. Cursors are authenticated and bound to the socket, daemon generation,
and pane. They cannot move between panes or servers, and restarting the MCP
process expires them. Omit an expired cursor to establish a new baseline.

Inspect the content's truncation and dropped-line or dropped-byte fields.
A successful capture can be incomplete. Narrow the requested history or
increase a relevant limit when the missing text matters to the task.

## Response limits

Startup policy bounds waits and returned data:

| Variable | Default | Accepted range |
| --- | --- | --- |
| `LIBTMUX_MCP_WAIT_MAX_SECONDS` | 30 seconds | 1–600 seconds |
| `LIBTMUX_MCP_MAX_LINES` | 500 lines | 10–100,000 lines |
| `LIBTMUX_MCP_MAX_BYTES` | 128,000 bytes | 4,000–4,000,000 bytes |

Numeric values outside those ranges are clamped. Invalid values fall back to
the default and produce a stderr diagnostic. These are ceilings or defaults;
individual tool arguments and schemas can impose tighter bounds.

The byte budget covers serialized results, including text, structured content,
and metadata. It is not a raw terminal-text byte count. JSON escaping and
duplicate representations can increase the serialized size. Content tools
truncate within the budget and report the loss. A result that still cannot
fit becomes a bounded error explaining how to narrow the call or adjust the
ceiling.

## Cancellation

A plain pending MCP request is cancelled with `notifications/cancelled` for
its JSON-RPC request ID. A client-side timeout alone does not establish that
the server received that notification. Check the client's cancellation
behavior when prompt observer cleanup matters.

When using the protocol's task support, cancel the task with `tasks/cancel`
and its task ID. Cancelling the request that created a task does not cancel
the task's work. Task-status polling is separate from polling pane contents.

Wait cleanup releases the control observer. Cancelling the wait does not
terminate a shell command already running in the pane. The server does not
provide a separate detached command-job registry.

These rules come from the pinned [protocol guide](https://github.com/libtmux/libtmux-dotnet/blob/ec8b6ab2a4f65e23664f43fba538ba200d4ae8bc/docs/mcp/README.md)
and [server policy](https://github.com/libtmux/libtmux-dotnet/blob/ec8b6ab2a4f65e23664f43fba538ba200d4ae8bc/src/LibTmux.Mcp/Policy/ServerPolicy.cs).
