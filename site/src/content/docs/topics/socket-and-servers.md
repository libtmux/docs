---
supportedPorts: [py, ts, rs, go, java, csharp, cxx, swift]
title: Socket and servers
description: Select a server socket, check liveness, and detect a replacement daemon.
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
<!-- port:py -->| Python | `Server()` | `Server(socket_name="work")` | `Server(socket_path="/tmp/tmux-1000/work")` |
<!-- /port --><!-- port:ts -->| TypeScript | `new Server()` | `new Server({ socketName: "work" })` | `new Server({ socketPath: "..." })` |
<!-- /port --><!-- port:go -->| Go | `tmux.NewServer(tmux.ServerOptions{})` | `tmux.ServerOptions{SocketName: "work"}` | `tmux.ServerOptions{SocketPath: "..."}` |
<!-- /port --><!-- port:rs -->| Rust | `Server::new()` | `Server::builder().socket_name("work").build()?` | `Server::builder().socket_path("...").build()?` |
<!-- /port --><!-- port:java -->| Java | `ServerEndpoint.defaultSocket()` | `ServerEndpoint.namedSocket("work")` | `ServerEndpoint.socketPath(path)` |
<!-- /port --><!-- port:csharp -->| C# | `new ServerConnectionOptions()` | `new ServerConnectionOptions(socketName: "work")` | `new ServerConnectionOptions(socketPath: "...")` |
<!-- /port --><!-- port:cxx -->| C++ | `Server::at_default()` | `Server::at_socket_name("work")` | `Server::at_socket_path("...")` |
<!-- /port --><!-- port:swift -->| Swift | no bare default: see below | `Server(socketName: "work")` | `Server(socketPath: "...")` |
<!-- /port -->
```python
default_server = libtmux.Server()
named = libtmux.Server(socket_name="work")
```

```typescript
const named = new Server({ socketName: "work" });
```

```go
named, err := tmux.NewServer(tmux.ServerOptions{SocketName: "work"})
if err != nil {
    return err
}
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

Choose either a socket name or a socket path. tmux uses `TMUX_TMPDIR` to
resolve the directory for default and named sockets.

<!-- port:ts -->
Supplying both selectors raises `TypeError`.
<!-- /port -->
<!-- port:go -->
`ServerOptions.SocketPath` takes precedence over `ServerOptions.SocketName` when both are set.
<!-- /port -->

<!-- port:swift -->
Swift requires an explicit `socketPath` or `socketName` argument. To reach
tmux's default socket, use `Server(socketName: "default")`.
<!-- /port -->

<!-- port:py -->
`Server(socket_name_factory=...)` accepts a callable that generates socket
names. Use a unique name for each isolated test server.
<!-- /port -->
<!-- port:csharp -->
`ServerConnectionOptions(socketNameFactory: ...)` accepts a callable that
generates socket names. Use a unique name for each isolated test server.
<!-- /port -->

## Is the server actually there?

A server handle does not prove that the target server is running. Use a liveness
check when your program needs to distinguish a live server from an unavailable
socket:

| Port | Check |
|------|-------|
<!-- port:py -->| Python | `server.is_alive()` → `bool` |
<!-- /port --><!-- port:ts -->| TypeScript | `await server.isAlive()` → `Promise<boolean>`; `await server.raiseIfDead()` throws with tmux's own reason instead |
<!-- /port --><!-- port:go -->| Go | `server.IsAlive(ctx)` → `(bool, error)`: the `error` is reserved for a question that couldn't be answered at all, not for "not alive" |
<!-- /port --><!-- port:rs -->| Rust | `server.is_alive().await` → `bool`; `server.check_alive().await` is the fallible twin, for when the *reason* matters |
<!-- /port --><!-- port:java -->| Java | `server.isAlive()` → `boolean` |
<!-- /port --><!-- port:csharp -->| C# | `await server.IsAliveAsync()` → `Task<bool>` |
<!-- /port --><!-- port:cxx -->| C++ | `server.is_alive(timeout)` → `bool` |
<!-- /port --><!-- port:swift -->| Swift | `try await server.isRunning()` → `Bool` |
<!-- /port -->
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
if err != nil {
    return err
}
fmt.Println("server running:", alive)
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

<!-- port:ts -->
`isAlive()` returns a boolean. Use `raiseIfDead()` when you need failure details.
<!-- /port -->
<!-- port:rs -->
`is_alive()` returns a boolean. Use `check_alive()` when you need failure details.
<!-- /port -->

## Killing a server, and telling two apart

Killing a server ends all its sessions. Use this only for a server your program
owns; for narrower cleanup, kill the session or pane you created.

<!-- port:py -->
Call `server.kill_server()`. `Server.__eq__` compares `socket_name` and
`socket_path` when deciding whether two handles select the same endpoint.
<!-- /port -->
<!-- port:ts -->
Call `await server.kill()`. `TmuxServerRestartedError` reports an operation
whose handle encountered a replacement daemon on the same socket.
<!-- /port -->
<!-- port:go -->
Call `server.Kill(ctx)` and check its error. `server.Equal(other)` compares
the captured socket bindings, resolving relative paths and environment-based
socket names. Equal endpoints do not prove equal daemon lifetimes.
`ErrDaemonReplaced` reports a replacement daemon on the selected socket.
<!-- /port -->
<!-- port:rs -->
Call `server.kill().await?` and handle a cleanup failure before returning.
<!-- /port -->
<!-- port:java -->
Call `server.killServer()` to stop tmux. `Server.close()` releases the local
connection and leaves tmux running; see [Ownership and cleanup](../context-managers/).
<!-- /port -->
<!-- port:csharp -->
Call `await server.KillAsync()` and handle a cleanup failure before returning.
<!-- /port -->
<!-- port:cxx -->
Call `server.kill()` and inspect its result for a failure.
<!-- /port -->
<!-- port:swift -->
Call `try await server.killServer()` and handle a cleanup failure before returning.
<!-- /port -->

A restarted server can reuse a socket path while having different state. Do
not treat a matching path as proof that a cached object still exists.
