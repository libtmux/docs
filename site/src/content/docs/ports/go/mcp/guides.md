---
title: Connect a Go MCP client
description: Install libtmux-mcp, inspect its effective tool selection, and diagnose a selected socket.
port: go
product: mcp
sidebar:
  label: Guides
  order: 2
---

Install the Go MCP command and verify its effective configuration before
connecting a client. Go 1.26 or newer is required to build it.

## Install the command

```console
$ go install github.com/libtmux/libtmux-go/mcp/cmd/libtmux-mcp@latest
```

Make Go's binary installation directory available to the MCP client's
`PATH`. The server also needs tmux 3.2a or newer.

## Inspect the selection

This reports the effective tool list without resolving or contacting tmux:

```console
$ LIBTMUX_MCP_CAPABILITIES=inspect libtmux-mcp -tools
```

Diagnose the endpoint separately:

```console
$ libtmux-mcp \
    -doctor \
    -socket-name docs-agent
```

The report includes the tmux version, endpoint, topology, and caller
context. A daemon that has not started yet is not a configuration error.

## Connect a client

For a client using `mcpServers`:

```json
{
  "mcpServers": {
    "tmux-go": {
      "command": "libtmux-mcp",
      "args": ["-socket-name", "docs-agent"],
      "env": {
        "LIBTMUX_MCP_CAPABILITIES": "inspect",
        "LIBTMUX_SAFETY": "readonly"
      }
    }
  }
}
```

Choose `operate` and `mutating` when the client needs to create a
workspace or run commands. Reconnect after changing startup configuration.

`-socket-path` takes precedence over a socket name.
`-binary` selects the tmux executable. A client's curated environment
may have a different `PATH` or locale from your shell; compare the
doctor report with the tmux binary that started your sessions.

[Launcher reference](https://github.com/libtmux/libtmux-go/blob/5f808882015a975a65acc7f9da5b3ff0d5cbdc91/mcp/cmd/libtmux-mcp/README.md).
