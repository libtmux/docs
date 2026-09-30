---
supportedPorts: [py, ts, rs, go, java, dotnet, cxx, swift]
title: Attaching to tmux
description: What a plain constructor call actually connects to, and how to find a session that might already exist instead of always creating a new one.
sidebar:
  label: Attaching to tmux
  group: Guides
  order: 3
tableOfContents: true
---

Obtain a server and session handle to control tmux from your program. Your
process keeps its own stdin and stdout, and tmux continues running
independently. [Attach and send keys](/examples/attach-and-send-keys/)
demonstrates this workflow.

<!-- port:py -->
Attaching your terminal is a separate operation. Python's `Session.attach()`
runs `tmux attach-session` and hands the terminal to tmux.
[tmuxp](https://tmuxp.git-pull.com/) uses it after building a workspace. Check
your port's reference if your program needs to hand over the terminal.
<!-- /port -->

## Which socket a bare constructor reaches

Use an explicit socket when several tmux servers may be running. The examples
below show each constructor's defaults and environment-aware alternatives. To
locate the server from inside a pane, use the port's environment lookup API for
`TMUX` and `TMUX_PANE`.

```python
# Server() with no arguments talks to tmux's own default socket.
# Server(socket_name=...) or Server(socket_path=...) pick a different one.
server = libtmux.Server()

# from_env() is also on Session, Window, and Pane, for code running inside a
# pane that wants to ask "where am I" instead of being told.
server = libtmux.Server.from_env()
```

```typescript
// Select the default tmux socket.
const server = new Server();
```

```go
// Resolves the tmux binary once through the snapshotted PATH and freezes
// it. SocketName and SocketPath select a socket explicitly (SocketPath wins
// if both are set); a Server built this way does not drift if the
// environment changes later.
server, err := tmux.NewServer(tmux.ServerOptions{})
if err != nil {
    return err
}
```

```rust
// Server::new() uses the process's own environment. from_env() reads the
// TMUX variable directly; find.rs tries the pane-local one first and falls
// back to a fresh connection.
let server = Server::from_env().or_else(|_| Server::new())?;
```

```java
Server server = Server.open(
    ServerConfig.builder().endpoint(ServerEndpoint.socketPath(socket)).build());

// The pane-local read-back: takes nothing, returns empty outside a pane.
TmuxEnvironment.current();
```

```csharp
// Resolves in a fixed order: an explicit ServerConnectionOptions, then
// LIBTMUX_SOCKET_PATH, then LIBTMUX_SOCKET_NAME (under TMUX_TMPDIR, or
// /tmp), then the socket named "default". A named option always wins over
// an environment variable.
Server server = await Server.ConnectAsync();

// The separate pane-local read-back; ConnectAsync never consults TMUX.
Server fromPane = Server.FromEnvironment();
```

```cpp
// Four named constructors instead of one flexible one: pick the one that
// names how you're reaching this tmux:
libtmux::Server::from_env();          // inside tmux
libtmux::Server::at_socket_name(name);
libtmux::Server::at_socket_path(path);
libtmux::Server::at_default();        // "my tmux", to a person
```

```swift
// Select the default tmux socket explicitly.
let server = try Server(socketName: "default")
```

[Socket and servers](/topics/socket-and-servers/) covers endpoint selection
and liveness. [Environment](/topics/environment/) covers pane-local lookup.

## Finding a session instead of always creating one

A script that runs more than once usually wants "attach if a session by
this name already exists, create it otherwise," not a fresh session every
time.

```python
# default only stands in for *absence*: an ambiguous match still raises
# MultipleObjectsReturned even with a default supplied: handing back an
# arbitrary match from several is how a script ends up driving the wrong
# pane. See Filtering and queries.
session = server.sessions.get(session_name="demo", default=None)
if session is None:
    session = server.new_session(session_name="demo")
```

```typescript
const session = snapshot.sessions.where({ name: "demo" }).oneOrUndefined();
```

```go
// Push the check into tmux itself with a typed filter, rather than reading
// everything back and filtering in the process.
live := tmux.TmuxFilter("#{==:#{session_name},demo}")
sessions, err := server.SearchSessions(ctx, &live)
if err != nil {
    return err
}
fmt.Println("matching sessions:", len(sessions))
```

```java
Session session = server.hasSession("work")
        ? server.sessions().stream()
                .filter(candidate -> candidate.name().equals("work"))
                .findFirst()
                .orElseThrow()
        : server.newSession("work");
```

```swift
// hasSession answers the question directly as a Bool, no exception needed
// either way.
if try await server.hasSession("work") == false {
    _ = try await server.newSession(named: "work", windowName: "start")
}
```

<!-- port:dotnet -->
`Server.HasSessionAsync(name)` checks for a session. Use `NewSessionRequest.ReplaceExisting`
with `Server.CreateSessionAsync` only when killing and recreating it is intended.
<!-- /port -->

Finding an object and creating one are separate operations. Another client
can change tmux state between them. Handle the creation error if the name was
taken after the lookup.

[Filtering and querying](../querying-and-filtering/) covers absent and
ambiguous matches. [Attach and send keys](/examples/attach-and-send-keys/)
contains complete programs and their source details.

## Where to go next

- [Sending keys](../sending-keys/) and [Capturing output](../capturing-output/)
  pick up once you have a pane handle.
- [Attach and send keys](/examples/attach-and-send-keys/) has the full,
  sourced code for the round trip this guide assumes.
- [Testing with libtmux](../testing-with-libtmux/) if the server you want to
  attach to is one your own test suite should own and tear down.
