---
title: .NET MCP API
description: Find the .NET server composition API and current MCP protocol catalog.
port: dotnet
product: mcp
sidebar:
  label: Language API
  order: 4
---

For MCP client requests, use the [tool reference](../tools/). This page
covers language APIs for embedding or extending the server.

`LibTmux.Mcp` is distributed as a .NET tool package. Installing its
executable does not provide a NuGet library reference for embedding.

## Source API

`McpServerComposition.Add` registers the server in a service collection
and returns the MCP builder for transport composition. It accepts the
connection options, caller pane ID, and a `ServerPolicy` containing wait
and output limits. The public overload selects tools without teardown.
Tool handlers are internal implementation details.

[Composition source](https://github.com/libtmux/libtmux-dotnet/blob/320dc64f4b8b7815842471327a5e6b84a1499bf8/src/LibTmux.Mcp/McpServerComposition.cs).

## Protocol API

The [tool reference](../tools/) uses names such as `capture_pane` and
`run_shell_command`. Results provide structured content and bounded text.
Read `tmux://capabilities` for the startup-frozen selection. The current
surface has no workflow prompts or dynamic resource templates.

For the separately published configuration library, see
[Workspace builder API](../../workspace/reference/).
