---
title: Ruby MCP topics
description: Understand tool policy, retained observations, resources, and authored runs.
port: ruby
product: mcp
sidebar:
  label: Topics
  order: 1
---

## Tool policy

`tmux_capabilities` and `tmux_snapshot` are enabled by default. Capture, wait,
create, send, close, and run tools remain absent until the process receives a
matching `--enable-tool` option. Direct application calls enforce the same
policy as protocol discovery.

## Captures and resources

Snapshots and screen captures retain immutable observations. A cursor pages
that retained state; it does not silently substitute a newer live listing.
Resource templates expose metadata pages and pane screens using encoded
endpoint and generation identities. The server advertises neither resource
subscriptions nor resource-list change notifications, and it has no prompt
catalog.

## Authored runs

`tmux_run` needs both `--enable-tool tmux_run` and an exact
`--enroll-pane %ID=FILE` entry. The operator must source the generated file in
that pane's interactive zsh 5.9. Enrollment does not type into the terminal,
and a later pane respawn cannot redirect an authorized request to the
replacement process.

The tool reports stdout and stderr independently. Nonzero exits and signals
are completion results; overflow is an error, not truncated success.

[Source-owned policy and enrollment guide](../source-guide/)
