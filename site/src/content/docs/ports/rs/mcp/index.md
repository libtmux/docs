---
title: tmux MCP for Rust
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
- [Guides](./guides/) connect a client and choose its tmux socket.
- [Topics](./topics/) explain toolsets, command waits, and capability discovery.
- [Examples](./examples/) run a Rust MCP client with a private tmux server.
- [Language API](./reference/) documents embedding and implementation types.

The Rust [Workspace Manager](../workspace/) is a separate crate. The current MCP catalog does not
include a workspace-file operation.

[Crate documentation and prerequisites](https://github.com/libtmux/libtmux-rs/blob/a6fc2a65674177b92b17fa380757155d2ba150fd/crates/tmux-mcp/README.md).
