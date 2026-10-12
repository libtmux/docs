---
title: TypeScript MCP examples
description: Connect an embedded TypeScript MCP client and list a private tmux session.
port: ts
product: mcp
sidebar:
  label: Examples
  order: 3
---

Connect a client using the [setup guide](../guides/), then call
[`list_sessions`](../tools/list_sessions/).

## List sessions

Send this params object through the connected client's MCP tools/call request:

```json
{
  "name": "list_sessions",
  "arguments": {}
}
```

Use the returned session IDs when choosing a window or pane.

## Internals

The complete program below embeds a TypeScript MCP client and server with
linked in-memory transports. It offers only `list_sessions`; a client that
launches the stdio server does not need embedding code.

### Prepare the project

Use Bun 1.4.2 or newer, Git, and tmux 3.2a or newer on Unix. Create an empty
consumer directory:

```console
$ mkdir mcp-example && cd mcp-example
```

Fetch the source revision used by this example:

```console
$ git init libtmux-source && \
    git -C libtmux-source remote add origin \
      https://github.com/libtmux/libtmux-ts.git && \
    git -C libtmux-source fetch --depth 1 origin \
      3fe1ca654b81b8cbf4a13b777a001a3298c87a6f && \
    git -C libtmux-source checkout --detach FETCH_HEAD
```

Create the project manifest. The core and MCP packages come from that source
tree; the SDK version matches the MCP package's dependency:

```json title="package.json"
{
  "private": true,
  "type": "module",
  "workspaces": [
    "libtmux-source/packages/libtmux",
    "libtmux-source/packages/mcp"
  ],
  "dependencies": {
    "libtmux": "workspace:*",
    "@libtmux/mcp": "workspace:*",
    "@modelcontextprotocol/sdk": "1.30.0"
  }
}
```

The local workspaces keep the consumer and companion on the same core
module from that checkout.

Install the dependencies:

```console
$ bun install --production
```

### Connect an embedded client

Create the program below. It starts a private tmux session, connects both sides
of the transport, checks the offered tools, then calls
[`list_sessions`](../tools/list_sessions/). Cleanup closes the MCP client
and server before stopping tmux. Operation and cleanup failures stay visible.

```typescript title="mcp.ts"
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTmuxMcpServer } from "@libtmux/mcp";
import { Server } from "libtmux";

const directory = await mkdtemp(join(tmpdir(), "libtmux-mcp-example-"));
const server = new Server({
  socketPath: join(directory, "tmux.sock"),
  configFile: "/dev/null",
  environment: { ...process.env, ENV: "/dev/null", BASH_ENV: "/dev/null" },
  timeoutMs: 5_000,
});
const failures: unknown[] = [];
let client: Client | undefined;
let mcp: ReturnType<typeof createTmuxMcpServer> | undefined;
try {
  await server.newSession({ name: "mcp-example", shellCommand: "/bin/cat" });
  mcp = createTmuxMcpServer(server, {
    callerEnvironment: {},
    environment: { LIBTMUX_TOOLSETS: "", LIBTMUX_TOOLS: "list_sessions" },
  });
  client = new Client({ name: "example", version: "1.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    mcp.connect(serverSide), client.connect(clientSide, { timeout: 5_000 }),
  ]);
  const offered = (await client.listTools(undefined, { timeout: 5_000 }))
    .tools.map((tool) => tool.name);
  if (offered.length !== 1 || offered[0] !== "list_sessions") {
    throw new Error(`Unexpected tools: ${offered.join(", ")}`);
  }
  const result = await client.callTool(
    { name: "list_sessions", arguments: {} }, undefined, { timeout: 5_000 },
  );
  if (result.isError) throw new Error(JSON.stringify(result.content));
  const sessions = result.structuredContent?.sessions;
  if (!Array.isArray(sessions) || sessions.length !== 1 ||
      sessions[0]?.name !== "mcp-example") {
    throw new Error("Expected the example's private session");
  }
  console.log(`tools: ${offered.join(", ")}`);
  console.log(`sessions: ${sessions[0].name}`);
} catch (error) {
  failures.push(error);
} finally {
  for (const cleanup of [
    () => client?.close(),
    () => mcp?.close(),
    async () => {
      if ((await readdir(directory)).includes("tmux.sock")) await server.kill();
      await rm(directory, { recursive: true });
    },
  ]) {
    try { await cleanup(); }
    catch (error) { failures.push(error); }
  }
}
if (failures.length > 0) {
  throw new AggregateError(failures, "MCP example failed");
}
```

`newSession` can fail after starting tmux. Cleanup checks the owned socket
even if that call did not return. If stopping tmux fails, the program keeps
the socket directory and reports the error.

### Run the example's checks

Run the program:

```console
$ bun run mcp.ts
```

Expected output:

```text
tools: list_sessions
sessions: mcp-example
```

An empty `LIBTMUX_TOOLSETS` plus one name in `LIBTMUX_TOOLS` selects only that
operation. `callerEnvironment: {}` avoids importing the surrounding pane's
identity into the embedded server. The explicitly configured `Server`
selects the private socket.

Use the result's structured session IDs for later tool requests. Check
`isError` before reading successful output; the
[tool reference](../tools/list_sessions/) describes its schema.

[Embedded server source](https://github.com/libtmux/libtmux-ts/blob/3fe1ca654b81b8cbf4a13b777a001a3298c87a6f/packages/mcp/src/server.ts);
[upstream agent example](https://github.com/libtmux/libtmux-ts/blob/3fe1ca654b81b8cbf4a13b777a001a3298c87a6f/examples/mcp-agent/mcp-agent.ts);
[upstream example tests](https://github.com/libtmux/libtmux-ts/blob/3fe1ca654b81b8cbf4a13b777a001a3298c87a6f/examples/mcp-agent/mcp-agent.test.ts).

For declarative application code, see
[Workspace builder examples](../../workspace/internals/examples/).
