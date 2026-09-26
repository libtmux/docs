---
title: MCP for .NET
description: Run LibTmux.Mcp as a .NET tool with bounded results and a selectable tool catalog.
port: dotnet
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
    body: Install the tool and choose a socket.
  - label: Topics
    href: ./topics/
    body: Toolsets, command waits, and capability discovery.
  - label: Examples
    href: ./examples/
    body: List sessions and run a bounded command.
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
Additional toolsets enable changes, execution, and teardown.

[Workspace Manager](../workspace/) is the separately packaged
`LibTmux.Workspace` library. The MCP catalog does not include a workspace-file operation.

[Package contract](https://github.com/libtmux/libtmux-dotnet/blob/320dc64f4b8b7815842471327a5e6b84a1499bf8/src/LibTmux.Mcp/README.md).
