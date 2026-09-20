---
title: .NET MCP examples
description: List sessions through the .NET MCP server and inspect implementation examples.
port: dotnet
product: mcp
sidebar:
  label: Examples
  order: 3
---

Connect the server using the [setup guide](../guides/), then call
[`list_sessions`](../tools/list_sessions/) from your MCP client.

## List sessions

This is the `params` object for an MCP `tools/call` request. Send it
through the connected client:

```json
{
  "name": "list_sessions",
  "arguments": {}
}
```

Use the returned session IDs when choosing a window or pane. The
[tool reference](../tools/list_sessions/) describes this port's result
and optional arguments.

## Run a command

Call `run_shell_command` with a pane ID returned by discovery. This is the
`params` object for `tools/call`:

```json
{
  "name": "run_shell_command",
  "arguments": {
    "paneId": "%3",
    "command": "test -f /etc/hostname && echo present",
    "timeoutSeconds": 20
  }
}
```

Read `exitStatus`, `timedOut`, and `output`. A timed-out command may still
be running; inspect the pane with `capture_since` before deciding to
submit more input. The current catalog has no detached job handles.

The [protocol example](https://github.com/libtmux/libtmux-dotnet/blob/320dc64f4b8b7815842471327a5e6b84a1499bf8/docs/mcp/README.md)
describes this workflow. Use the [language API](../reference/) for source
embedding.
