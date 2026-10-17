---
port: ts
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

`new Server()` selects the default socket. Set `socketName` to select
a named socket, or `socketPath` to use an explicit path.

```typescript
const named = new Server({ socketName: "work" });
```

Choose either a socket name or a socket path. tmux uses `TMUX_TMPDIR` to
resolve the directory for default and named sockets.

Supplying both selectors raises `TypeError`.

## Is the server actually there?

A server handle does not prove that the target server is running. Use a liveness
check when your program needs to distinguish a live server from an unavailable
socket:

`Server.isAlive` returns a promise of a boolean. `Server.raiseIfDead`
throws when the server is unavailable and retains the reason reported by tmux.

```typescript
if (await server.isAlive()) {
  await server.snapshot();
}
```

`isAlive()` returns a boolean. Use `raiseIfDead()` when you need failure details.

## Killing a server, and telling two apart

Killing a server ends all its sessions. Use this only for a server your program
owns; for narrower cleanup, kill the session or pane you created.

Call `await server.kill()`. `TmuxServerRestartedError` reports an operation
whose handle encountered a replacement daemon on the same socket.

A restarted server can reuse a socket path while having different state. Do
not treat a matching path as proof that a cached object still exists.
