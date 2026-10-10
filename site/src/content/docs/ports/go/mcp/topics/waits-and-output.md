---
title: Waits and command output
description: Check tool errors, command completion, exit status, and captured output separately.
port: go
product: mcp
sidebar:
  group: Topics
  order: 20
---

[`run_shell_command`](../../tools/run_shell_command/) sends a command to a
selected pane, waits for completion, and returns structured status and output.
The [complete client program](../../examples/run-command/) demonstrates a
command that deliberately exits with status 7.

## Read the result

Check each layer before using the result:

1. A client call error means the protocol exchange failed or was cancelled.
2. A reply with [`IsError`](https://pkg.go.dev/github.com/modelcontextprotocol/go-sdk@v1.6.1/mcp#CallToolResult) set reports a tool failure. Read its text content.
3. In a successful tool reply, `timed_out` and `exit_status` establish whether
   completion was observed. A nonzero exit status is a command result.
4. `output_unavailable` or `lines_missed` means the returned output is
   incomplete, even if the command's exit status is known. Clear flags still
   leave the request's `max_lines` limit in effect.

The command example decodes the public snake_case fields, including
`pane_id`, `resolved_pane_ids`, `exit_status`, and `timed_out`. Use the
[advertised tool schema](../../tools/run_shell_command/) when constructing a
request. Internal Go structs may have different JSON field names.

## Choose one pane

Use a discovered pane ID for the request. The command example creates a
private session, resolves its active pane, and verifies that the reply names
that same pane exactly once. Synchronized input can reach other panes, so the
command handler checks the resolved membership before execution.

The [command wrapper](https://github.com/libtmux/libtmux-go/blob/6e7420927f4cb717fe089a710328e44e8d551025/mcp/command_wrapper.go)
provides completion tracking; the
[public handler](https://github.com/libtmux/libtmux-go/blob/6e7420927f4cb717fe089a710328e44e8d551025/mcp/capability_handlers.go)
validates the request and constructs its result.

## Deadlines

The request's `timeout` bounds the wait for completion. The server's
`LIBTMUX_MCP_WAIT_MAX_SECONDS` imposes a further ceiling, defaulting to 300
seconds. A requested wait above the ceiling is clamped. Inspect the tool's
returned timeout metadata when choosing a follow-up action.

A wait timeout or a cancelled client call does not establish that the shell
command stopped. Inspect the pane before sending more input. Retrying an
unconfirmed command can execute it twice. The server does not return a
background job handle that can later be polled or cancelled.

Keep the client deadline long enough to cover startup and the bounded tool
wait. The complete examples use a 20-second context for startup and requests,
three seconds at each subprocess shutdown stage, and a separate five-second
context for their own tmux cleanup.

## Observe existing output

Use [`capture_pane`](../../tools/capture_pane/) for a current capture,
[`capture_since`](../../tools/capture_since/) for output after a cursor, and
[`wait_for_text`](../../tools/wait_for_text/) for an expected terminal
condition. Each tool's reference defines its cursor, matching, and output
limits. A terminal view is not a durable process log: history limits and pane
changes can prevent a complete capture.

The command example requests `max_lines: 20`, retaining the newest bounded
output. The public reply omits the internal truncation fields, so clear
`output_unavailable` and `lines_missed` flags do not establish that every line
was returned. Choose the limit for the output you need.

The example treats unavailable or missed output as a failure while preserving
a known exit status in its error. Applications can instead retain that partial
data and show its limitations explicitly.
