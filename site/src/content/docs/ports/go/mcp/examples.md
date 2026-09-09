---
title: Go MCP examples
description: List sessions through the Go MCP server and inspect implementation examples.
port: go
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

## Internals

The following examples are for applications that embed or extend the server.
Installing and connecting an MCP client does not require this code.

The Go `agent-workflow` example connects an MCP client and server in
memory. It discovers caller context, splits a pane, starts a background
command, inspects topology, and collects the command result.

### Run the agent workflow

From the Go repository with its dependencies and tmux installed, create
a disposable server using a socket name reserved for this example:

```console
$ tmux -L libtmux-go-docs-example new-session -d -s example
```

Run the example:

```console
$ go -C mcp run ./examples/agent-workflow \
    -socket-name libtmux-go-docs-example
```

It selects the `operate` capability profile when the environment has
not selected another profile. An inherited metadata-only selection will
not permit its writes.

The output identifies the created pane and job, then reports exit status
and the final layout. The example reads `structuredContent` through
the MCP client rather than calling private tool handlers.

### Clean up

After inspecting the result, end only the disposable server created above:

```console
$ tmux -L libtmux-go-docs-example kill-server
```

The [complete source](https://github.com/libtmux/libtmux-go/blob/5f808882015a975a65acc7f9da5b3ff0d5cbdc91/mcp/examples/agent-workflow/main.go)
owns and closes its client and managed server instance. Its
[README](https://github.com/libtmux/libtmux-go/blob/5f808882015a975a65acc7f9da5b3ff0d5cbdc91/mcp/examples/agent-workflow/README.md)
describes the expected workflow. These commands execute real tmux
operations; viewing this page does not run them.

For workspace configuration without MCP, see
[Workspace builder examples](../../workspace/internals/examples/).
