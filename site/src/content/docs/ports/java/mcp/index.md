---
title: MCP for Java
description: Run or embed the Java MCP server with typed tmux tools and a static capability resource.
port: java
product: mcp
sidebar:
  label: Overview
  order: 0
---

[`io.github.libtmux:libtmux-mcp`](https://github.com/libtmux/libtmux-java/blob/4f057d367a25dee818d70876fa283fc503a3a7eb/libtmux-mcp/README.md)
provides a Java MCP server and a
`libtmux-mcp` application launcher. It discovers tmux objects, captures
terminal output, runs framed shell commands, and applies typed topology
operations.

Use JDK 21 or newer and tmux. The launcher selects its endpoint and
toolsets at startup. It serves MCP over stdin and stdout.

## Start here

- [Install](#install) points an MCP client at this server.
- [Tools](./tools/) lists the MCP operations, arguments, and results.
- [Guides](./guides/) build the launcher and connect a client.
- [Topics](./topics/) explain toolsets, input preflight, and wait semantics.
- [Examples](./examples/) call a tool, then explore server internals.
- [Language API](./api/) documents embedding and implementation types.

The only MCP resource is the static `tmux://capabilities` report.
The server does not register workflow prompts or dynamic resource
subscriptions.

The [Workspace Manager](../workspace/) is a separate Java module.
Application code can parse and build declarative workspaces; MCP clients
compose the exposed topology tools.

[Module documentation](https://github.com/libtmux/libtmux-java/blob/4f057d367a25dee818d70876fa283fc503a3a7eb/libtmux-mcp/README.md).
