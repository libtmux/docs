---
title: Go MCP topics
description: Choose tools, inspect the pinned endpoint, and interpret command completion and output.
port: go
product: mcp
sidebar:
  label: Overview
  group: Topics
  order: 1
cards:
  - label: Tool selection
    href: tool-selection/
    body: Combine toolsets, exact tool names, and exclusions at startup.
  - label: Waits and output
    href: waits-and-output/
    body: Distinguish tool errors, exit status, timeouts, and incomplete output.
---

The server selects one tmux endpoint and freezes its offered tools at startup.
These choices determine what the connected client can call.

## Select tools

Use `inspect` for hierarchy and terminal reads, `manage` for topology changes,
and `execute` for input and command execution. Select `teardown` when removal
is needed. [Tool selection](tool-selection/) explains defaults, individual
names, exclusions, and the distinction between missing and failing tools.

## Observe a command

[`run_shell_command`](../tools/run_shell_command/) waits for a bounded command
and reports completion separately from its exit status and captured output.
A timeout does not establish that the command stopped. Read
[Waits and output](waits-and-output/) before deciding whether to submit more
input to that pane.

## Resources and prompts

`tmux://capabilities` reports the startup endpoint and effective tools. Its
payload is static; use tools to read live hierarchy and terminal state. The
server offers no workflow prompts, dynamic resource templates, or detached
job handles. The [module contract](https://github.com/libtmux/libtmux-go/blob/6e7420927f4cb717fe089a710328e44e8d551025/mcp/README.md)
describes the resource and capability metadata.
