---
title: MCP for Ruby
description: Run the libtmux-mcp server with an explicit tmux endpoint and tool policy.
port: ruby
product: mcp
sidebar:
  label: Overview
  order: 0
---

`libtmux-mcp` exposes one existing tmux server over MCP standard input and
output. Requiring `libtmux/mcp` starts no server; the installed
`libtmux-mcp` executable owns the protocol transport and borrows the selected
tmux daemon.

The default catalog contains `tmux_capabilities` and `tmux_snapshot`.
Observation and mutation tools are opt-in, so a client cannot acquire them by
calling an undisclosed name.

## Start here

- [Install](#install) configures an MCP client to launch the Ruby server.
- [Tools](./tools/) records the actual wire schemas and per-tool policy.
- [Guides](./guides/) select an owned socket and enable optional tools.
- [Topics](./topics/) explains retained captures, waits, and shell enrollment.
- [Examples](./examples/) shows a complete client configuration.
- [Language API](./reference/) documents the Ruby embedding surface.

The server requires Ruby 3.3 or newer. Strong process tracking for waits and
authored runs requires tmux 3.3 or newer plus native process identity support.
The [source-owned MCP guide](./source-guide/) is staged from the same revision
as the generated reference.
