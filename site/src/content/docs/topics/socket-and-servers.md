---
title: Socket and servers
description: How a port names one specific tmux server among several, checks whether it's actually there, and tells one running instance apart from another.
sidebar:
  label: Socket and servers
  group: Topics
  order: 10
tableOfContents: true
---

A tmux server is selected by its Unix-domain socket. Use different sockets for
independent servers, such as a development session and an isolated test server.
Ports expose tmux's default, named (`-L`), and explicit-path (`-S`) socket
selectors:

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
| Swift | no bare default: see below | `Server(socketName: "work")` | `Server(socketPath: "...")` |

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

Choose either a socket name or a socket path. TypeScript rejects both together
with `TypeError`; Go documents that `SocketPath` takes precedence. tmux uses
`TMUX_TMPDIR` to resolve the directory for default and named sockets.

Swift requires an explicit `socketPath` or `socketName` argument. To reach
tmux's default socket, use `Server(socketName: "default")`.

Python's `Server(socket_name_factory=...)` and .NET's
`ServerConnectionOptions(socketNameFactory: ...)` accept a callable that
generates socket names. Use a unique name for each isolated test server.

## Is the server actually there?

A server handle does not prove that the target server is running. Use a liveness
check when your program needs to distinguish a live server from an unavailable
socket:

| Port | Check |
|------|-------|
| Python | `server.is_alive()` → `bool` |
| TypeScript | `await server.isAlive()` → `Promise<boolean>`; `await server.raiseIfDead()` throws with tmux's own reason instead |
| Go | `server.IsAlive(ctx)` → `(bool, error)`: the `error` is reserved for a question that couldn't be answered at all, not for "not alive" |
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

TypeScript's `isAlive()` and Rust's `is_alive()` return a boolean. Use
TypeScript's `raiseIfDead()` or Rust's `check_alive()` when you need failure
details.

## Killing a server, and telling two apart

Kill an entire server with Python's `server.kill_server()`, TypeScript's `await
server.kill()`, Go's `server.Kill(ctx)`, Rust's `server.kill().await?`, Java's
or Swift's `server.killServer()`, .NET's `await server.KillAsync()`, or C++'s
`server.kill()`. Java's `Server.close()` only releases the local connection; see
[Context
managers](../context-managers/#java-server-is-closeable-but-closing-one-doesnt-kill-it).

Two handles can select the same socket. Python's `Server.__eq__` compares
`socket_name` and `socket_path`. Go's `server.Equal(other)` resolves relative
paths and environment-dependent socket names against each handle's captured
binding.

A restarted server can reuse a socket path while having different state.
TypeScript's `TmuxServerRestarted` and Go's `ErrDaemonReplaced` detect a handle
encountering a replacement daemon.
