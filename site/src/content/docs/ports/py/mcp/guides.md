---
title: Connect a Python MCP client
description: Launch libtmux-mcp on a chosen socket and verify the tools your client receives.
port: py
product: mcp
sidebar:
  label: Guides
  order: 2
---

Configure the client to launch `libtmux-mcp` with a named tmux socket.
Install [uv](https://docs.astral.sh/uv/) first, and make tmux 3.2a or newer
available in the environment the client passes to the server.

## Launch the server

This command resolves the package in its own uv environment and starts its
stdio transport. It waits for an MCP client to send requests.

```console
$ LIBTMUX_SOCKET=docs-agent LIBTMUX_TOOLSETS=inspect \
    uvx libtmux-mcp==0.1.0a22
```

For a client that accepts an `mcpServers` object, use:

```json
{
  "mcpServers": {
    "tmux-python": {
      "command": "uvx",
      "args": ["libtmux-mcp==0.1.0a22"],
      "env": {
        "LIBTMUX_SOCKET": "docs-agent",
        "LIBTMUX_TOOLSETS": "inspect"
      }
    }
  }
}
```

Client configuration formats differ; the
[upstream client guide](https://libtmux-mcp.git-pull.com/clients/) gives
their individual formats. Restart the MCP process after changing startup
environment variables.

## Verify the connection

Ask the client to list the tools, then call `list_sessions`. Ask it to
identify a pane before capturing content. An empty session listing can be
correct for the selected socket.

To allow commands and topology creation, change the toolset selection to
`inspect,manage,execute`. Check the new listing after reconnecting.
Removing `teardown` does not stop a shell command from deleting work.

## Diagnose a mismatch

Compare the client's executable path and environment with your shell.
`LIBTMUX_TMUX_BIN` selects the tmux executable.
`LIBTMUX_SOCKET_PATH` selects an explicit socket path. A targeted tool's
`socket_name` argument can override the default endpoint.

Keep this application in its own Python environment when also using
[tmuxp](../../workspace/); the projects have independent libtmux
dependency requirements.

[Configuration contract](https://github.com/tmux-python/libtmux-mcp/blob/v0.1.0a22/docs/configuration.md).
