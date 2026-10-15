---
port: py
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

`Server()` selects the default socket. Pass `socket_name="work"` to
select a named socket, or `socket_path="/tmp/tmux-1000/work"` for an
explicit path.

```python
default_server = libtmux.Server()
named = libtmux.Server(socket_name="work")
```

Choose either a socket name or a socket path. tmux uses `TMUX_TMPDIR` to
resolve the directory for default and named sockets.

`Server(socket_name_factory=...)` accepts a callable that generates socket
names. Use a unique name for each isolated test server.

## Is the server actually there?

A server handle does not prove that the target server is running. Use a liveness
check when your program needs to distinguish a live server from an unavailable
socket:

`Server.is_alive` returns a boolean indicating whether the server
responds.

```python
if server.is_alive():
    server.sessions
```

## Killing a server, and telling two apart

Killing a server ends all its sessions. Use this only for a server your program
owns; for narrower cleanup, kill the session or pane you created.

Call `server.kill_server()`. `Server.__eq__` compares `socket_name` and
`socket_path` when deciding whether two handles select the same endpoint.

A restarted server can reuse a socket path while having different state. Do
not treat a matching path as proof that a cached object still exists.
