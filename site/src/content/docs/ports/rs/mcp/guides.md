---
title: Connect a Rust MCP client
description: Install tmux-mcp, select a socket explicitly, and verify the chosen tool selection.
port: rs
product: mcp
sidebar:
  label: Guides
  order: 2
---

Install the `tmux-mcp` executable, then let your MCP client launch it.
Rust 1.88 or newer is required to build the crate, and tmux 3.2a or newer
must be on the runtime path.

## Install and connect

Cargo requires an explicit prerelease version:

```console
$ cargo install \
    --version 0.1.0-alpha.13 \
    tmux-mcp
```

Use a named socket and an inspection toolset:

```console
$ LIBTMUX_TOOLSETS=inspect tmux-mcp \
    --socket-name docs-agent
```

The executable waits for MCP requests. A client using `mcpServers` can
launch the same command:

```json
{
  "mcpServers": {
    "tmux-rust": {
      "command": "tmux-mcp",
      "args": ["--socket-name", "docs-agent"],
      "env": {"LIBTMUX_TOOLSETS": "inspect"}
    }
  }
}
```

Without a selector, it uses the dedicated `libtmux-mcp` socket with a
minimal configuration. `--socket` selects an explicit socket path.

## Verify the selection

Ask the client to list tools and read `tmux://capabilities`. The `inspect`
toolset includes discovery, capture, and bounded observation. Add `execute`
for command execution and `teardown` for removal. Client approval uses
MCP annotations; the retired safety and confirmation flags fail startup.

## Diagnose failures

Read stderr for launcher diagnostics; stdout carries MCP. Use
`tmux-mcp --help` for supported arguments. If a target disappeared,
re-list it. Inspect partial effects before submitting another change.

[Executable contract](https://github.com/libtmux/libtmux-rs/blob/f0e37052c232636b61d095817046e6bfc8f2ca40/crates/tmux-mcp/README.md).
