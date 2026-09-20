---
title: MCP for C++
description: Build the native C++ MCP executable and use its platform-specific tmux tool catalog.
port: cxx
product: mcp
sidebar:
  label: Overview
  order: 0
---

`libtmux-mcp-server` is a native executable that exposes tmux through
MCP over standard input and output. It is an optional consumer of the C++
library, enabled separately in the CMake build.

The catalog exposes discovery, creation, capture, input, search, and
bounded text waits. Native Windows advertises the same catalog, with
unsupported psmux operations failing explicitly at dispatch.

## Start here

- [Install](#install) points an MCP client at this server.
- [Tools](./tools/) lists the MCP operations, arguments, and results.
- [Guides](./guides/) build the executable and select an endpoint.
- [Topics](./topics/) explain platform coverage, identifiers, and failures.
- [Examples](./examples/) call a tool, then explore server internals.
- [Language API](./reference/) documents embedding and implementation types.

Toolsets and exact tool names select the startup surface. The static
`tmux://capabilities` resource reports it; workflow prompts and dynamic
resource templates are absent.

The [Workspace Manager](../workspace/) is another source consumer. Its
configuration types are not part of the installed core API, and the MCP
server does not include a workspace-file operation.

[Executable and platform contract](https://github.com/libtmux/libtmux-cxx/blob/393d4b0ad666f18a6581f1eb281741a75a7503f0/apps/mcp/README.md).
