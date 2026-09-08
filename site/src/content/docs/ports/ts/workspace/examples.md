---
title: "TypeScript workspace examples"
description: "Read the workspace example used by the TypeScript integration suite."
port: ts
product: workspace
sidebar:
  label: Examples
  order: 3
tableOfContents: true
---

The workspace example declares a development session, applies it through
`@libtmux/workspace`, and provides cleanup that tolerates an absent session.
It also shows the lower-level core API for constructing a session manually.

## Build and remove a workspace

The `buildWorkspace` function applies `DEVELOPMENT_WORKSPACE`. Pass it the
`Server` you want to use. `removeWorkspace` checks a fresh snapshot before
killing the named session and returns whether a session was present.

```typescript file="examples/workspace/workspace.ts"
```

The `sleep` commands keep panes alive for inspection. They do not represent
application readiness checks. Cleanup removes the session and its processes,
so use a dedicated server or a session name owned by the example.

## Verification

The port's workspace integration suite calls this source against real tmux.
From a prepared source checkout, run that suite with:

```console
$ bun test examples/workspace
```

The source include keeps this page's code aligned with the example. Rendering
the page alone does not execute the integration suite. For a smaller runnable
entry point, use the [application guide](../guides/).

[Example source](https://github.com/libtmux/libtmux-ts/blob/f85b8de551353f746d50eaf36bf0112f4fe5a528/examples/workspace/workspace.ts)
