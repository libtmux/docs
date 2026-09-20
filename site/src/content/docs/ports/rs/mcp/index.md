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
terminal capture, command execution, bounded waits, and a static capability
resource.

Building requires Rust 1.88 or newer. Running requires tmux 3.2a or newer.
Toolsets select inspection, management, execution, and teardown. Read
`tmux://capabilities` for the effective startup selection.

## Start here

- [Install](#install) points an MCP client at this server.
- [Tools](./tools/) lists the MCP operations, arguments, and results.
- [Guides](./guides/) install the executable and choose a socket.
- [Topics](./topics/) explain toolsets, command waits, and capability discovery.
- [Examples](./examples/) call a tool, then explore server internals.
- [Language API](./reference/) documents embedding and implementation types.

The Rust [Workspace Manager](../workspace/) is a separate crate. The current MCP catalog does not
include a workspace-file operation.

[Crate documentation and prerequisites](https://github.com/libtmux/libtmux-rs/blob/f0e37052c232636b61d095817046e6bfc8f2ca40/crates/tmux-mcp/README.md).
