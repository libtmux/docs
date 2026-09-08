---
title: Connect a TypeScript MCP client
description: Launch @libtmux/mcp on a named socket and select the tools the client receives.
port: ts
product: mcp
sidebar:
  label: Guides
  order: 2
---

Launch `@libtmux/mcp` from a client with a dedicated socket name and an
explicit toolset selection. Ensure the client can locate Node or Bun and
tmux in its own environment.

## Start the stdio server

With Node 22 or newer:

```console
$ LIBTMUX_SOCKET=docs-agent LIBTMUX_TOOLSETS=inspect \
    npx -y @libtmux/mcp@latest
```

The process waits for MCP requests on stdin. Its diagnostics go to stderr.

For clients using the `mcpServers` format:

```json
{
  "mcpServers": {
    "tmux-typescript": {
      "command": "npx",
      "args": ["-y", "@libtmux/mcp@latest"],
      "env": {
        "LIBTMUX_SOCKET": "docs-agent",
        "LIBTMUX_TOOLSETS": "inspect"
      }
    }
  }
}
```

## Verify and expand the surface

After connecting, read `tmux://capabilities` and call `list_sessions`.
The resource reports the frozen tool selection and connection provenance.

To permit authored commands, choose `inspect,execute`. Add `manage`
for topology changes classified in that set. Read each tool's classification
instead of assuming that creating a pane has no process effects.

For an exact selection, set `LIBTMUX_TOOLSETS` to the empty string and
`LIBTMUX_TOOLS` to `list_sessions,capture_pane`. Restart after changing
the environment.

## Choose another endpoint

`LIBTMUX_SOCKET_PATH` selects an absolute socket path and is mutually
exclusive with `LIBTMUX_SOCKET`. `LIBTMUX_TMUX_BIN` selects the
executable. `LIBTMUX_TMUX_CONFIG` supplies a nonempty absolute configuration
path when starting a daemon; connecting to an existing daemon cannot
replace its startup configuration.

[Launch and configuration source](https://github.com/libtmux/libtmux-ts/blob/f85b8de551353f746d50eaf36bf0112f4fe5a528/packages/mcp/README.md).
