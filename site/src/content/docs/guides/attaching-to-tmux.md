---
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

Attaching your terminal is a separate operation. Python's `Session.attach()`
runs `tmux attach-session` and hands the terminal to tmux.
[tmuxp](https://tmuxp.git-pull.com/) uses it after building a workspace. Check
your port's reference if your program needs to hand over the terminal.

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
// Behaves like the other ports' bare form. Naming a socket wasn't confirmed
// against a checked snippet for this page: check the port's own reference.
const server = new Server();
```

```go
// Resolves the tmux binary once through the snapshotted PATH and freezes
// it. SocketName and SocketPath select a socket explicitly (SocketPath wins
// if both are set); a Server built this way does not drift if the
// environment changes later.
server, err := tmux.NewServer(tmux.ServerOptions{})
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
Server fromPane = await Server.FromEnvironment();
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
// The literal quickstart: there is no bare no-argument constructor, so
// naming the socket is not optional the way it is elsewhere.
let server = try Server(socketName: "default")
```

Sources: Python's `Server.from_env()` is doctested in `src/libtmux/server.py`
(`pyproject.toml` `testpaths`). .NET's resolution order and `FromEnvironment`
are from `src/LibTmux/README.md` ("Where a bare connect lands"), one of the
nine documents `ReadmeExampleTests` compiles and runs. Go's is
`tmux/server_options.go`'s doc comments. Rust's fallback is
`crates/libtmux/examples/find.rs`, run via `cargo run --example find`. C++'s
four constructors are the README's own description of `Server`, at the top
of "What is libtmux?". Swift's is `README.md`'s top-level quickstart,
matched against `Examples/Sources/QuickStart/main.swift` by
`Scripts/check_examples.py`. Java's is `README.md`, run by
[`docs-tests`](../testing-with-libtmux/#java-docs-tests).

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

Sources: Go uses `examples/filter-query/main.go`, region `docs:query-in-tmux`.
Java uses `examples/.../BuildAWorkspace.java`, run by the examples module's
tests. For exactly-one lookup semantics, see [Filtering and querying, in
practice](../querying-and-filtering/). Swift uses
`Examples/Sources/ExampleCode/Querying.swift`, checked against the README by
`Scripts/check_examples.py` and exercised by
`Examples/Tests/ExampleTests/ModeTests.swift`.

.NET exposes `Server.HasSessionAsync(name)` in
`src/LibTmux/Server.Lifecycle.cs`. Its `CreateSessionAsync` supports
`ReplaceExisting`, which kills and recreates the session. Rust and C++ provide
query APIs for session lookup. See [Filtering and querying, in
practice](../querying-and-filtering/) and the port references for the call
signatures; this page has no tested excerpt for those combinations.

## Where to go next

- [Sending keys](../sending-keys/) and [Capturing output](../capturing-output/)
  pick up once you have a pane handle.
- [Attach and send keys](/examples/attach-and-send-keys/) has the full,
  sourced code for the round trip this guide assumes.
- [Testing with libtmux](../testing-with-libtmux/) if the server you want to
  attach to is one your own test suite should own and tear down.
