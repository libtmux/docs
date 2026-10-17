---
port: java
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

`ServerEndpoint.defaultSocket()` selects the default socket.
`ServerEndpoint.namedSocket("work")` selects a named socket, and
`ServerEndpoint.socketPath(path)` selects an explicit path.

```java
ServerConfig config = ServerConfig.builder()
        .endpoint(ServerEndpoint.namedSocket("work"))
        .build();
Server named = Server.open(config);
```

Choose either a socket name or a socket path. tmux uses `TMUX_TMPDIR` to
resolve the directory for default and named sockets.

## Is the server actually there?

A server handle does not prove that the target server is running. Use a liveness
check when your program needs to distinguish a live server from an unavailable
socket:

`Server.isAlive` returns a boolean.

```java
if (server.isAlive()) {
    server.sessions();
}
```

## Killing a server, and telling two apart

Killing a server ends all its sessions. Use this only for a server your program
owns; for narrower cleanup, kill the session or pane you created.

Call `server.killServer()` to stop tmux. `Server.close()` releases the local
connection and leaves tmux running; see [Ownership and cleanup](../context-managers/).

A restarted server can reuse a socket path while having different state. Do
not treat a matching path as proof that a cached object still exists.
