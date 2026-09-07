---
title: C++ MCP examples
description: Inspect the C++ consumer catalog and follow a discovery-first MCP workflow.
port: cxx
product: mcp
sidebar:
  label: Examples
  order: 3
---

The MCP consumer separates its tool model from JSON-RPC encoding.
Source applications can inspect that model without starting a tmux
server.

## Inspect the consumer catalog

This program uses the declarations in the
[consumer header](https://github.com/libtmux/libtmux-cxx/blob/c7f1146d2ebd7a8323d9f9814517dc3cdf86b4ee/apps/mcp/include/libtmux_consumers/mcp.hpp):

```cpp
#include <iostream>

#include "libtmux_consumers/mcp.hpp"

int main() {
  const auto catalog = libtmux::mcp::default_tools();
  for (const auto& tool : catalog.tools()) {
    std::cout << tool.name << '\n';
  }
}
```

Build this within an application that includes the repository's
`mcp_tools` CMake target. The header and target belong to the source
consumer; the installed core package does not export them.

The [consumer tests](https://github.com/libtmux/libtmux-cxx/blob/c7f1146d2ebd7a8323d9f9814517dc3cdf86b4ee/apps/mcp/tests/mcp_test.cpp)
exercise the same catalog and direct calls. This small listing program
is a source-derived example, not one of those collected tests.

## Drive the executable

After connecting an MCP client using the [guide](../guides/), start with
`inspect_tmux`. Select one returned session and call `list_windows`
or `list_session_panes` with its exact identity.

On POSIX, use `capture_pane` to inspect a discovered pane, then
`wait_for_text` for a bounded wait. Read its match/timeout result and
final capture before choosing another operation.

The [protocol tests](https://github.com/libtmux/libtmux-cxx/blob/c7f1146d2ebd7a8323d9f9814517dc3cdf86b4ee/apps/mcp/tests/protocol_test.cpp)
cover client lifecycle, validation, concurrency, and cancellation.
Native Windows supports only the discovery part of this workflow.
