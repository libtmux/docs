---
title: Swift MCP API
description: Find Swift embedding types, typed tool authority, and the separate protocol catalog.
port: swift
product: mcp
sidebar:
  label: Language API
  order: 4
---

For MCP client requests, use the [tool reference](../tools/). This page
covers language APIs for embedding or extending the server.

[`LibTmuxMCP`](https://github.com/libtmux/libtmux-swift/blob/254f8b2be7eb60cacc3ffcb3ea8e456784f582df/Package.swift)
is a SwiftPM library product.
`libtmux-mcp` wraps it in a stdio executable. Public Swift types and
MCP wire operations have separate names and responsibilities.

## Swift embedding API

`TmuxTools(server:)` constructs a readonly tool surface: its authority
defaults to the `inspect` toolset alone. `ToolAuthority` selects
`Toolset` values — `inspect`, `manage`, `execute`, `teardown` — and may
name individual tools to include or exclude. `visibleDefinitions`
reports the selection; `call(ToolCall)` invokes an operation and returns
structured data or throws `ToolError`.

`MCPRequestHandler` and `MCPService` provide protocol composition.
`ServerConfiguration` parses the executable's environment and builds
its libtmux endpoint.

[Embedding contract](https://github.com/libtmux/libtmux-swift/blob/254f8b2be7eb60cacc3ffcb3ea8e456784f582df/Sources/LibTmuxMCP/README.md)
and [configuration source](https://github.com/libtmux/libtmux-swift/blob/254f8b2be7eb60cacc3ffcb3ea8e456784f582df/Sources/LibTmuxMCP/Configuration.swift).

## MCP contract

The [tool reference](../tools/) describes the wire catalog and schemas.
Follow-up calls use opaque references returned by hierarchy discovery.

The static `tmux://capabilities` resource reports the startup-frozen
surface. Live state comes from inspect tools. The current surface has no
workflow prompts or dynamic resource templates.

The [Workspace builder API](../../workspace/reference/) owns workspace decoding
and construction; those operations are separate from the MCP catalog.
