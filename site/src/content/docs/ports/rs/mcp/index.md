---
title: MCP for Rust
description: Run tmux-mcp or embed its typed tool surface in a Rust application.
port: rs
product: mcp
sidebar:
  label: Overview
  order: 0
---

`tmux-mcp` serves tmux over MCP stdio. It provides topology discovery,
terminal capture, command execution, bounded waits, background jobs,
resources, and workflow prompts.

Building requires Rust 1.88 or newer. Running requires tmux 3.2a or newer.
The default `mutating` surface omits dedicated kill tools; it still
includes shell commands and terminal input.

## Start here

- [Tools](./tools/) lists the MCP operations, arguments, and results.
- [Guides](./guides/) install the executable and choose a socket.
- [Topics](./topics/) explain tiers, live-stream effects, and job lifetimes.
- [Examples](./examples/) call a tool, then explore server internals.
- [Language API](./api/) documents embedding and implementation types.

The Rust [Workspace Manager](../workspace/) is a separate crate. MCP's
`run_plan` executes typed operations; it is not the workspace crate's
YAML loader.

[Crate documentation and prerequisites](https://github.com/libtmux/libtmux-rs/blob/9331cdf556ea7a1f2589e9c3e6cece6ccdc7765c/crates/tmux-mcp/README.md).
