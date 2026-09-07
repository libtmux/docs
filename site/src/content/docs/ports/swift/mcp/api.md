---
title: Swift MCP API
description: Find Swift embedding types, typed tool authority, and the separate protocol catalog.
port: swift
product: mcp
sidebar:
  label: API
  order: 4
---

`LibTmuxMCP` is a SwiftPM library product.
`libtmux-mcp` wraps it in a stdio executable. Public Swift types and
MCP wire operations have separate names and responsibilities.

## Swift embedding API

`TmuxTools(server:)` constructs a readonly tool surface.
`ToolAuthority` selects a `SafetyTier` and optionally an exact set
of `ToolOperation` values. `visibleDefinitions` reports the selection;
`call(ToolCall)` invokes an operation and returns structured data or
throws `ToolError`.

`MCPRequestHandler` and `MCPService` provide protocol composition.
`ServerConfiguration` parses the executable's environment and builds
its libtmux endpoint.

[Embedding contract](https://github.com/libtmux/libtmux-swift/blob/f02a4668570e1cc5198c941413750e021f42c214/Sources/LibTmuxMCP/README.md)
and [configuration source](https://github.com/libtmux/libtmux-swift/blob/f02a4668570e1cc5198c941413750e021f42c214/Sources/LibTmuxMCP/Configuration.swift).

## MCP contract

The [tool reference](../tools/) describes the wire catalog and schemas.
Follow-up calls use opaque references returned by hierarchy discovery.

Fixed resources include `tmux://snapshot`, `tmux://sessions`, and
`tmux://filters`. Templates address session windows and pane data.
Prompts include `run_and_wait`, `watch_until_ready`,
`build_workspace`, and `find_my_pane`.

[Resource source](https://github.com/libtmux/libtmux-swift/blob/f02a4668570e1cc5198c941413750e021f42c214/Sources/LibTmuxMCP/Resources.swift)
and [prompt source](https://github.com/libtmux/libtmux-swift/blob/f02a4668570e1cc5198c941413750e021f42c214/Sources/LibTmuxMCP/Prompts.swift).

The [Workspace Manager API](../../workspace/api/) owns workspace decoding
and construction. `apply_workspace` exposes that behavior over MCP.
