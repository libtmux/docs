---
title: Go MCP guides
description: Install the executable, select a tmux endpoint, and diagnose an MCP client's connection.
port: go
product: mcp
sidebar:
  label: Overview
  group: Guides
  order: 2
cards:
  - label: Connect a client
    href: connect-client/
    body: Install the pinned executable and configure its socket and tools.
---

Let your MCP client start `libtmux-mcp` as a subprocess. The
[connection guide](connect-client/) covers installation, a dedicated server,
and selecting an existing socket.

## Install the command

Build the executable with Go 1.26 or newer and run it with tmux 3.2a or newer.
Follow the [installation steps](connect-client/#install-the-command), or use
the [complete client example](../examples/inspect-sessions/) to install into
an isolated project directory.

## Inspect the selection

The launcher's `-tools` report checks whether the selected tmux server is
answering, without starting it. Use the client's socket and environment when
[checking the configuration](connect-client/#inspect-the-selection).

## Connect a client

Configure one socket and the [tools you need](../topics/tool-selection/) in
the client's startup environment. Keep stdout available for MCP messages;
read startup errors in the client's stderr log. Use the
[startup checks](connect-client/#diagnose-startup) when a connection fails.
