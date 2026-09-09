---
title: MCP for .NET
description: Run LibTmux.Mcp as a .NET tool with bounded results, jobs, resources, and prompts.
port: dotnet
product: mcp
sidebar:
  label: Overview
  order: 0
---

`LibTmux.Mcp` is a .NET tool package whose executable is
`libtmux-mcp`. It serves tmux tools, hierarchy resources, subscriptions,
and workflow prompts over standard input and output.

The tool targets .NET 8 and .NET 10 and requires a POSIX host with tmux.
Its registered operations use the `tmux_` prefix, including
`tmux_capture_pane`, `tmux_run`, and `tmux_start_job`.

## Start here

- [Tools](./tools/) lists the MCP operations, arguments, and results.
- [Guides](./guides/) install the tool and choose a socket.
- [Topics](./topics/) explain tiers, result limits, jobs, and subscriptions.
- [Examples](./examples/) call a tool, then explore server internals.
- [Language API](./api/) documents embedding and implementation types.

The default surface tier is `mutating`. Dedicated removal requires
`destructive`; `readonly` omits writing tools.

[Workspace Manager](../workspace/) is the separately packaged
`LibTmux.Workspace` library. A workflow prompt about building a workspace
is not a configuration-file API.

[Package contract](https://github.com/libtmux/libtmux-dotnet/blob/6656a563ec9e07ab52e0c3ac96f7704fc94cc0c0/src/LibTmux.Mcp/README.md).
