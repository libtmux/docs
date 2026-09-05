---
title: Socket and servers
description: How a port names one specific tmux server among several, checks whether it's actually there, and tells one running instance apart from another.
sidebar:
  label: Socket and servers
  group: Topics
  order: 10
tableOfContents: true
---

Every `Server` handle in every port ultimately resolves to a Unix domain
socket — tmux itself has no other notion of "which server." Running more
than one tmux server at once (a suite of tests, each wanting its own private
instance; a program that manages several unrelated sessions on purpose) is
ordinary, not exotic, and every port gives you the same three ways tmux
itself supports for picking one: the default socket, a named one (`-L`), or
an explicit path (`-S`).

## Naming a server

| Port | Default | Named socket (`-L`) | Explicit path (`-S`) |
|------|---------|----------------------|------------------------|
| Python | `Server()` | `Server(socket_name="work")` | `Server(socket_path="/tmp/tmux-1000/work")` |
| TypeScript | `new Server()` | `new Server({ socketName: "work" })` | `new Server({ socketPath: "..." })` |
| Go | `tmux.NewServer(tmux.ServerOptions{})` | `tmux.ServerOptions{SocketName: "work"}` | `tmux.ServerOptions{SocketPath: "..."}` |
| Rust | `Server::new()` | `Server::builder().socket_name("work").build()?` | `Server::builder().socket_path("...").build()?` |
| Java | `ServerEndpoint.defaultSocket()` | `ServerEndpoint.namedSocket("work")` | `ServerEndpoint.socketPath(path)` |
| .NET | `new ServerConnectionOptions()` | `new ServerConnectionOptions(socketName: "work")` | `new ServerConnectionOptions(socketPath: "...")` |
| C++ | `Server::at_default()` | `Server::at_socket_name("work")` | `Server::at_socket_path("...")` |
| Swift | no bare default — see below | `Server(socketName: "work")` | `Server(socketPath: "...")` |

```python
default_server = libtmux.Server()
named = libtmux.Server(socket_name="work")
```

```typescript
const named = new Server({ socketName: "work" });
```

```go
named, err := tmux.NewServer(tmux.ServerOptions{SocketName: "work"})
```

```rust
let named = libtmux::Server::builder().socket_name("work").build()?;
```

```java
ServerConfig config = ServerConfig.builder()
        .endpoint(ServerEndpoint.namedSocket("work"))
        .build();
Server named = Server.open(config);
```

```csharp
using LibTmux;

Server named = await Server.ConnectAsync(new ServerConnectionOptions(socketName: "work"));
```

```cpp
auto named = libtmux::Server::at_socket_name("work");
```

```swift
let named = try Server(socketName: "work")
```

Naming a socket and naming a *path* are mutually exclusive everywhere this
was checked — TypeScript throws a `TypeError` if you pass both, and Go's own
doc comment says `SocketPath` simply takes precedence when both are set
rather than raising. `TMUX_TMPDIR` is the one environment variable that
matters here across every port: tmux itself (not libtmux) resolves the
default and named-socket directory through it, so it shapes which server a
bare, no-argument `Server` lands on even though no port reads it directly.

**Swift is the one port with no bare default at all.** `Server` has exactly
two public initializers — `init(socketPath:)` and `init(socketName:)` — and
neither has a way to omit the argument, so there is no verified
`Server()`-shaped call that lands on whatever `TMUX_TMPDIR`/`default`
resolves to the way the other seven ports' zero-argument constructors do.
Reaching the default socket in Swift means naming it yourself, e.g.
`Server(socketName: "default")`.

Python and .NET add one more convenience worth calling out because the
parallel is exact: Python's `Server(socket_name_factory=...)` and .NET's
`ServerConnectionOptions(socketNameFactory: ...)` both take a callable that
generates a fresh, unique socket name — the shape a test suite wants when
every test needs its own throwaway server and nobody wants to hand-write a
random name generator.

## Is the server actually there?

A `Server` handle is inert until you ask tmux something — constructing one
never starts a process or fails on a socket that doesn't exist yet. Every
port gives you an explicit, cheap check rather than making you infer
liveness from whatever error a real command happens to throw:

| Port | Check |
|------|-------|
| Python | `server.is_alive()` → `bool` |
| TypeScript | `await server.isAlive()` → `Promise<boolean>`; `await server.raiseIfDead()` throws with tmux's own reason instead |
| Go | `server.IsAlive(ctx)` → `(bool, error)` — the `error` is reserved for a question that couldn't be answered at all, not for "not alive" |
| Rust | `server.is_alive().await` → `bool`; `server.check_alive().await` is the fallible twin, for when the *reason* matters |
| Java | `server.isAlive()` → `boolean` |
| .NET | `await server.IsAliveAsync()` → `Task<bool>` |
| C++ | `server.is_alive(timeout)` → `bool` |
| Swift | `try await server.isRunning()` → `Bool` |

```python
if server.is_alive():
    server.sessions
```

```typescript
if (await server.isAlive()) {
  await server.snapshot();
}
```

```go
alive, err := server.IsAlive(ctx)
```

```rust
if server.is_alive().await {
    server.sessions().await?;
}
```

```java
if (server.isAlive()) {
    server.sessions();
}
```

```csharp
if (await server.IsAliveAsync())
{
    await server.GetSessionsAsync();
}
```

```cpp
if (server.is_alive(std::chrono::seconds{2})) {
  server.sessions();
}
```

```swift
if try await server.isRunning() {
    try await server.sessions()
}
```

TypeScript and Rust both separate "tell me" from "tell me why not," and for
the same reason: every read already raises on an unreachable server, so
`isAlive()` / `is_alive()` isn't what turns an empty result into a dead-server
diagnosis — it exists for a caller that wants the check on its own, with
nothing to hang a read on yet. `raiseIfDead()` / `check_alive()` is the
assertion form of the same question, for when you do want the failure to
carry tmux's own reason.

## Killing a server, and telling two apart

Killing the whole server — not a session inside it — is `kill-server`,
reached the same way in every port: `server.kill_server()` (Python),
`await server.kill()` (TypeScript), `server.Kill(ctx)` (Go),
`server.kill().await?` (Rust), `server.killServer()` (Java and Swift),
`await server.KillAsync()` (.NET), `server.kill()` (C++). [Context
managers](../context-managers/#java-server-is-closeable-but-closing-one-doesnt-kill-it)
covers the one place this is easy to get backwards: Java's `Server.close()`
— the method `try`-with-resources calls — is *not* this; it releases the
local connection and leaves the server running.

Two `Server` handles can name the same socket without being the same
object, so "is this the same server" starts as a question about the
*selector* (which socket), not the handle: Python's `Server.__eq__` compares
`socket_name` and `socket_path` directly, and Go's `server.Equal(other)`
does the same job more carefully — it "evaluates relative paths and
environment-dependent named and default sockets against each handle's
frozen binding" rather than comparing the two fields as literal strings.

Neither answers a sharper question that both ports separately guard
against: a socket path names a *place*, not a process, and `kill-server`
followed by a restart on the same path produces a server that resolves to
the same place while being, underneath, a different tmux daemon with none of
the state the first one had. TypeScript's `TmuxServerRestarted` and Go's
`ErrDaemonReplaced` both exist specifically to catch a handle acting on a
daemon that already isn't the one that made it — verified, real guards
against exactly this, not a theoretical concern.
