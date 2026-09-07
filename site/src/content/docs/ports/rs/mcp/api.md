---
title: Rust MCP API
description: Find TmuxTools, surface tiers, schema-bearing registrations, and MCP resources.
port: rs
product: mcp
sidebar:
  label: API
  order: 4
---

The `tmux_mcp` crate exports the tool surface for applications that need
a custom policy or transport. Its executable supplies the stdio launcher.

## Rust types

`TmuxTools::builder(server)` constructs a tool surface over a libtmux
`Server`. Select a `Safety` value, then build it. `offered()` reports
the definitions available under that selection.

The resulting type integrates with rmcp's server machinery; the
[embedding example](../examples/) uses `ServiceExt` and a stdio transport.
The [crate API](https://docs.rs/tmux-mcp) documents the Rust exports.

## Protocol contract

The [tool reference](../tools/) describes MCP names and schemas. Registered
tools provide structured results and output schemas. Errors distinguish
stale objects, retryable failures, and partial effects.

The hierarchy resource tree includes `tmux://server`,
`tmux://sessions`, `tmux://windows`, `tmux://panes`, and templates
for individual objects and pane content. Prompts depend on the selected
tier.

MCP `run_plan` uses the core operation-plan model.
[Workspace Manager API](../../workspace/api/) describes the separate
workspace parser, builder, and live-session export.

[Crate source and examples](https://github.com/libtmux/libtmux-rs/tree/9331cdf556ea7a1f2589e9c3e6cece6ccdc7765c/crates/tmux-mcp).
