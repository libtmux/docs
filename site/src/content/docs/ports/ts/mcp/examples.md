---
title: TypeScript MCP examples
description: List sessions through the TypeScript MCP server and inspect implementation examples.
port: ts
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

The port's `mcp-agent` example connects an MCP client and server with linked
in-memory transports. The same tool names and arguments are used over stdio.

### Connect an embedded client

This function comes from the
[agent example](https://github.com/libtmux/libtmux-ts/blob/f85b8de551353f746d50eaf36bf0112f4fe5a528/examples/mcp-agent/mcp-agent.ts).
It accepts an existing libtmux `Server`.

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTmuxMcpServer } from "@libtmux/mcp";
import type { Server } from "libtmux/server";

export async function connectAgent(server: Server): Promise<Client> {
  const client = new Client({ name: "example", version: "0.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    createTmuxMcpServer(server, {
      environment: { LIBTMUX_TOOLSETS: "inspect,execute" },
    }).connect(serverSide),
    client.connect(clientSide),
  ]);
  return client;
}
```

The caller owns the returned client. Close it after use. The complete
example adds helpers for `run_shell_command`, `wait_for_text`,
`capture_since`, and topology creation.

### Run the example's checks

From the TypeScript repository after installing its dependencies:

```console
$ bun test examples/mcp-agent
```

The [example tests](https://github.com/libtmux/libtmux-ts/blob/f85b8de551353f746d50eaf36bf0112f4fe5a528/examples/mcp-agent/mcp-agent.test.ts)
start real tmux on an isolated socket and drive it through the MCP client.
They cover exit status, echoed command text, waits, and successive cursor
reads. Rendering this excerpt does not execute those tests.

For declarative application code, see
[Workspace builder examples](../../workspace/internals/examples/).
