---
title: Connect a C++ MCP client
description: Build the optional native executable and launch it against an explicit POSIX tmux socket.
port: cxx
product: mcp
sidebar:
  label: Guides
  order: 2
---

Build the optional MCP executable from the C++ repository, then configure
the client to launch it. This guide targets POSIX tmux. Native Windows
has separate prerequisites and a reduced catalog described in
[Topics](../topics/).

## Build the executable

Use a toolchain supported by the repository's C++23 or C++20 build.
Enable the server and its JSON dependency:

```console
$ cmake \
    -S . \
    -B build/mcp \
    -DLIBTMUX_BUILD_MCP_SERVER=ON \
    -DLIBTMUX_FETCH_DEPS=ON \
    -DLIBTMUX_BUILD_TESTS=OFF \
    -DLIBTMUX_BUILD_EXAMPLES=OFF
```

Build it:

```console
$ cmake --build build/mcp
```

Install into the user's local prefix:

```console
$ cmake --install build/mcp \
    --prefix ~/.local
```

## Select the endpoint

Make the installed binary directory available to the MCP client.
For clients using `mcpServers`:

```json
{
  "mcpServers": {
    "tmux-cpp": {
      "command": "libtmux-mcp-server",
      "args": ["--socket-name", "docs-agent"]
    }
  }
}
```

Use `--socket-path` for an explicit POSIX socket path. Without a selector,
the executable requires an inherited `TMUX` route and refuses startup
if it cannot determine one.

## Verify the catalog

Have the client list tools, then call `inspect_tmux`. Retain the returned
session, window, and pane identities for later calls.

The server advertises only tools. A client should not expect resources
or prompts, and there is no safety-tier flag to narrow the POSIX catalog.

[Build instructions](https://github.com/libtmux/libtmux-cxx/blob/c7f1146d2ebd7a8323d9f9814517dc3cdf86b4ee/apps/mcp/README.md)
and [selector implementation](https://github.com/libtmux/libtmux-cxx/blob/c7f1146d2ebd7a8323d9f9814517dc3cdf86b4ee/apps/mcp/src/cli.cpp).
