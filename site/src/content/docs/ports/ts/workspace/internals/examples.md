---
title: TypeScript workspace builder examples
description: Build and inspect a workspace on a private tmux server with TypeScript.
port: ts
product: workspace
aliases: [examples/workspace-from-file]
sidebar:
  group: Internals
  label: Examples
  order: 3
tableOfContents: true
---

Create a workspace with two windows and two editor panes, inspect the result,
then stop its private tmux server. The `/bin/cat` commands keep panes open
without depending on an application or log file.

## Prepare the project

Use Bun 1.4.2 or newer, Git, and tmux 3.2a or newer on Unix. Create an empty
consumer directory:

```console
$ mkdir workspace-example && cd workspace-example
```

Fetch the source revision used by this example:

```console
$ git init libtmux-source && \
    git -C libtmux-source remote add origin https://github.com/libtmux/libtmux-ts.git && \
    git -C libtmux-source fetch --depth 1 origin 3fe1ca654b81b8cbf4a13b777a001a3298c87a6f && \
    git -C libtmux-source checkout --detach FETCH_HEAD
```

Create the project manifest. Both packages come from the same source tree:

```json title="package.json"
{
  "private": true,
  "type": "module",
  "workspaces": [
    "libtmux-source/packages/libtmux",
    "libtmux-source/packages/workspace"
  ],
  "dependencies": {
    "libtmux": "workspace:*",
    "@libtmux/workspace": "workspace:*"
  }
}
```

The local workspaces keep the consumer and companion on the same core
module from that checkout.

Install the dependencies:

```console
$ bun install --production
```

## Build and remove a workspace

Create the program below. The bootstrap session keeps the private server
running while the program sets its default shell and builds the workspace.
Cleanup covers a failed build as well as a successful one.

```typescript title="workspace.ts"
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Server } from "libtmux";
import { applyWorkspace } from "@libtmux/workspace";

const directory = await mkdtemp(join(tmpdir(), "libtmux-workspace-"));
const server = new Server({
  socketPath: join(directory, "tmux.sock"),
  configFile: "/dev/null",
  environment: { ...process.env, ENV: "/dev/null", BASH_ENV: "/dev/null" },
  timeoutMs: 5_000,
});
const failures: unknown[] = [];
try {
  await server.newSession({ name: "bootstrap", shellCommand: "/bin/cat" });
  await server.setGlobalOption("session", "default-shell", "/bin/sh");
  const session = await applyWorkspace(server, {
    session_name: "workspace-example",
    windows: [
      { window_name: "editor", panes: ["/bin/cat", "/bin/cat"] },
      { window_name: "logs", panes: ["/bin/cat"] },
    ],
  });
  const windows = session.windows.toArray();
  const editor = windows.find((window) => window.name === "editor");
  if (windows.length !== 2 || editor?.panes.length !== 2) {
    throw new Error("Expected two windows and two editor panes");
  }
  console.log(`built: ${windows.length} windows`);
  console.log(`editor: ${editor.panes.length} panes`);
} catch (error) {
  failures.push(error);
} finally {
  for (const cleanup of [
    async () => {
      if ((await readdir(directory)).includes("tmux.sock")) await server.kill();
      await rm(directory, { recursive: true });
    },
  ]) {
    try { await cleanup(); }
    catch (error) { failures.push(error); }
  }
}
if (failures.length > 0) throw new AggregateError(failures, "Workspace example failed");
```

`newSession` can fail after starting tmux. Cleanup checks the owned socket
even if that call did not return. If stopping tmux fails, the program keeps
the socket directory and reports the error.

## Verification

Run the program:

```console
$ bun run workspace.ts
```

Expected output:

```text
built: 2 windows
editor: 2 panes
```

`applyWorkspace` returns the built session snapshot. Its windows and panes
reflect the completed build; request another snapshot after later changes.
The program removes every session on the private server before exiting.

For a workspace that stays open, let the application retain its explicitly
selected server and choose when to stop it. A failed build can leave partial
work; the example's server cleanup removes it.

[Example source](https://github.com/libtmux/libtmux-ts/blob/3fe1ca654b81b8cbf4a13b777a001a3298c87a6f/examples/workspace/workspace.ts);
[Workspace builder source](https://github.com/libtmux/libtmux-ts/blob/3fe1ca654b81b8cbf4a13b777a001a3298c87a6f/packages/workspace/src/builder.ts).
