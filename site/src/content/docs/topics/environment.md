---
title: Environment
description: Locate tmux objects from process variables and manage the environment inherited by new panes.
sidebar:
  label: Environment
  group: Topics
  order: 9
tableOfContents: true
---

tmux exposes two environment APIs. Process variables such as `TMUX` and
`TMUX_PANE` let code inside a pane identify its server and pane. The server also
stores variables through `set-environment` and `show-environment` for new
processes to inherit. Like the tables in [Options and
hooks](../options-and-hooks/), this persistent store has explicit scopes.

## Locating yourself from inside a pane

Inside a pane, `TMUX` contains `<socket path>,<server pid>,<session id>`, and
`TMUX_PANE` contains the pane ID, such as `%1`. Use these variables to locate
the current tmux objects. Ports expose different levels of environment lookup:

### Python

**Server:** `Server.from_env()`

**Session:** `Session.from_env()`

**Window:** `Window.from_env()`

**Pane:** `Pane.from_env()`

### TypeScript

**Server:** Not listed.

**Session:** `Session.fromEnv()`

**Window:** Not listed.

**Pane:** Not listed.

### Go

**Server:** `NewServerFromEnv(env)`

**Session:** `SessionFromEnv(ctx, env)`

**Window:** `WindowFromEnv(ctx, env)`

**Pane:** `PaneFromEnv(ctx, env)`

### Rust

**Server:** `Server::from_env()`

**Session:** `Session::from_env(&server)`

**Window:** `Window::from_env(&server)`

**Pane:** `Pane::from_env(&server)`

### Java

**Server:** Not listed.

**Session:** Not listed.

**Window:** Not listed.

**Pane:** See the Java context example below.

### .NET

**Server:** `Server.FromEnvironment(env)`

**Session:** `Session.FromEnvironmentAsync()`

**Window:** `Window.FromEnvironmentAsync()`

**Pane:** `Pane.FromEnvironmentAsync()`

### C++

**Server:** `Server::from_env()`

**Session:** Not listed.

**Window:** Not listed.

**Pane:** Not listed.

### Swift

**Server:** `TmuxContext.current()`

**Session:** `TmuxContext.current()` (same call: see below)

**Window:** Not listed.

**Pane:** Not listed.

### Examples

Python, Go, and .NET provide standalone environment lookups at each level.
Rust's `Session`, `Window`, and `Pane::from_env` require an existing `&Server`.
TypeScript provides `Session.fromEnv()`; this page lists no equivalent for its
other object types.

```python
Pane.from_env().pane_id
Window.from_env().window_id
Session.from_env().session_id
Server.from_env().sessions
```

```typescript
const session = await Session.fromEnv();
```

```go
pane, err := tmux.PaneFromEnv(ctx, nil) // nil reads the real process environment
window, err := tmux.WindowFromEnv(ctx, nil)
session, err := tmux.SessionFromEnv(ctx, nil)
server, err := tmux.NewServerFromEnv(nil)
```

```rust
let server = libtmux::Server::from_env()?;
let session = libtmux::Session::from_env(&server).await?; // Option<Session>
let window = libtmux::Window::from_env(&server).await?;
let pane = libtmux::Pane::from_env(&server).await?;
```

```csharp
Server server = Server.FromEnvironment(null);
Session session = await Session.FromEnvironmentAsync();
Window window = await Window.FromEnvironmentAsync();
Pane pane = await Pane.FromEnvironmentAsync();
```

A process not started inside a pane has nothing truthful to answer with, so
every one of these raises rather than guessing: Python's `NotInsideTmux`,
Go's `FromEnvError`, .NET's `TmuxObjectNotFoundException`, and so on, each
naming the missing or malformed variable rather than returning an empty or
default object.

### Java and C++ stop short of the pane

Neither port gives you a live object back the way the other five do, and
they stop at different points:

- **C++** provides `Server::from_env()` to select the socket. Use the resulting
  server to resolve sessions or panes.
- **Java** parses `TMUX` and `TMUX_PANE` into identifiers: socket path, server
  PID, `SessionId`, and `Optional<PaneId>`. It returns context data rather than
  a live pane handle:

  ```java
  TmuxEnvironment here = TmuxEnvironment.current().orElseThrow();

  try (Server server = Server.open(here.config())) {
      Session mine = server.sessions().stream()
              .filter(session -> session.id().equals(here.session()))
              .findFirst()
              .orElseThrow();
  }
  ```

<a id="swift-reads-less-than-it-could"></a>

### Swift context fields

Swift's `TmuxContext.current()` parses the socket path, server PID, and session
ID from `TMUX`. It does not read `TMUX_PANE`, so it cannot identify the current
pane:

```swift
let context = TmuxContext.current()! // socket path, server pid, session id
let server = try context.server()
```

Read `TMUX_PANE` separately if you need the pane ID; `TmuxContext` does not
provide it.

## tmux's own environment variable store

Like [Options and
hooks](../options-and-hooks/#window-and-pane-hook-scopes-are-mostly-fiction),
tmux's persistent environment store has global and per-session scopes. It is
read with `show-environment` and updated with `set-environment`. Newly spawned
processes inherit it; existing processes retain their own environments.

### Python

**Set:** `server.set_environment(name, value)`, `session.set_environment(...)`

**Read all:** `server.show_environment()`, `session.show_environment()`

**Unset:** `server.unset_environment(name)`. See below for `.remove_environment()`.

### TypeScript

**Set:** `server.setEnvironment(name, value)`, `session.setEnvironment(...)`

**Read all:** `server.showEnvironment()`, `session.showEnvironment()`

**Unset:** `server.unsetEnvironment(name)`, `session.unsetEnvironment(name)`

### Go

**Set:** `server.SetEnvironment(ctx, name, value, opts)` (global, `-g`)

**Read all:** `server.ShowEnvironment(ctx)`

**Unset:** `server.UnsetEnvironment(ctx, name)`

### Rust

**Set:** `server.set_environment(...)`, `session.set_environment(...)`

**Read all:** `server.environment_all()`, `session.environment_all()`

**Unset:** `server.unset_environment(name)`, `session.unset_environment(name)`

### Java

**Set:** Not documented here; see the Java and C++ note below.

**Read all:** Not documented here; see the Java and C++ note below.

**Unset:** Not documented here; see the Java and C++ note below.

### .NET

**Set:** `server.Environment.SetAsync(name, value)`,
`session.Environment.SetAsync(...)`

**Read all:** `server.Environment.GetAllAsync()`

**Unset:** `server.Environment.UnsetAsync(name)`, `.RemoveAsync(name)`

### C++

**Set:** Not documented here; see the Java and C++ note below.

**Read all:** Not documented here; see the Java and C++ note below.

**Unset:** Not documented here; see the Java and C++ note below.

### Swift

**Set:** `server.setEnvironment(name, to: value, in: scope)`

**Read all:** `server.environment(scope)`

**Unset:** `server.unsetEnvironment(name, in: scope)`, `.removeEnvironment(name,
in:)`

### Examples

```python
server.set_environment("EDITOR", "vim")     # global
session.set_environment("EDITOR", "hx")     # this session only
session.show_environment()
```

```typescript
await server.setEnvironment("EDITOR", "vim");
await session.setEnvironment("EDITOR", "hx");
await session.showEnvironment();
```

```go
server.SetEnvironment(ctx, "EDITOR", "vim", tmux.SetEnvironmentOptions{})
session.SetEnvironment(ctx, "EDITOR", "hx", tmux.SetEnvironmentOptions{})
session.ShowEnvironment(ctx)
```

```rust
server.set_environment("EDITOR", "vim").await?;
session.set_environment("EDITOR", "hx").await?;
session.environment_all().await?;
```

```csharp
await server.Environment.SetAsync("EDITOR", "vim");
await session.Environment.SetAsync("EDITOR", "hx");
await session.Environment.GetAllAsync();
```

```swift
try await server.setEnvironment("EDITOR", to: "vim", in: .global)
try await server.setEnvironment("EDITOR", to: "hx", in: .session(session.id.rawValue))
try await server.environment(.session(session.id.rawValue))
```

Python's `set_environment` writes a value, and `unset_environment` (`-u`)
removes the entry. `remove_environment` (`-r`) marks the variable for exclusion
from new processes, including when tmux inherited it at server startup; the
listing retains it as `-NAME`. Swift exposes the same distinction through
`setEnvironment`, `unsetEnvironment`, and `removeEnvironment`. A remove
operation is not documented here for TypeScript, Go, or Rust.

### Java and C++: no verified access to this table at all

Java and C++ examples here cover environment values supplied at process
creation, not reads or writes to an existing persistent table. Java's
`SessionSpec.Builder.environment(Map)`, `WindowSpec.Builder.environment(Map)`,
and `SplitSpec.Builder.environment(Map)` pass initial variables to `new-session
-e`, `new-window -e`, and `split-window -e`. Consult the port reference if you
need to change the environment of an existing session.
