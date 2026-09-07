---
title: MCP for Python
description: Expose tmux tools, resources, and prompts through Python's libtmux-mcp server.
port: py
product: mcp
sidebar:
  label: Overview
  order: 0
---

`libtmux-mcp` lets an MCP client inspect tmux, create sessions and panes,
run commands, and wait for their results. The distribution and executable are
`libtmux-mcp`; Python imports use `libtmux_mcp`.

The server runs over standard input and output. It requires Python 3.10 or
newer and tmux 3.2a or newer. Its default toolsets are `inspect`, `manage`,
and `execute`; deletion tools require an explicit selection.

## Start here

- [Guides](./guides/) connect a client and select a tmux socket.
- [Topics](./topics/) explain toolsets, trust, waiting, and caller context.
- [Examples](./examples/) inspect the protocol catalog from Python.
- [API](./api/) separates Python entry points from MCP tool contracts.

For declarative session configuration, use the
[Workspace Manager](../workspace/), provided by the separate `tmuxp`
project. The MCP server does not provide a tmuxp file loader.

The [upstream Python documentation](https://libtmux-mcp.git-pull.com/)
covers client integrations and the complete tool reference.
These pages follow the [Python implementation](https://github.com/tmux-python/libtmux-mcp/tree/v0.1.0a22).
