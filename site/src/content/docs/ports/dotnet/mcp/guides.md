---
title: Connect a .NET MCP client
description: Install the .NET tool, configure a socket and toolsets, and diagnose launcher environments.
port: dotnet
product: mcp
sidebar:
  label: Guides
  order: 2
---

Install `LibTmux.Mcp` as a tool and configure the MCP client to launch
`libtmux-mcp`. Use a POSIX host with tmux and a compatible .NET runtime.

## Install the tool

Include prereleases while the package is in alpha:

```console
$ dotnet tool install \
    --global \
    --prerelease \
    LibTmux.Mcp
```

The package is a framework-dependent executable targeting .NET 8 and
.NET 10. It is not installed with `dotnet add package` as an ordinary
library dependency.

## Connect a client

Choose the socket through the startup environment. This
`mcpServers` configuration starts an inspection surface:

```json
{
  "mcpServers": {
    "tmux-dotnet": {
      "command": "libtmux-mcp",
      "env": {
        "LIBTMUX_SOCKET": "docs-agent",
        "LIBTMUX_TOOLSETS": "inspect"
      }
    }
  }
}
```

Ask the client to list its tools and read `tmux://capabilities`.
Use `get_server_info` to inspect caller context before changing panes.

Add the `execute` toolset for command execution and topology creation.
Reconnect after changing the startup environment. Use the
[tool reference](../tools/) for the names served by this port.

## Diagnose startup

A client does not necessarily inherit your interactive shell's runtime
setup. If the launcher cannot locate .NET, supply the actual runtime
installation through `DOTNET_ROOT` in the server's client configuration.

`LIBTMUX_TMUX` selects the tmux executable.
`LIBTMUX_MCP_WAIT_MAX_SECONDS`, `LIBTMUX_MCP_MAX_LINES`, and
`LIBTMUX_MCP_MAX_BYTES` set response limits. Diagnostics belong on
stderr; stdout must contain only MCP messages.

[Installation and environment contract](https://github.com/libtmux/libtmux-dotnet/blob/320dc64f4b8b7815842471327a5e6b84a1499bf8/src/LibTmux.Mcp/README.md).
