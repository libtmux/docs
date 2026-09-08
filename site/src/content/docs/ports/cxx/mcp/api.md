---
title: C++ MCP API
description: Distinguish installed protocol tools from the C++ source consumer's tool-model API.
port: cxx
product: mcp
sidebar:
  label: API
  order: 4
---

The installed product is `libtmux-mcp-server`. Its public MCP operations
are available through the protocol. The C++ tool model lives in a source
consumer and is not exported by the installed core package.

## Consumer API

`libtmux::mcp::default_tools()` returns a `ToolSet`.
`tools()` enumerates definitions, `find()` looks up a name, and
`call()` invokes a handler against a `Server` with named arguments
and an optional `CallContext`.

`ToolResult` is an expected value containing structured output or a
`ToolError`. `CallContext` provides cooperative cancellation and
progress callbacks. `Tool` describes parameters, output shape, and
effect annotations independently of a JSON library.

[Consumer declarations](https://github.com/libtmux/libtmux-cxx/blob/c7f1146d2ebd7a8323d9f9814517dc3cdf86b4ee/apps/mcp/include/libtmux_consumers/mcp.hpp)
and [build target](https://github.com/libtmux/libtmux-cxx/blob/c7f1146d2ebd7a8323d9f9814517dc3cdf86b4ee/apps/mcp/CMakeLists.txt).

## Protocol API

The [tool reference](../tools/) covers registered names and schemas.
The catalog is fixed for the platform and unpaginated. It advertises no
resources, prompts, or list-change notifications.

Successful tool calls return matching structured content and serialized
JSON text. Strict argument validation precedes tmux execution.
[Protocol tests](https://github.com/libtmux/libtmux-cxx/blob/c7f1146d2ebd7a8323d9f9814517dc3cdf86b4ee/apps/mcp/tests/protocol_test.cpp)
cover supported lifecycle revisions and result shapes.

[Workspace Manager API](../../workspace/api/) documents a separate source
consumer; it is not a workspace operation in this MCP catalog.
