---
port: csharp
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

<a id="net-an-explicit-ownership-type-stopping-at-window"></a>

## Owned sessions and windows

C#'s `OwnedSessionScope` and `OwnedWindowScope` wrap the created object and
implement `IAsyncDisposable`. The `Session` and `Window` handles themselves are
not disposable:

```csharp
await using OwnedSessionScope session = await server.CreateOwnedSessionAsync();
await using OwnedWindowScope window = await session.Value.CreateOwnedWindowAsync();

await window.Value.SendTextAsync("echo hello");
// window, then session, killed on the way out
```

For tests that need an owned pane,
`TmuxTestFactory.CreateHierarchyAsync()` returns a `TemporaryHierarchyScope`
containing a private server, session, window, and pane. Disposing it kills the
server.

<a id="what-this-means-in-practice"></a>

## Testing cleanup

Use explicit cleanup for objects whose handles have no disposal hook. For an
entire disposable test server, prefer your port's test fixture or server guard;
see [Testing with libtmux](/guides/testing-with-libtmux/).
