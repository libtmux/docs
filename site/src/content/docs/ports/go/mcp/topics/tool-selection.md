---
title: Choose the tools a client can call
description: Combine startup toolsets, exact names, and exclusions, then inspect the effective MCP surface.
port: go
product: mcp
sidebar:
  group: Topics
  order: 10
---

Tool selection is evaluated at startup. Only advertised tools can be called
directly. A selected batch tool can also invoke its permitted nested operations,
as described below. Changing the environment requires a new server process
and connection.

## Toolsets

`LIBTMUX_TOOLSETS` accepts a comma-separated selection:

| Toolset | Use it for |
| --- | --- |
| `inspect` | Read sessions, windows, panes, configuration, and terminal output. |
| `manage` | Create and arrange sessions, windows, and panes. |
| `execute` | Send terminal input and run commands. |
| `teardown` | Remove sessions, windows, and panes. |

With no explicit selection, an existing or explicitly selected endpoint uses
`inspect,manage,execute`. The default dedicated daemon gains `teardown` only
when the launcher verifies that its own minimal-config startup created it.
An explicit `inspect` selection remains inspection-only regardless of that
ownership result.

A present but empty `LIBTMUX_TOOLSETS` selects no toolsets. An unset variable
uses defaults. There is no `none` sentinel. Leading, trailing, and interior
empty list items are errors, as are unknown names. Validate configuration
before reconnecting a client that depends on it.

## Exact tools and exclusions

`LIBTMUX_TOOLS` adds exact names after expanding toolsets.
`LIBTMUX_EXCLUDE_TOOLS` removes names last, even if another selection included
them. For a connected command-only client, the
[complete command example](../../examples/run-command/) uses an empty toolset
plus `LIBTMUX_TOOLS=run_shell_command`.

To allow session metadata without the rest of `inspect`, set these values in
the client's environment:

```json
{
  "LIBTMUX_TOOLSETS": "",
  "LIBTMUX_TOOLS": "list_sessions"
}
```

[`call_read_tools_batch`](../../tools/call_read_tools_batch/) has its own set
of permitted nested operations. Selecting that batch by name includes those
operations even when they are absent from top-level discovery. For example,
an empty toolset plus `LIBTMUX_TOOLS=call_read_tools_batch` exposes the batch
and its nested reads without exposing those reads as separate tools.

`LIBTMUX_EXCLUDE_TOOLS` also removes operations from the batch's advertised
schema and dispatch. Exclude an operation explicitly when it must be
unavailable through both paths. Inspect the batch schema before constructing
a request.

## Inspect the active selection

Read `tmux://capabilities` and compare it with the client's tool discovery.
The resource records the effective names, selection, connection provenance,
and capability rows also attached to each tool's metadata. It is a startup
snapshot. Use [`list_sessions`](../../tools/list_sessions/) and
[`list_panes`](../../tools/list_panes/) for current topology.

The [selection resolver](https://github.com/libtmux/libtmux-go/blob/6e7420927f4cb717fe089a710328e44e8d551025/mcp/tool_surface.go)
and [capability catalog](https://github.com/libtmux/libtmux-go/blob/6e7420927f4cb717fe089a710328e44e8d551025/mcp/manifest_catalog.go)
define names, schemas, and expansion. The
[tool reference](../../tools/) describes individual arguments and results.

## Terminal input

Inspection can reveal terminal content and configuration. Input and execution
run with the tmux user's authority; choosing a socket does not confine a shell
command's effects to tmux. Choose the smallest useful selection for the task.

The input handlers also check the target's current mode and synchronized-pane
membership. A tool may require client interaction before input is sent, or
refuse a dead or unsuitable target. If the client cannot complete the requested
interaction, treat the tool error as a failed operation; do not infer success
from the tool being present in discovery.

See the [input handlers](https://github.com/libtmux/libtmux-go/blob/6e7420927f4cb717fe089a710328e44e8d551025/mcp/capability_handlers.go)
and [input checks](https://github.com/libtmux/libtmux-go/blob/6e7420927f4cb717fe089a710328e44e8d551025/mcp/input_tools.go)
for the selected release's behavior.
