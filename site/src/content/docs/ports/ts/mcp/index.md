---
title: MCP for TypeScript
description: Run or embed @libtmux/mcp to inspect tmux, drive panes, and wait for commands.
port: ts
product: mcp
sidebar:
  label: Overview
  order: 0
---

`@libtmux/mcp` exposes tmux through an MCP stdio server and an embeddable
TypeScript factory. Clients can inspect topology, capture output, run framed
shell commands, and create or arrange panes.

The package requires Node 22 or newer, or Bun 1.3.14 or newer, plus tmux
3.2a or newer. Real tmux operation is supported on Linux; the package's
macOS artifact checks do not establish runtime support.

## Start here

- [Tools](./tools/) lists the MCP operations, arguments, and results.
- [Guides](./guides/) install and connect a client.
- [Topics](./topics/) explain toolsets, socket provenance, and waiting.
- [Examples](./examples/) call a tool, then explore server internals.
- [Language API](./api/) documents embedding and implementation types.

The server exposes a static `tmux://capabilities` resource. It does not
register workflow prompts or dynamic hierarchy resources.

Use [Workspace Manager](../workspace/) to load and apply declarative
configurations in application code. MCP clients create topology through
individual tools; there is no workspace-file tool.

[Package and runtime contract](https://github.com/libtmux/libtmux-ts/blob/f85b8de551353f746d50eaf36bf0112f4fe5a528/packages/mcp/README.md).
