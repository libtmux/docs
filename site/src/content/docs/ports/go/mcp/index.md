---
title: MCP for Go
description: Run the Go MCP server or embed its managed instance over a selected tmux server.
port: go
product: mcp
sidebar:
  label: Overview
  order: 0
---

[`github.com/libtmux/libtmux-go/mcp`](https://github.com/libtmux/libtmux-go/blob/52968a3181c1c9e6d1b26c565d4b170968ae61c0/mcp/README.md)
is a separate Go module that exposes
tmux through MCP. Its executable is `libtmux-mcp`. Installing the core
tmux module does not install this server or its protocol dependencies.

The server requires Go 1.26 or newer to build and tmux 3.2a or newer to run.
It selects one tmux endpoint at startup. Toolsets select inspection,
management, execution, and teardown.

## Start here

- [Install](#install) points an MCP client at this server.
- [Tools](./tools/) lists the MCP operations, arguments, and results.
- [Guides](./guides/) install the command and diagnose its connection.
- [Topics](./topics/) explain toolsets, command waits, and capability discovery.
- [Examples](./examples/) call a tool, then explore server internals.
- [Language API](./reference/) documents embedding and implementation types.

Read `tmux://capabilities` for the effective startup selection. The
[Workspace Manager](../workspace/) is a separate module; the current MCP
catalog does not include a workspace-file operation.

[Module contract](https://github.com/libtmux/libtmux-go/blob/52968a3181c1c9e6d1b26c565d4b170968ae61c0/mcp/README.md).
