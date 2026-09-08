---
title: Connect a Rust MCP client
description: Install tmux-mcp, select a socket explicitly, and verify the chosen surface tier.
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
    --version 0.1.0-alpha.10 \
    tmux-mcp
```

Use a named socket and an explicit tier:

```console
$ tmux-mcp \
    --socket-name docs-agent \
    --safety readonly
```

The executable waits for MCP requests. A client using `mcpServers` can
launch the same command:

```json
{
  "mcpServers": {
    "tmux-rust": {
      "command": "tmux-mcp",
      "args": ["--socket-name", "docs-agent", "--safety", "readonly"]
    }
  }
}
```

Without a selector, it follows the inherited `TMUX` socket when present,
otherwise the default socket. `--socket` selects an explicit socket path.

## Verify the selection

Ask the client to list tools and read `tmux://server`. A readonly
selection includes discovery and capture, but excludes the live-stream
tools that attach a client.

Use `--safety mutating` for command execution and streaming waits. If
dedicated removal is needed, select `destructive` and add `--confirm`
to require client confirmation. This does not gate destructive effects
hidden inside shell commands.

## Diagnose failures

Read stderr for launcher diagnostics; stdout carries MCP. Use
`tmux-mcp --help` for supported arguments. If a target disappeared,
re-list it. Do not repeat a partially applied plan without inspecting what
tmux already changed.

[Executable contract](https://github.com/libtmux/libtmux-rs/blob/9331cdf556ea7a1f2589e9c3e6cece6ccdc7765c/crates/tmux-mcp/README.md).
