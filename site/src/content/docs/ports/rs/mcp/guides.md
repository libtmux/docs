---
title: Rust MCP guides
description: Install tmux-mcp, choose a socket, and check the client's tool selection.
port: rs
product: mcp
sidebar:
  label: Overview
  group: Guides
  order: 1
cards:
  - label: Connect a client
    href: connect-client/
    body: Install the pinned executable, configure the client, and check discovery and socket ownership.
---

The [connection guide](connect-client/) includes installation, client
configuration, and checks for the selected tmux server. It uses the same
source revision as the MCP reference.

## Install and connect

Let the MCP client launch `tmux-mcp` and communicate over stdin and stdout.
Choose the tool selection in the client configuration. For an existing tmux
server, select its socket explicitly.

The [installation steps](connect-client/#install-and-connect) use the tested
Rust toolchain and Git revision. The [socket settings](connect-client/#connect-to-an-existing-server)
distinguish an existing server from the launcher's default dedicated daemon.

## Verify the selection

Ask the client to list tools and read `tmux://capabilities`. Its tool list and
socket report describe this connection. The [tool-selection topic](../topics/tool-selection/)
explains how groups, exact names, and exclusions combine.

## Diagnose failures

Read the client's server log for stderr. The
[startup checks](connect-client/#diagnose-startup-failures) cover invalid
selection, conflicting socket settings, and executable lookup. Reconnect after
changing the environment; the server chooses these settings once at startup.
