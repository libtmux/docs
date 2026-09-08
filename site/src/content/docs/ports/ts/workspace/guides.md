---
title: "Apply a TypeScript workspace"
description: "Install the workspace package, validate a description, and apply it to tmux."
port: ts
product: workspace
sidebar:
  label: Guides
  order: 2
tableOfContents: true
---

Apply a workspace to create its session, windows, and panes. Install tmux on
the host, then add the workspace package and core library:

```console
$ bun add @libtmux/workspace libtmux
```

## Create a session

Save this as `workspace.ts`. It creates a dedicated session with two panes.
The `try` / `finally` removes that session after inspecting it, so the example
leaves no session running.

```typescript
import { Server } from "libtmux";
import { applyWorkspace } from "@libtmux/workspace";

const server = new Server({
  socketName: `workspace-guide-${crypto.randomUUID()}`,
});
const session = await applyWorkspace(server, {
  session_name: "workspace-guide",
  windows: [{ window_name: "editor", panes: ["echo ready", "echo ready"] }],
});
try {
  console.log(session.name);
} finally {
  await session.kill();
}
```

Run it with Bun:

```console
$ bun run workspace.ts
```

The example selects a new socket name so it does not reuse a session on your
normal tmux server. For a workspace you want to keep, choose the intended
server explicitly and retain the returned session.

## Read configuration

`parseWorkspace` from `@libtmux/workspace/config` validates an object produced
by your chosen JSON or YAML parser. `parseWorkspaceYaml` reads YAML through
Bun's parser. Unknown fields fail validation rather than silently changing the
requested workspace.

Use `planWorkspace` before changing an existing session. Review removal and
retention entries, then apply promptly. Replan after any failure or outside
change. See [Topics](../topics/) for command replay and pruning policies and
[Examples](../examples/) for the package's integration example.

[Parsing implementation](https://github.com/libtmux/libtmux-ts/blob/f85b8de551353f746d50eaf36bf0112f4fe5a528/packages/workspace/src/config.ts); [Application implementation](https://github.com/libtmux/libtmux-ts/blob/f85b8de551353f746d50eaf36bf0112f4fe5a528/packages/workspace/src/builder.ts).
