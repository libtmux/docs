---
title: C# MCP guides
description: Install the MCP executable, choose its tmux server, and verify the client's connection.
port: csharp
product: mcp
sidebar:
  label: Overview
  group: Guides
  order: 2
cards:
  - label: Connect a client
    href: connect-client/
    body: Install the pinned tool, choose a socket, and check startup and shutdown.
---

Let the MCP client launch `libtmux-mcp` and exchange protocol messages over
stdin and stdout. The [connection guide](connect-client/) covers installation,
an existing tmux server, and the launcher's default dedicated server.

## Install the tool

`LibTmux.Mcp` is a framework-dependent .NET tool targeting .NET 8 and .NET 10.
Follow the [pinned installation steps](connect-client/#install-the-tool).
The [complete client example](../examples/inspect-sessions/) installs the
executable into its own directory and includes the client project files.

## Connect a client

Choose the socket and [tool selection](../topics/tool-selection/) in the
startup environment, then inspect `tmux://capabilities` and the offered tools.
Use `manage` for topology changes and `execute` for terminal input and command
execution. Reconnect after changing the configuration.

## Diagnose startup

The client's server log contains stderr diagnostics. The
[startup checks](connect-client/#diagnose-startup) cover executable lookup,
runtime installation, conflicting socket settings, and invalid tool names.
Keep stdout available for MCP messages.
