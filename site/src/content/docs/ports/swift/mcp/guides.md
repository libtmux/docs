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
$ LIBTMUX_SOCKET=docs-agent LIBTMUX_TOOLSETS=inspect \
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
        "LIBTMUX_TOOLSETS": "inspect"
      }
    }
  }
}
```

`LIBTMUX_SOCKET_PATH` and `LIBTMUX_SOCKET` are mutually exclusive.
`LIBTMUX_TMUX_BIN` selects the tmux executable.

## Verify and narrow the surface

Ask the client to list sessions and read `tmux://capabilities`.
Retain opaque references from listings for follow-up calls.

To allow only listing and window creation, set `LIBTMUX_TOOLSETS` to
an empty string and `LIBTMUX_TOOLS=list_sessions,create_window`.
Reconnect after changing environment variables.

Invalid tool selections fail startup; inspect stderr diagnostics. A stale pane reference needs a fresh listing,
not another spelling of the same raw ID.

[Executable contract](https://github.com/libtmux/libtmux-swift/blob/254f8b2be7eb60cacc3ffcb3ea8e456784f582df/Sources/libtmux-mcp/README.md).
