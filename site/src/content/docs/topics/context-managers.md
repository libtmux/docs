---
title: Context managers
description: Scope-based cleanup for tmux objects, and when your program must kill them explicitly.
sidebar:
  label: Context managers
  group: Topics
  order: 4
tableOfContents: true
---

A tmux session, window, or pane normally remains until you kill it. Scope-based
cleanup can kill it when your code leaves a block, including after an exception.
See [Workspaces](/concepts/workspaces/) for a temporary layout example.

Python provides context managers for tmux objects. .NET provides ownership
scopes for servers, sessions, and windows. Other ports require explicit cleanup
or offer guards for test servers:

| Port | Server | Session | Window | Pane |
|------|:------:|:-------:|:------:|:----:|
| Python | yes | yes | yes | yes |
| .NET | yes | yes | yes | - |
| Java | closes conn. | - | - | - |
| Rust | test-only | - | - | - |
| C++ | test-only | - | - | - |
| TypeScript | - | - | - | - |
| Go | - | - | - | - |
| Swift | - | - | - | - |

"test-only" means a guard owns an entire disposable test server. Java's
`AutoCloseable` server releases its transport but leaves tmux running. A dash
means no built-in cleanup scope is listed for that object; use an explicit kill
call with the cleanup mechanism appropriate to your language.

## Python: every level, including nested

Python's `Server`, `Session`, `Window`, and `Pane` support context managers.
Entry returns the existing object; exit kills it, including when the block
raises:

```python
with Server() as server:
    with server.new_session() as session:
        with session.new_window() as window:
            with window.split() as pane:
                pane.send_keys('echo "Hello"')
                # everything above is killed on the way out, in reverse order
```

Nested scopes exit in reverse order: pane, window, session, then server.

## .NET: an explicit ownership type, stopping at Window

.NET's `OwnedSessionScope` and `OwnedWindowScope` wrap the created object and
implement `IAsyncDisposable`. The `Session` and `Window` handles themselves are
not disposable:

```csharp
await using OwnedSessionScope session = await server.CreateOwnedSessionAsync();
await using OwnedWindowScope window = await session.Value.CreateOwnedWindowAsync();

await window.Value.SendTextAsync("echo hello");
// window, then session, killed on the way out
```

There is no `OwnedPaneScope`. For tests,
`TmuxTestFactory.CreateHierarchyAsync()` returns a `TemporaryHierarchyScope`
containing a private server, session, window, and pane. Disposing it kills the
server.

## Java: `Server` is closeable, but closing one doesn't kill it

Java's `Server` implements `AutoCloseable`. Exiting `try (Server server =
Server.open(config))` releases the owned transport while tmux and its sessions
remain running. Kill sessions, windows, panes, or the server explicitly when
your program owns their cleanup.

```java
ServerConfig config = ServerConfig.builder()
        .endpoint(ServerEndpoint.socketPath(socket))
        .build();

try (Server server = Server.open(config)) {
    Session session = server.newSession("demo");
    Window window = session.newWindow("build");
    Pane pane = window.split();

    pane.sendLine("echo hello from libtmux");
    // session, window, and pane all outlive this block: only the
    // connection this `server` handle held is released on the way out.
}
```

## Rust: no async `Drop`, so cleanup is explicit or best-effort

Rust's `Drop::drop` is synchronous and cannot await an async tmux kill. Use
explicit shutdown when you need to observe cleanup failures:

- **`kill(self)` consumes the handle.** Session, window, and pane kill methods
  take `self` by value, preventing subsequent use of that handle.
- **`libtmux::test::TestServer` provides a test guard.** Call
  `guard.shutdown().await?` to handle cleanup errors. Its `Drop` implementation
  falls back to synchronous, best-effort `force_cleanup()`.

```rust
use libtmux::test::TestServer;

let guard = TestServer::new().await?;
let server = guard.server();

let session = server.new_session("work").await?;
session.new_window("editor").await?;

// Await shutdown to handle cleanup errors.
guard.shutdown().await?;
```

## C++: RAII exists, but only for a private test server

C++'s `Session`, `Window`, and `Pane` are non-owning values; destroying a handle
does not kill its tmux object. `libtmux::test::ScopedTmuxServer`, in the
separate `testing` CMake component, owns a private test server and its temporary
socket directory:

```cpp
auto fixture = libtmux::test::ScopedTmuxServer::start(
    {.socket_namespace = libtmux::test::SocketNamespace::consumer("my-suite")});
// fixture killed, and its tree removed, when this scope ends:
// even if the test that follows fails
```

## TypeScript, Go, Swift: no built-in scoping at all

TypeScript, Go, and Swift require explicit cleanup of sessions, windows, and
panes. Connection or notification handles may have separate disposal APIs:

- **TypeScript** implements `[Symbol.asyncDispose]` on control connections and
  notification streams. `await using` releases those handles; it does not kill
  the watched session or pane. See [Control mode vs
  one-shot](/concepts/transports/). Use `finally` for a session your program
  owns:

  ```typescript
  const session = await server.newSession({ name: "work" });
  try {
    const window = await session.newWindow({ name: "editor" });
    await window.panes.at(0)?.sendKeys("echo hi");
  } finally {
    await session.kill();
  }
  ```

- **Go** implements `io.Closer` on `ControlClient`, `PaneObservation`, and
  `NotificationStream`. Use `defer conn.Close()` for those resources and an
  explicit `Kill(ctx)` for tmux objects:

  ```go
  session, err := server.NewSession(ctx, tmux.NewSessionRequest{Name: "work"})
  if err != nil {
      return err
  }
  defer session.Kill(ctx) // idiomatic Go: not a library-provided guarantee
  ```

- **Swift** uses non-owning session, window, and pane values. Call `try await
  server.kill(session)` or the corresponding window or pane overload when
  cleanup is required.

## What this means in practice

Use explicit cleanup for objects whose handles have no disposal hook. For an
entire disposable test server, prefer your port's test fixture or server guard;
see [Testing with libtmux](/guides/testing-with-libtmux/).
