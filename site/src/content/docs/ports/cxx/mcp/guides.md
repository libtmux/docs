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
has separate psmux prerequisites and command-dependent support.

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
the executable uses the dedicated `libtmux-mcp` socket and minimal
configuration. Use `--socket inherit` to select an inherited `TMUX` route.

## Verify the catalog

Have the client list tools, then call `list_sessions`. Retain the returned
session, window, and pane identities for later calls.

Use `LIBTMUX_TOOLSETS=inspect` for discovery and reads. Read
`tmux://capabilities` to inspect the startup selection; see [Topics](../topics/)
for exact tool inclusions and exclusions.

[Build instructions](https://github.com/libtmux/libtmux-cxx/blob/393d4b0ad666f18a6581f1eb281741a75a7503f0/apps/mcp/README.md)
and [selector implementation](https://github.com/libtmux/libtmux-cxx/blob/393d4b0ad666f18a6581f1eb281741a75a7503f0/apps/mcp/src/cli.cpp).
