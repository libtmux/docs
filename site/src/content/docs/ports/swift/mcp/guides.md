---
title: Connect a Swift MCP client
description: Build libtmux-mcp and select its tmux endpoint and tool authority through environment variables.
port: swift
product: mcp
sidebar:
  label: Guides
  order: 2
---

Build the Swift executable and have the MCP client launch it.
Use the package's supported Swift toolchain and make tmux available to
the client process.

## Build and launch

From the Swift repository:

```console
$ swift build --product libtmux-mcp
```

The debug executable is written under `.build/debug`.
Run an inspection surface on a named socket:

```console
$ LIBTMUX_SOCKET=docs-agent LIBTMUX_SAFETY=readonly \
    .build/debug/libtmux-mcp
```

It waits for MCP messages. The executable accepts no flags; configure
its endpoint through the environment.

## Connect a client

If the executable is on the client's `PATH`, use this
`mcpServers` entry. Otherwise set `command` to its actual built location.

```json
{
  "mcpServers": {
    "tmux-swift": {
      "command": "libtmux-mcp",
      "env": {
        "LIBTMUX_SOCKET": "docs-agent",
        "LIBTMUX_SAFETY": "readonly"
      }
    }
  }
}
```

`LIBTMUX_SOCKET_PATH` takes precedence over the socket name.
`LIBTMUX_TMUX_BIN` selects the tmux executable.

## Verify and narrow the surface

Ask the client to list sessions and read `tmux://filters`.
Retain opaque references from listings for follow-up calls.

To allow only listing and window creation, select mutating and set
`LIBTMUX_MCP_TOOLS=list_sessions,new_window`. The tier remains an upper
bound. Reconnect after changing environment variables.

Missing tools can be caused by a malformed exact selection; inspect
stderr diagnostics. A stale pane reference needs a fresh listing,
not another spelling of the same raw ID.

[Executable contract](https://github.com/libtmux/libtmux-swift/blob/f02a4668570e1cc5198c941413750e021f42c214/Sources/libtmux-mcp/README.md).
