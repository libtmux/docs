---
port: csharp
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

`new ServerConnectionOptions()` selects the default socket. Supply
`socketName` for a named socket or `socketPath` for an explicit path.

```csharp
using LibTmux;

Server named = await Server.ConnectAsync(new ServerConnectionOptions(socketName: "work"));
```

Choose either a socket name or a socket path. tmux uses `TMUX_TMPDIR` to
resolve the directory for default and named sockets.

`ServerConnectionOptions(socketNameFactory: ...)` accepts a callable that
generates socket names. Use a unique name for each isolated test server.

## Is the server actually there?

A server handle does not prove that the target server is running. Use a liveness
check when your program needs to distinguish a live server from an unavailable
socket:

`Server.IsAliveAsync` returns `Task<bool>`.

```csharp
if (await server.IsAliveAsync())
{
    await server.GetSessionsAsync();
}
```

## Killing a server, and telling two apart

Killing a server ends all its sessions. Use this only for a server your program
owns; for narrower cleanup, kill the session or pane you created.

Call `await server.KillAsync()` and handle a cleanup failure before returning.

A restarted server can reuse a socket path while having different state. Do
not treat a matching path as proof that a cached object still exists.
