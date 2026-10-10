---
title: tmux MCP for C#
description: Run LibTmux.Mcp as a .NET tool with bounded results and a selectable tool catalog.
port: csharp
product: mcp
sidebar:
  label: Overview
  order: 0
cards:
  - label: Tools
    href: ./tools/
    body: Every MCP operation, with its arguments and results.
  - label: Guides
    href: ./guides/
    body: Install the tool, choose a socket, and verify the client's connection.
  - label: Topics
    href: ./topics/
    body: Tool selection, command waits, capture limits, and cancellation.
  - label: Examples
    href: ./examples/
    body: Complete clients for session inspection and bounded command execution.
  - label: Language API
    href: ./reference/
    body: Embedding and implementation types.
---

`LibTmux.Mcp` is a .NET tool package whose executable is
`libtmux-mcp`. It serves tmux tools and a static capability resource over standard
input and output.

The tool targets .NET 8 and .NET 10 and requires a POSIX host with tmux.
Its registered operations include `capture_pane`, `run_shell_command`,
and `capture_since`.

## Toolsets

Use `LIBTMUX_TOOLSETS=inspect` for discovery and terminal reads.
Additional toolsets enable changes, execution, and teardown. The
[tool-selection topic](topics/tool-selection/) explains exact-name filters,
defaults, and the capability resource. The [complete examples](examples/)
include project files and cleanup for their owned tmux servers.

[Workspace Manager](../workspace/) is the separately packaged
`LibTmux.Workspace` library. The MCP catalog does not include a workspace-file operation.

[Package contract](https://github.com/libtmux/libtmux-dotnet/blob/ec8b6ab2a4f65e23664f43fba538ba200d4ae8bc/src/LibTmux.Mcp/README.md).
