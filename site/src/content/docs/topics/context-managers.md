---
title: Context managers
description: Scoping a session, window, or pane to a block of code so it's torn down when you leave — and how far each port actually takes that idea.
sidebar:
  label: Context managers
  group: Topics
  order: 4
tableOfContents: true
---

Creating a tmux object through libtmux normally hands you something that
lives until you kill it yourself. A context manager hands that cleanup back
to the language instead: scope the object to a block, and it's gone the
moment you leave — whether you exit cleanly or an exception unwinds the
stack partway through. [Workspaces](/concepts/workspaces/) already
flags this as worth checking per port rather than assuming; this page is
that check, done.

The idea is universal. How far each port takes it is not — and the honest
answer, verified against each port's own source, is that only two of the
eight extend it past their own test helpers:

| Port | Server | Session | Window | Pane |
|------|:------:|:-------:|:------:|:----:|
| Python | yes | yes | yes | yes |
| .NET | yes | yes | yes | — |
| Java | closes conn. | — | — | — |
| Rust | test-only | — | — | — |
| C++ | test-only | — | — | — |
| TypeScript | — | — | — | — |
| Go | — | — | — | — |
| Swift | — | — | — | — |

"test-only" means the mechanism exists to give a *test* a private, disposable
tmux server — not to scope an ordinary session, window, or pane your
program creates. Java's "closes conn." is its own, weaker case: `Server`
implements `AutoCloseable`, but closing it releases this process's own
transport rather than tearing down the tmux server underneath — the
distinction the Java section below spells out, because a table cell alone
would read as the same guarantee Python's `yes` gives. A dash means the
port has no built-in scoping for that
object at all: you call `kill()` yourself, in your own `try`/`finally`,
`defer`, or RAII type, the same as you would for any resource the language
doesn't manage for you.

## Python: every level, including nested

`Server`, `Session`, `Window`, and `Pane` are all context managers. Entering
one is just holding the object; exiting kills it — including when the block
raises:

```python
with Server() as server:
    with server.new_session() as session:
        with session.new_window() as window:
            with window.split() as pane:
                pane.send_keys('echo "Hello"')
                # everything above is killed on the way out, in reverse order
```

Cleanup runs pane, then window, then session, then server — the reverse of
creation order — which keeps tmux's own bookkeeping consistent as each layer
disappears out from under the one below it.

## .NET: an explicit ownership type, stopping at Window

.NET doesn't make `Session` or `Window` themselves disposable. Instead,
*creating* one with ownership in mind returns a separate scope type —
`OwnedSessionScope`, `OwnedWindowScope` — that wraps the object and
implements `IAsyncDisposable`:

```csharp
await using OwnedSessionScope session = await server.CreateOwnedSessionAsync();
await using OwnedWindowScope window = await session.Value.CreateOwnedWindowAsync();

await window.Value.SendTextAsync("echo hello");
// window, then session, killed on the way out
```

The ladder stops at `Window` — there is no `OwnedPaneScope` for a pane you
split off one, verified by its absence rather than assumed. `LibTmux.Testing`
adds one more shape for tests specifically: `TemporaryHierarchyScope`, from
`TmuxTestFactory.CreateHierarchyAsync()`, wraps an entire private
server-session-window-pane stack in one `IAsyncDisposable` that kills the
server on exit — the test equivalent of Python's nested example above,
minus the manual nesting.

## Java: `Server` is closeable, but closing one doesn't kill it

`Server implements AutoCloseable`, which is what makes the flagship example's
`try (Server server = Server.open(config)) { ... }` block compile — but
read `close()`'s own doc comment before assuming it matches Python's
`with Server()`: it "releases an owned transport" and is explicitly "never
kills tmux." Exiting the block drops the client connection this process
opened; the tmux server and every session on it are still there afterward.
`Session`, `Window`, and `Pane` don't implement `AutoCloseable` at all —
killing one of those is always an explicit `.kill()`-shaped call inside the
block, and so, despite appearances, is killing the server itself.

```java
ServerConfig config = ServerConfig.builder()
        .endpoint(ServerEndpoint.socketPath(socket))
        .build();

try (Server server = Server.open(config)) {
    Session session = server.newSession("demo");
    Window window = session.newWindow("build");
    Pane pane = window.split();

    pane.sendLine("echo hello from libtmux");
    // session, window, and pane all outlive this block — only the
    // connection this `server` handle held is released on the way out.
}
```

## Rust: no async `Drop`, so cleanup is explicit or best-effort

Rust's `Drop::drop` is a synchronous method, and killing a tmux object is an
async tmux command — the two don't compose, so Rust has no RAII type that
`await`s a kill on scope exit the way Python's `with` or .NET's `await using`
do. Two things stand in for it instead:

- **`kill(self)` consumes the handle.** Session, window, and pane kill
  methods take `self` by value, so the compiler refuses to let you call
  anything on a handle you've already killed — not scope-exit cleanup, but a
  real, verified guardrail against use-after-kill.
- **`libtmux::test::TestServer` is test-only, and asymmetric on purpose.**
  Its preferred teardown is an explicit `guard.shutdown().await?`, which can
  report a real error if cleanup failed. Its `impl Drop` is a fallback for
  the path where you didn't call that — `force_cleanup()`, synchronous and
  best-effort, because `drop()` has no `await` to give it.

```rust
use libtmux::test::TestServer;

let guard = TestServer::new().await?;
let server = guard.server();

let session = server.new_session("work").await?;
session.new_window("editor").await?;

// Explicit, and fallible — the shape Drop cannot offer.
guard.shutdown().await?;
```

## C++: RAII exists, but only for a private test server

`Session`, `Window`, and `Pane` are non-owning value types in C++ — there is
no destructor to hook, because there is no resource these objects own, and
killing the tmux-side entity is always an explicit `.kill()` call. The one
RAII type in the project, `libtmux::test::ScopedTmuxServer`, lives in a
separate `testing` CMake component and scopes a whole private tmux server
(its own `TMUX_TMPDIR`, a redacted environment) rather than any single
session, window, or pane:

```cpp
auto fixture = libtmux::test::ScopedTmuxServer::start(
    {.socket_namespace = libtmux::test::SocketNamespace::consumer("my-suite")});
// fixture killed, and its tree removed, when this scope ends —
// even if the test that follows fails
```

## TypeScript, Go, Swift: no built-in scoping at all

None of these three give `Session`, `Window`, or `Pane` a disposal hook, and
none has a test-only exception the way Rust and C++ do:

- **TypeScript** does define `[Symbol.asyncDispose]`, which is what makes
  `await using events = server.watch()` and `await using live =
  await server.connect()` work — but those are the *control-mode
  connection/notification-stream* handles from [Control mode vs
  one-shot](/concepts/transports/), not the session or pane the
  connection is watching. Killing a session or pane you created is still an
  explicit `await session.kill()`, written by hand in a `finally`:

  ```typescript
  const session = await server.newSession({ name: "work" });
  try {
    const window = await session.newWindow({ name: "editor" });
    await window.panes.at(0)?.sendKeys("echo hi");
  } finally {
    await session.kill();
  }
  ```

- **Go** follows the same split: `ControlClient`, `PaneObservation`, and
  `NotificationStream` all implement `io.Closer`, so `defer conn.Close()` is
  the idiomatic way to release *those* — but `Session`, `Window`, and `Pane`
  have no `Close()`, only `Kill(ctx)`, called explicitly or via your own
  `defer`:

  ```go
  session, err := server.NewSession(ctx, tmux.NewSessionRequest{Name: "work"})
  if err != nil {
      return err
  }
  defer session.Kill(ctx) // idiomatic Go: not a library-provided guarantee
  ```

- **Swift** has neither: `Session`, `Window`, and `Pane` are plain value
  types holding an ID and a few fields, nothing that owns a resource to
  release. Cleanup is always `try await server.kill(session)` (or `window`,
  or `pane`), called when you mean it, wrapped in your own `defer` if you
  want scope-exit behavior.

## What this means in practice

Outside Python and, up to `Window`, .NET, reaching for "clean this up
automatically" in a test or a short-lived script means writing the
try/finally, `defer`, or RAII type yourself — or, in Rust's and C++'s cases,
reaching for the port's own test-only server guard if what you actually need
is an entire disposable server rather than one object inside a shared one.
None of that is a gap so much as a difference worth knowing about before you
assume a `with`-shaped block exists where it doesn't.
