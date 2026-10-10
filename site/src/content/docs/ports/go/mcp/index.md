---
title: tmux MCP for Go
description: Connect an MCP client to tmux and read structured results from complete Go programs.
port: go
product: mcp
sidebar:
  label: Overview
  order: 0
cards:
  - label: Connect a client
    href: guides/connect-client/
    body: Install the executable, select a socket, and diagnose startup.
  - label: Tool selection
    href: topics/tool-selection/
    body: Choose toolsets, individual tools, and exclusions.
  - label: List sessions
    href: examples/inspect-sessions/
    body: Run a complete SDK client against its own tmux server.
  - label: Run a command
    href: examples/run-command/
    body: Check command completion, exit status, and captured output.
---

[`github.com/libtmux/libtmux-go/mcp`](https://github.com/libtmux/libtmux-go/blob/6e7420927f4cb717fe089a710328e44e8d551025/mcp/README.md)
is a separate Go module that exposes
tmux through MCP. Its executable is `libtmux-mcp`. Installing the core
tmux module does not install this server or its protocol dependencies.

The server requires Go 1.26 or newer to build and tmux 3.2a or newer to run.
The MCP client launches `libtmux-mcp` and exchanges messages over stdin and
stdout. The server selects one tmux endpoint and its offered tools at startup.
Reconnect after changing that configuration.

## Start here

- [Install](#install) points an MCP client at this server.
- [Tools](./tools/) lists the MCP operations, arguments, and results.
- [Guides](./guides/) install the command and diagnose its connection.
- [Topics](./topics/) explain toolsets, command waits, and capability discovery.
- [Examples](./examples/) include complete client programs and their setup.
- [Language API](./reference/) documents embedding and implementation types.

Read `tmux://capabilities` for the effective startup selection. The
[Workspace Manager](../workspace/) is a separate module; the current MCP
catalog does not include a workspace-file operation.

[Module contract](https://github.com/libtmux/libtmux-go/blob/6e7420927f4cb717fe089a710328e44e8d551025/mcp/README.md).
