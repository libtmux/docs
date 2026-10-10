---
title: Go MCP examples
description: Run complete SDK clients that inspect sessions and check a shell command's result.
port: go
product: mcp
sidebar:
  label: Overview
  group: Examples
  order: 3
cards:
  - label: List sessions through MCP
    href: inspect-sessions/
    body: Create a private server and read structured session metadata.
  - label: Run a command through MCP
    href: run-command/
    body: Execute a command in one pane and check its exit status and output.
---

Each program includes its dependencies, entry point, private tmux server,
client transport, deadlines, and cleanup. The MCP executable is installed
inside the example directory. No pre-existing tmux session is required.

## List sessions

The [session inspector](inspect-sessions/) calls
[`list_sessions`](../tools/list_sessions/) and verifies the returned session
ID against the session it created. It reads metadata without sending input
or capturing terminal content through MCP.

## Internals

Applications can also embed the server and use an in-memory client transport.
The upstream [agent-workflow program](https://github.com/libtmux/libtmux-go/blob/6e7420927f4cb717fe089a710328e44e8d551025/mcp/examples/agent-workflow/main.go)
demonstrates caller context, pane creation, command completion, and topology
inspection. The [language API reference](../reference/) documents the types
used to embed the server.

### Run the agent workflow

The [upstream example instructions](https://github.com/libtmux/libtmux-go/blob/6e7420927f4cb717fe089a710328e44e8d551025/mcp/examples/agent-workflow/README.md)
describe its repository setup and socket selection. For a standalone program
with all setup on one page, use [Run a command](run-command/).

### Clean up

The standalone programs close the MCP connection before stopping their owned
tmux server. They use a fresh cleanup deadline even when a request times out,
and retain the temporary directory if server cleanup fails. They never select
your default tmux socket.

For workspace configuration without MCP, see
[Workspace builder examples](../../workspace/internals/examples/).
