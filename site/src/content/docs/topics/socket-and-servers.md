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
Choose the default socket, a named socket (`-L`), or an explicit path (`-S`).

## Naming a server

<!-- port:py -->
<!-- port:root -->
### Python
<!-- /port -->
`Server()` selects the default socket. Pass `socket_name="work"` to
select a named socket, or `socket_path="/tmp/tmux-1000/work"` for an
explicit path.
<!-- /port -->

<!-- port:ts -->
<!-- port:root -->
### TypeScript
<!-- /port -->
`new Server()` selects the default socket. Set `socketName` to select
a named socket, or `socketPath` to use an explicit path.
<!-- /port -->

<!-- port:go -->
<!-- port:root -->
### Go
<!-- /port -->
`tmux.NewServer(tmux.ServerOptions{})` selects the default socket.
Set `ServerOptions.SocketName` for a named socket or
`ServerOptions.SocketPath` for an explicit path.
<!-- /port -->

<!-- port:rs -->
<!-- port:root -->
### Rust
<!-- /port -->
`Server::new()` selects the default socket. Use
`Server::builder().socket_name("work").build()?` for a named socket or
`Server::builder().socket_path(path).build()?` for an explicit path.
<!-- /port -->

<!-- port:java -->
<!-- port:root -->
### Java
<!-- /port -->
`ServerEndpoint.defaultSocket()` selects the default socket.
`ServerEndpoint.namedSocket("work")` selects a named socket, and
`ServerEndpoint.socketPath(path)` selects an explicit path.
<!-- /port -->

<!-- port:csharp -->
<!-- port:root -->
### C#
<!-- /port -->
`new ServerConnectionOptions()` selects the default socket. Supply
`socketName` for a named socket or `socketPath` for an explicit path.
<!-- /port -->

<!-- port:cxx -->
<!-- port:root -->
### C++
<!-- /port -->
`Server::at_default()` selects the default socket. Use
`Server::at_socket_name("work")` for a named socket or
`Server::at_socket_path(path)` for an explicit path.
<!-- /port -->

<!-- port:swift -->
<!-- port:root -->
### Swift
<!-- /port -->
Select a named socket with `Server(socketName: "work")` or an
explicit path with `Server(socketPath: path)`. The initializer requires
a socket selection; see the default-socket example below.
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

<!-- port:py -->
<!-- port:root -->
### Python
<!-- /port -->
`Server.is_alive` returns a boolean indicating whether the server
responds.
<!-- /port -->

<!-- port:ts -->
<!-- port:root -->
### TypeScript
<!-- /port -->
`Server.isAlive` returns a promise of a boolean. `Server.raiseIfDead`
throws when the server is unavailable and retains the reason reported by tmux.
<!-- /port -->

<!-- port:go -->
<!-- port:root -->
### Go
<!-- /port -->
`Server.IsAlive` returns `(bool, error)`. The error reports a check
that could not be completed; a false result alone means the server is not alive.
<!-- /port -->

<!-- port:rs -->
<!-- port:root -->
### Rust
<!-- /port -->
`Server.is_alive` returns a boolean. Use `Server.check_alive` when
you also need to distinguish a failed check from a server that is not alive.
<!-- /port -->

<!-- port:java -->
<!-- port:root -->
### Java
<!-- /port -->
`Server.isAlive` returns a boolean.
<!-- /port -->

<!-- port:csharp -->
<!-- port:root -->
### C#
<!-- /port -->
`Server.IsAliveAsync` returns `Task<bool>`.
<!-- /port -->

<!-- port:cxx -->
<!-- port:root -->
### C++
<!-- /port -->
`Server.is_alive` takes a timeout and returns a boolean.
<!-- /port -->

<!-- port:swift -->
<!-- port:root -->
### Swift
<!-- /port -->
`Server.isRunning` is an async throwing check that returns `Bool`.
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
