---
title: Ruby MCP examples
description: Configure a client for the default Ruby MCP catalog or opt-in observation tools.
port: ruby
product: mcp
sidebar:
  label: Examples
  order: 3
---

## Default read-only catalog

This client configuration selects a named tmux socket and exposes only
capability discovery and snapshots:

```json
{
  "mcpServers": {
    "tmux-ruby": {
      "command": "libtmux-mcp",
      "args": ["--socket-name", "libtmux-docs", "--endpoint", "local"]
    }
  }
}
```

Start the named tmux server separately before the client launches the MCP
process. Ask the client to list tools; the result should contain
`tmux_capabilities` and `tmux_snapshot`.

## Add bounded observation

Append `--enable-tool`, `tmux_capture`, `--enable-tool`, and `tmux_wait` to the
argument array. The discovered catalog then includes those two names. Do not
enable creation, input, close, or authored execution unless the client needs
those effects.

The [source-owned MCP guide](../source-guide/) links the executable protocol
example that drives the installed gem through pipes and an isolated server.
