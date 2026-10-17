---
port: ts
route: topics/context-managers
title: Ownership and cleanup
description: Scope-based cleanup for tmux objects, and when your program must kill them explicitly.
sidebar:
  label: Ownership and cleanup
  group: Topics
  order: 4
tableOfContents: true
---

A tmux session, window, or pane normally remains until you kill it. Scope-based
cleanup can kill it when your code leaves a block, including after an exception.
See [Workspaces](/concepts/workspaces/) for a temporary layout example.

<a id="typescript-go-swift-no-built-in-scoping-at-all"></a>

## Release connections and kill owned sessions

Control connections and notification streams implement `[Symbol.asyncDispose]`.
`await using` releases those handles; it leaves the watched session and panes
running. Use `finally` to kill a session your program owns:

```typescript
const session = await server.newSession({ name: "work" });
try {
  const window = await session.newWindow({ name: "editor" });
  await window.panes.at(0)?.sendKeys("echo hi");
} finally {
  await session.kill();
}
```

<a id="what-this-means-in-practice"></a>

## Testing cleanup

Use explicit cleanup for objects whose handles have no disposal hook. For an
entire disposable test server, prefer your port's test fixture or server guard;
see [Testing with libtmux](/guides/testing-with-libtmux/).
