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

POSIX builds expose discovery, creation, capture, input, search, and
bounded text waits. Native Windows provides a smaller psmux preview with
hierarchy discovery only.

## Start here

- [Guides](./guides/) build the executable and select an endpoint.
- [Topics](./topics/) explain platform coverage, identifiers, and failures.
- [Examples](./examples/) inspect the consumer tool model.
- [API](./api/) distinguishes consumer headers from protocol operations.

The server offers tools only. It does not offer resources, prompts,
subscriptions, or configurable toolsets.

The [Workspace Manager](../workspace/) is another source consumer. Its
configuration types are not part of the installed core API, and the MCP
server does not include a workspace-file operation.

[Executable and platform contract](https://github.com/libtmux/libtmux-cxx/blob/c7f1146d2ebd7a8323d9f9814517dc3cdf86b4ee/apps/mcp/README.md).
