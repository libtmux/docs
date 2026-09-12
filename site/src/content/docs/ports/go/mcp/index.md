---
title: MCP for Go
description: Run the Go MCP server or embed its managed instance over a selected tmux server.
port: go
product: mcp
sidebar:
  label: Overview
  order: 0
---

[`github.com/libtmux/libtmux-go/mcp`](https://github.com/libtmux/libtmux-go/blob/5f808882015a975a65acc7f9da5b3ff0d5cbdc91/mcp/README.md)
is a separate Go module that exposes
tmux through MCP. Its executable is `libtmux-mcp`. Installing the core
tmux module does not install this server or its protocol dependencies.

The server requires Go 1.26 or newer to build and tmux 3.2a or newer to run.
It selects one tmux endpoint at startup. The default surface exposes
topology metadata; terminal content and changes require explicit
capabilities.

## Start here

- [Install](#install) points an MCP client at this server.
- [Tools](./tools/) lists the MCP operations, arguments, and results.
- [Guides](./guides/) install the command and diagnose its connection.
- [Topics](./topics/) explain capabilities, operation ceilings, and jobs.
- [Examples](./examples/) call a tool, then explore server internals.
- [Language API](./api/) documents embedding and implementation types.

The server includes resources, subscriptions, prompts, and a
`build_workspace` tool backed by the
[Workspace Manager](../workspace/). These surfaces follow the configured
capability selection.

[Module contract](https://github.com/libtmux/libtmux-go/blob/5f808882015a975a65acc7f9da5b3ff0d5cbdc91/mcp/README.md).
