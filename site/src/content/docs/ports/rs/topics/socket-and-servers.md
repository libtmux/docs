---
port: rs
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
The examples below use `libtmux_tokio::Server`.

## Naming a server

[`Server::new()`](../../reference/libtmux_tokio-server-server-new/) selects the default socket. Use
[`Server::builder().socket_name("work").build()?`](../../reference/libtmux_tokio-server-server-builder/) for a named socket or
[`Server::builder().socket_path(path).build()?`](../../reference/libtmux_tokio-server-server-builder/) for an explicit path.

```rust
let named = libtmux_tokio::Server::builder().socket_name("work").build()?;
```

Choose either a socket name or a socket path. tmux uses `TMUX_TMPDIR` to
resolve the directory for default and named sockets.

## Is the server actually there?

A server handle does not prove that the target server is running. Use a liveness
check when your program needs to distinguish a live server from an unavailable
socket:

[`Server.is_alive`](../../reference/libtmux_tokio-server-server-is_alive/) returns a boolean. Use [`Server.check_alive`](../../reference/libtmux_tokio-server-server-check_alive/) when
you also need to distinguish a failed check from a server that is not alive.

```rust
if server.is_alive().await {
    server.sessions().await?;
}
```

`is_alive()` returns a boolean. Use `check_alive()` when you need failure
details.

## Killing a server, and telling two apart

Killing a server ends all its sessions. Use this only for a server your program
owns; for narrower cleanup, kill the session or pane you created.

Call [`server.kill().await?`](../../reference/libtmux_tokio-server-server-kill/) and handle a cleanup failure before returning.

A restarted server can reuse a socket path while having different state. Do
not treat a matching path as proof that a cached object still exists.
