---
supportedPorts: [py, ts, rs, go, java, csharp, cxx, swift]
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

<!-- port:root -->
Python provides context managers for tmux objects. C# provides ownership
scopes for servers, sessions, and windows. Other ports require explicit cleanup
or offer guards for test servers:

| Port | Server | Session | Window | Pane |
|------|:------:|:-------:|:------:|:----:|
<!-- port:py -->| Python | yes | yes | yes | yes |
<!-- /port --><!-- port:csharp -->| C# | yes | yes | yes | - |
<!-- /port --><!-- port:java -->| Java | closes conn. | - | - | - |
<!-- /port --><!-- port:rs -->| Rust | test-only | - | - | - |
<!-- /port --><!-- port:cxx -->| C++ | test-only | - | - | - |
<!-- /port --><!-- port:ts -->| TypeScript | - | - | - | - |
<!-- /port --><!-- port:go -->| Go | - | - | - | - |
<!-- /port --><!-- port:swift -->| Swift | - | - | - | - |
<!-- /port -->
"test-only" means a guard owns an entire disposable test server. Java's
`AutoCloseable` server releases its transport but leaves tmux running. A dash
means no built-in cleanup scope is listed for that object; use an explicit kill
call with the cleanup mechanism appropriate to your language.

<!-- /port -->

<!-- port:py -->
<a id="python-every-level-including-nested"></a>

## Nested context managers

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
<!-- /port -->

<!-- port:csharp -->
<a id="net-an-explicit-ownership-type-stopping-at-window"></a>

## Owned sessions and windows

C#'s `OwnedSessionScope` and `OwnedWindowScope` wrap the created object and
implement `IAsyncDisposable`. The `Session` and `Window` handles themselves are
not disposable:

```csharp
await using OwnedSessionScope session = await server.CreateOwnedSessionAsync();
await using OwnedWindowScope window =
    await session.Value.CreateOwnedWindowAsync();

await window.Value.SendTextAsync("echo hello");
// window, then session, killed on the way out
```

For tests that need an owned pane,
`TmuxTestFactory.CreateHierarchyAsync()` returns a `TemporaryHierarchyScope`
containing a private server, session, window, and pane. Disposing it kills the
server.
<!-- /port -->

<!-- port:java -->
<a id="java-server-is-closeable-but-closing-one-doesnt-kill-it"></a>

## Closing a server connection

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
<!-- /port -->

<!-- port:rs -->
<a id="rust-no-async-drop-so-cleanup-is-explicit-or-best-effort"></a>

## Explicit asynchronous cleanup

Rust's `Drop` is synchronous and cannot await an async tmux kill. Use
explicit shutdown when you need to observe cleanup failures:

- **`kill(self)` consumes the handle.** Session, window, and pane kill methods
  take `self` by value, preventing subsequent use of that handle.
- **`libtmux::test::TestServer` provides a test guard.** Call
  `TestServer.shutdown` to handle cleanup errors. Its `Drop` implementation
  makes a synchronous cleanup attempt.

```rust
use libtmux::test::TestServer;

let guard = TestServer::new().await?;
let server = guard.server();

let session = server.new_session("work").await?;
session.new_window("editor").await?;

// Await shutdown to handle cleanup errors.
guard.shutdown().await?;
```
<!-- /port -->

<!-- port:cxx -->
<a id="c-raii-exists-but-only-for-a-private-test-server"></a>

## Owning a test server

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
<!-- /port -->

<!-- port:ts -->
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
<!-- /port -->

<!-- port:go -->
## Defer cleanup with a fresh context

A `Session`, `Window`, or `Pane` handle does not own its tmux object. Dropping
the value leaves tmux running. Register cleanup after successful creation and
use a separate, bounded context so cancellation of the work cannot prevent
cleanup. Return cleanup failures along with any work failure:

```go
func temporarySession(ctx context.Context, server tmux.Server) (err error) {
    session, err := server.NewSession(ctx, tmux.NewSessionRequest{})
    if err != nil {
        return err
    }
    defer func() {
        done, cancel := context.WithTimeout(context.Background(), time.Second)
        defer cancel()
        err = errors.Join(err, session.Kill(done))
    }()
    _, err = session.SearchWindows(ctx, nil)
    return err
}
```

This function uses `context`, `errors`, `time`, and the `tmux` package. It owns
only the session it creates. Do not kill a shared server as session cleanup.

`ControlClient`, `PaneObservation`, and `NotificationStream` implement
`io.Closer`. Close those resources separately from killing tmux objects.
For tests, `tmuxtest.NewServer` registers isolated server cleanup with the
Go test runner.
<!-- /port -->

<!-- port:swift -->
## Kill objects your program owns

Session, window, and pane values are non-owning. Call
`try await server.kill(session)` or the corresponding window or pane overload
when cleanup is required. Perform cleanup on both success and failure paths;
Swift's synchronous `defer` cannot await a tmux command.
<!-- /port -->

<a id="what-this-means-in-practice"></a>

## Testing cleanup

Use explicit cleanup for objects whose handles have no disposal hook. For an
entire disposable test server, prefer your port's test fixture or server guard;
see [Testing with libtmux](/guides/testing-with-libtmux/).
