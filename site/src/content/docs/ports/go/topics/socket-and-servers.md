---
port: go
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

`tmux.NewServer(tmux.ServerOptions{})` selects the default socket.
Set `ServerOptions.SocketName` for a named socket or
`ServerOptions.SocketPath` for an explicit path.

```go
named, err := tmux.NewServer(tmux.ServerOptions{SocketName: "work"})
if err != nil {
    return err
}
```

Choose either a socket name or a socket path. tmux uses `TMUX_TMPDIR` to
resolve the directory for default and named sockets.

`ServerOptions.SocketPath` takes precedence over `ServerOptions.SocketName` when both are set.

## Is the server actually there?

A server handle does not prove that the target server is running. Use a liveness
check when your program needs to distinguish a live server from an unavailable
socket:

`Server.IsAlive` returns `(bool, error)`. The error reports a check
that could not be completed; a false result alone means the server is not alive.

```go
alive, err := server.IsAlive(ctx)
if err != nil {
    return err
}
fmt.Println("server running:", alive)
```

## Killing a server, and telling two apart

Killing a server ends all its sessions. Use this only for a server your program
owns; for narrower cleanup, kill the session or pane you created.

Call `server.Kill(ctx)` and check its error. `server.Equal(other)` compares
the captured socket bindings, resolving relative paths and environment-based
socket names. Equal endpoints do not prove equal daemon lifetimes.
`ErrDaemonReplaced` reports a replacement daemon on the selected socket.

A restarted server can reuse a socket path while having different state. Do
not treat a matching path as proof that a cached object still exists.
