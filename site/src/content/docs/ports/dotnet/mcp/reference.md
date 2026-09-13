---
title: .NET MCP API
description: Distinguish the .NET tool package, source embedding APIs, and tmux-prefixed protocol operations.
port: dotnet
product: mcp
sidebar:
  label: Language API
  order: 4
---

For MCP client requests, use the [tool reference](../tools/). This page
covers language APIs for embedding or extending the server.

`LibTmux.Mcp` is distributed as a .NET tool package. Its source has public
classes, but installing the executable does not provide an ordinary
NuGet library reference for embedding.

## Source API

`McpTools.Reading` constructs `ReadTools`;
`McpTools.Writing` constructs `WriteTools`.
The writing factory owns newly created connection, activity, and job
resources. Dispose its result asynchronously; supplied server and job
objects remain caller-owned.

`McpServerComposition.Add` registers tools, resources, and prompts in a
service collection and returns the MCP builder for transport composition.
`ServerPolicy` holds the tier and response limits.

[Factory source](https://github.com/libtmux/libtmux-dotnet/blob/6656a563ec9e07ab52e0c3ac96f7704fc94cc0c0/src/LibTmux.Mcp/McpTools.cs)
and [composition source](https://github.com/libtmux/libtmux-dotnet/blob/6656a563ec9e07ab52e0c3ac96f7704fc94cc0c0/src/LibTmux.Mcp/McpServerComposition.cs).

## Protocol API

The [tool reference](../tools/) uses the registered `tmux_` names.
Typed results are serialized as structured content with bounded text.

Fixed resources include `tmux://hierarchy`, `tmux://sessions`,
`tmux://self`, and `tmux://servers`. Templates address session panes
and pane content. Prompts include `tmux_run_and_report`,
`tmux_diagnose_pane`, `tmux_build_workspace`, and
`tmux_interrupt_pane`.

[Protocol behavior](https://github.com/libtmux/libtmux-dotnet/blob/6656a563ec9e07ab52e0c3ac96f7704fc94cc0c0/docs/mcp/README.md).
For a published configuration library, use
[Workspace builder API](../../workspace/internals/api/).
