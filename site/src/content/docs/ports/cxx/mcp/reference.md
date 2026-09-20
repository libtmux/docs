---
title: C++ MCP API
description: Distinguish installed protocol tools from the C++ source consumer's tool-model API.
port: cxx
product: mcp
sidebar:
  label: Language API
  order: 4
---

For MCP client requests, use the [tool reference](../tools/). This page
covers language APIs for embedding or extending the server.

The installed product is `libtmux-mcp-server`. Its public MCP operations
are available through the protocol. The C++ tool model lives in a source
consumer and is not exported by the installed core package.

## Consumer API

`libtmux::mcp::default_tools()` returns an expected value containing a `ToolRegistry` or an error.
`tools()` enumerates definitions, `find()` looks up a name, and
`call()` invokes a handler against a `Server` with named arguments
and an optional `CallContext`.

`ToolResult` is an expected value containing structured output or a
`ToolError`. `CallContext` provides cooperative cancellation and
progress callbacks. `ToolDefinition` describes parameters, output shape, and
effect annotations independently of a JSON library.

[Consumer declarations](https://github.com/libtmux/libtmux-cxx/blob/393d4b0ad666f18a6581f1eb281741a75a7503f0/apps/mcp/include/libtmux_consumers/mcp.hpp)
and [build target](https://github.com/libtmux/libtmux-cxx/blob/393d4b0ad666f18a6581f1eb281741a75a7503f0/apps/mcp/CMakeLists.txt).

## Protocol API

The [tool reference](../tools/) covers registered names and schemas.
Toolsets and exact names filter the catalog at startup. The static
`tmux://capabilities` resource reports that selection. The server has no
workflow prompts or dynamic resource templates.

Successful tool calls return matching structured content and serialized
JSON text. Strict argument validation precedes tmux execution.
[Protocol tests](https://github.com/libtmux/libtmux-cxx/blob/393d4b0ad666f18a6581f1eb281741a75a7503f0/apps/mcp/tests/protocol_test.cpp)
cover supported lifecycle revisions and result shapes.

[Workspace builder API](../../workspace/reference/) documents a separate source
consumer; it is not a workspace operation in this MCP catalog.
