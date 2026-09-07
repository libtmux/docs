---
title: TypeScript MCP examples
description: Connect an in-process MCP client and run the source-backed agent workflow.
port: ts
product: mcp
sidebar:
  label: Examples
  order: 3
---

The port's `mcp-agent` example connects an MCP client and server with linked
in-memory transports. The same tool names and arguments are used over stdio.

## Connect an embedded client

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

## Run the example's checks

From the TypeScript repository after installing its dependencies:

```console
$ bun test examples/mcp-agent
```

The [example tests](https://github.com/libtmux/libtmux-ts/blob/f85b8de551353f746d50eaf36bf0112f4fe5a528/examples/mcp-agent/mcp-agent.test.ts)
start real tmux on an isolated socket and drive it through the MCP client.
They cover exit status, echoed command text, waits, and successive cursor
reads. Rendering this excerpt does not execute those tests.

For declarative application code, see
[Workspace Manager examples](../../workspace/examples/).
