---
title: C++ MCP examples
description: List sessions through the C++ MCP server and inspect implementation examples.
port: cxx
product: mcp
sidebar:
  label: Examples
  order: 3
---

Connect the server using the [setup guide](../guides/), then call
[`list_sessions`](../tools/list_sessions/) from your MCP client.

## List sessions

This is the `params` object for an MCP `tools/call` request. Send it
through the connected client:

```json
{
  "name": "list_sessions",
  "arguments": {}
}
```

Use the returned session IDs when choosing a window or pane. The
[tool reference](../tools/list_sessions/) describes this port's result
and optional arguments.

## Internals

The following examples are for applications that embed or extend the server.
Installing and connecting an MCP client does not require this code.

The MCP consumer separates its tool model from JSON-RPC encoding.
Source applications can inspect that model without starting a tmux
server.

### Inspect the consumer catalog

This program uses the declarations in the
[consumer header](https://github.com/libtmux/libtmux-cxx/blob/393d4b0ad666f18a6581f1eb281741a75a7503f0/apps/mcp/include/libtmux_consumers/mcp.hpp):

```cpp
#include <iostream>

#include "libtmux_consumers/mcp.hpp"

int main() {
  const auto catalog = libtmux::mcp::default_tools();
  if (!catalog) {
    std::cerr << catalog.error() << '\n';
    return 1;
  }
  for (const auto& tool : catalog->tools()) {
    std::cout << tool.name << '\n';
  }
}
```

Build this within an application that includes the repository's
`mcp_tools` CMake target. The header and target belong to the source
consumer; the installed core package does not export them.

The [consumer tests](https://github.com/libtmux/libtmux-cxx/blob/393d4b0ad666f18a6581f1eb281741a75a7503f0/apps/mcp/tests/mcp_test.cpp)
exercise the same catalog and direct calls. This small listing program
is a source-derived example, not one of those collected tests.

### Drive the executable

After connecting an MCP client using the [guide](../guides/), start with
`list_sessions`, then `list_windows` and `list_panes`. Preserve returned
object identities for subsequent calls.

On POSIX, use `capture_pane` to inspect a discovered pane, then
`wait_for_text` for a bounded wait. Read its match/timeout result and
final capture before choosing another operation.

The [protocol tests](https://github.com/libtmux/libtmux-cxx/blob/393d4b0ad666f18a6581f1eb281741a75a7503f0/apps/mcp/tests/protocol_test.cpp)
cover client lifecycle, validation, concurrency, and cancellation.
Native Windows advertises the same catalog; unsupported psmux operations
fail explicitly when called.
