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
[`tmux_list_sessions`](../tools/tmux_list_sessions/) from your MCP client.

## List sessions

This is the `params` object for an MCP `tools/call` request. Send it
through the connected client:

```json
{
  "name": "tmux_list_sessions",
  "arguments": {}
}
```

Use the returned session IDs when choosing a window or pane. The
[tool reference](../tools/tmux_list_sessions/) describes this port's result
and optional arguments.

## Internals

The following examples are for applications that embed or extend the server.
Installing and connecting an MCP client does not require this code.

The .NET implementation exposes tool classes within its source project.
They support direct calls without a protocol transport, but the published
`LibTmux.Mcp` distribution is a tool package. Use this pattern inside a
source application that references the MCP project.

### Run and read an exit status

This excerpt uses the same `McpTools.Writing` and `RunAsync` calls as
the port's collected
[command example](https://github.com/libtmux/libtmux-dotnet/blob/6656a563ec9e07ab52e0c3ac96f7704fc94cc0c0/docs/mcp/README.md).
It assumes an existing `server`, `pane`, and cancellation token
`ct`.

```csharp
using LibTmux;
using LibTmux.Mcp;

await using WriteTools tools = McpTools.Writing(server);

RunResult result = await tools.RunAsync(
    "test -f /etc/hostname && echo present",
    pane.Id.ToString(),
    timeoutSeconds: 20,
    cancellationToken: ct);

Console.WriteLine($"exit {result.ExitStatus}, timed out: {result.TimedOut}");
```

The command's exit status comes from the shell. If it times out, inspect
the pane before deciding what to do next; the shell command may still be
running.

The returned writing tools own the resources created by the factory and
must be disposed asynchronously. A supplied `Server` or `JobStore`
remains caller-owned.

### Use a protocol client

A stdio client performs the corresponding task with `tmux_run`.
For commands that outlast one call, use `tmux_start_job` and collect
with `tmux_job`.

The [factory source](https://github.com/libtmux/libtmux-dotnet/blob/6656a563ec9e07ab52e0c3ac96f7704fc94cc0c0/src/LibTmux.Mcp/McpTools.cs)
defines ownership.
