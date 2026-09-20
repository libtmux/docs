---
title: Rust MCP API
description: Find TmuxTools, tool selections, schema-bearing registrations, and MCP resources.
port: rs
product: mcp
sidebar:
  label: Language API
  order: 4
---

For MCP client requests, use the [tool reference](../tools/). This page
covers language APIs for embedding or extending the server.

The `tmux_mcp` crate exports the tool surface for applications that need
a custom policy or transport. Its executable supplies the stdio launcher.

## Rust types

`TmuxTools::builder(server)` constructs a tool surface over a libtmux
`Server`. Pass a `Selection` through `.selection()`, then build it. `offered()` reports
the definitions available under that selection.

The resulting type integrates with rmcp's server machinery; the
[embedding example](../examples/) uses
[`ServiceExt`](https://docs.rs/rmcp/3.1.2/rmcp/service/trait.ServiceExt.html)
and a stdio transport.
The [crate API](https://docs.rs/tmux-mcp) documents the Rust exports.

## Protocol contract

The [tool reference](../tools/) describes MCP names and schemas. Registered
tools provide structured results and output schemas. Errors distinguish
stale objects, retryable failures, and partial effects.

The static `tmux://capabilities` resource reports the startup-frozen
surface. Inspect tools read live tmux state. The current surface has no
workflow prompts or dynamic resource templates.

[Workspace builder API](../../workspace/reference/) describes the separate
workspace parser, builder, and live-session export.

[Crate source and examples](https://github.com/libtmux/libtmux-rs/tree/f0e37052c232636b61d095817046e6bfc8f2ca40/crates/tmux-mcp).
