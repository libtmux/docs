---
title: Rust MCP examples
description: Run a complete Rust client and inspect structured session metadata over MCP.
port: rs
product: mcp
sidebar:
  label: Overview
  group: Examples
  order: 3
cards:
  - label: List sessions through MCP
    href: inspect-sessions/
    body: Run an embedded client and server against a private tmux daemon, then close owned resources.
  - label: Connect an MCP client
    href: ../guides/connect-client/
    body: Install the executable and configure a client to launch it.
---

The [session example](inspect-sessions/) includes the complete Cargo project,
program, setup commands, and expected output. It creates its own tmux server.
The [connection guide](../guides/connect-client/) configures an existing MCP
client to launch the executable instead.

## List sessions

Send this `params` object through a connected client's MCP `tools/call` method:

```json
{
  "name": "list_sessions",
  "arguments": {}
}
```

Check whether the result reports a tool error before reading its structured
content. Use the returned IDs to choose a window or pane. The
[list_sessions reference](../tools/list_sessions/) describes the result.

## Internals

The complete example embeds both protocol endpoints in one Rust process.
They exchange JSON-RPC over an in-memory stream and perform normal tool
discovery. An installed MCP client is not needed to run it.

<span id="embed-a-read-only-surface"></span>

### Choose tools in Rust

The example supplies the `inspect` selection to the embedded server. It checks
that discovery contains the session-listing tool and excludes pane input.
The [selection topic](../topics/tool-selection/) describes other combinations.

<span id="run-the-source-example"></span>

### Run the program

Follow the [complete setup](inspect-sessions/#run-the-example) in a fresh
directory. The program prints both session names, closes the protocol
endpoints, stops its tmux daemon, and verifies that the socket has closed.
Operation and cleanup errors both produce a failing exit status.
