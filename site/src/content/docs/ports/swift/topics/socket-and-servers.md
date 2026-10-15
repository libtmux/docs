---
port: swift
route: topics/socket-and-servers
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

Select a named socket with `Server(socketName: "work")` or an
explicit path with `Server(socketPath: path)`. The initializer requires
a socket selection; see the default-socket example below.

```swift
let named = try Server(socketName: "work")
```

Choose either a socket name or a socket path. tmux uses `TMUX_TMPDIR` to
resolve the directory for default and named sockets.

Swift requires an explicit `socketPath` or `socketName` argument. To reach
tmux's default socket, use `Server(socketName: "default")`.

## Is the server actually there?

A server handle does not prove that the target server is running. Use a liveness
check when your program needs to distinguish a live server from an unavailable
socket:

`Server.isRunning` is an async throwing check that returns `Bool`.

```swift
if try await server.isRunning() {
    try await server.sessions()
}
```

## Killing a server, and telling two apart

Killing a server ends all its sessions. Use this only for a server your program
owns; for narrower cleanup, kill the session or pane you created.

Call `try await server.killServer()` and handle a cleanup failure before returning.

A restarted server can reuse a socket path while having different state. Do
not treat a matching path as proof that a cached object still exists.
