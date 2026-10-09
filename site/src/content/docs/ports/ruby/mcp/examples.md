---
title: Ruby MCP examples
description: Run complete Ruby programs for an MCP client or an embedded application.
port: ruby
product: mcp
sidebar:
  label: Overview
  group: Examples
  order: 3
cards:
  - label: Page session metadata
    href: page-session-metadata/
    body: Embed the MCP application, page two session names from one capture, and close owned resources.
  - label: Launch a client server
    href: ../guides/connect-client/
    body: Run a stdio MCP server with a private tmux daemon and a generated client configuration.
---

Both examples include their complete program, pinned dependencies, run
commands, expected results, and cleanup. Each creates its own tmux daemon.

## Default read-only catalog

The [client guide](../guides/connect-client/#configure-a-client) generates an
MCP configuration using the launcher's absolute path and the current Ruby
executable. Its default catalog contains `tmux_capabilities` and
`tmux_snapshot`. Listing the tools and querying the example session verifies
the connection.

The [embedded example](page-session-metadata/) calls those tools from Ruby
inside an Async scope. It creates two sessions and prints their names by
following a snapshot cursor.

## Add bounded observation

For capture or waits in the client launcher, add
`"--enable-tool", "tmux_capture"` or `"--enable-tool", "tmux_wait"` to the
array passed to `LibTmux::MCP::CLI.run` in `run-mcp.rb`. Adding them to the
generated client configuration's arguments has no effect: the launcher does
not forward those arguments. Enable creation, input, close, or authored
execution only when the client needs those effects.
The [guides overview](../guides/#enable-observation) explains the tool choices;
the [source-owned guide](../source-guide/) gives their lifecycle contracts.
