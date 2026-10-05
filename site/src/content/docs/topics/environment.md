---
supportedPorts: [py, ts, rs, go, java, csharp, cxx, swift]
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
the current tmux objects. Select the object your operation needs:

<!-- port:py -->
<!-- port:root -->
### Python
<!-- /port -->

**Server:** `Server.from_env()`

**Session:** `Session.from_env()`

**Window:** `Window.from_env()`

**Pane:** `Pane.from_env()`
<!-- /port -->

<!-- port:ts -->
<!-- port:root -->
### TypeScript
<!-- /port -->

**Server:** Not listed.

**Session:** `Session.fromEnv()`

**Window:** Not listed.

**Pane:** Not listed.
<!-- /port -->

<!-- port:go -->
<!-- port:root -->
### Go
<!-- /port -->

**Server:** `NewServerFromEnv(env)`

**Session:** `SessionFromEnv(ctx, env)`

**Window:** `WindowFromEnv(ctx, env)`

**Pane:** `PaneFromEnv(ctx, env)`
<!-- /port -->

<!-- port:rs -->
<!-- port:root -->
### Rust
<!-- /port -->

**Server:** `Server::from_env()`

**Session:** `Session::from_env(&server)`

**Window:** `Window::from_env(&server)`

**Pane:** `Pane::from_env(&server)`
<!-- /port -->

<!-- port:java -->
<!-- port:root -->
### Java
<!-- /port -->

**Server:** Not listed.

**Session:** Not listed.

**Window:** Not listed.

**Pane:** See the Java context example below.
<!-- /port -->

<!-- port:csharp -->
<!-- port:root -->
### C#
<!-- /port -->

**Server:** `Server.FromEnvironment(env)`

**Session:** `Session.FromEnvironmentAsync()`

**Window:** `Window.FromEnvironmentAsync()`

**Pane:** `Pane.FromEnvironmentAsync()`
<!-- /port -->

<!-- port:cxx -->
<!-- port:root -->
### C++
<!-- /port -->

**Server:** `Server::from_env()`

**Session:** Not listed.

**Window:** Not listed.

**Pane:** Not listed.
<!-- /port -->

<!-- port:swift -->
<!-- port:root -->
### Swift
<!-- /port -->

**Server:** `TmuxContext.current()`

**Session:** `TmuxContext.current()` (same call: see below)

**Window:** Not listed.

**Pane:** Not listed.
<!-- /port -->

### Examples

<!-- port:rs -->
`Session`, `Window`, and `Pane::from_env` require an existing `&Server`.
<!-- /port -->
<!-- port:ts -->
Use `Session.fromEnv()` to resolve the session of the current process.
<!-- /port -->

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
pane, err := tmux.PaneFromEnv(ctx, nil)
if err != nil {
    return err
}
fmt.Println("current pane:", pane.ID())
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

Environment lookup requires valid tmux targeting variables. If your process
can run outside tmux, handle that case before using the result.

<!-- port:py -->
`NotInsideTmux` reports a missing or invalid tmux environment.
<!-- /port -->
<!-- port:go -->
Check the returned `error`. A `FromEnvError` identifies a missing or malformed
variable. Passing `nil` reads the process environment; pass an explicit map to
resolve a captured environment.
<!-- /port -->
<!-- port:csharp -->
Handle `TmuxObjectNotFoundException` when the environment cannot identify an
object.
<!-- /port -->

<!-- port:cxx -->
<a id="java-and-c-stop-short-of-the-pane"></a>

### Resolve the server socket

`Server::from_env()` selects the socket. Use the resulting server to resolve
sessions or panes.
<!-- /port -->

<!-- port:java -->
### Resolve context identifiers

`TmuxEnvironment` parses `TMUX` and `TMUX_PANE` into identifiers: socket path, server
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
<!-- /port -->

<!-- port:swift -->
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
<!-- /port -->

## tmux's own environment variable store

Like [Options and hooks](../options-and-hooks/),
tmux's persistent environment store has global and per-session scopes. It is
read with `show-environment` and updated with `set-environment`. Newly spawned
processes inherit it; existing processes retain their own environments.

<!-- port:py -->
<!-- port:root -->
### Python
<!-- /port -->

**Set:** `server.set_environment(name, value)`, `session.set_environment(...)`

**Read all:** `server.show_environment()`, `session.show_environment()`

**Unset:** `server.unset_environment(name)`. See below for `.remove_environment()`.
<!-- /port -->

<!-- port:ts -->
<!-- port:root -->
### TypeScript
<!-- /port -->

**Set:** `server.setEnvironment(name, value)`, `session.setEnvironment(...)`

**Read all:** `server.showEnvironment()`, `session.showEnvironment()`

**Unset:** `server.unsetEnvironment(name)`, `session.unsetEnvironment(name)`
<!-- /port -->

<!-- port:go -->
<!-- port:root -->
### Go
<!-- /port -->

**Set:** `server.SetEnvironment(ctx, name, value, opts)` (global, `-g`)

**Read all:** `server.ShowEnvironment(ctx)`

**Unset:** `server.UnsetEnvironment(ctx, name)`
<!-- /port -->

<!-- port:rs -->
<!-- port:root -->
### Rust
<!-- /port -->

**Set:** `server.set_environment(...)`, `session.set_environment(...)`

**Read all:** `server.environment_all()`, `session.environment_all()`

**Unset:** `server.unset_environment(name)`, `session.unset_environment(name)`
<!-- /port -->

<!-- port:java -->
<!-- port:root -->
### Java
<!-- /port -->

**Set:** Not documented here; see the process-environment note below.

**Read all:** Not documented here; see the process-environment note below.

**Unset:** Not documented here; see the process-environment note below.
<!-- /port -->

<!-- port:csharp -->
<!-- port:root -->
### C#
<!-- /port -->

**Set:** `server.Environment.SetAsync(name, value)`,
`session.Environment.SetAsync(...)`

**Read all:** `server.Environment.GetAllAsync()`

**Unset:** `server.Environment.UnsetAsync(name)`, `.RemoveAsync(name)`
<!-- /port -->

<!-- port:cxx -->
<!-- port:root -->
### C++
<!-- /port -->

**Set:** Not documented here; see the process-environment note below.

**Read all:** Not documented here; see the process-environment note below.

**Unset:** Not documented here; see the process-environment note below.
<!-- /port -->

<!-- port:swift -->
<!-- port:root -->
### Swift
<!-- /port -->

**Set:** `server.setEnvironment(name, to: value, in: scope)`

**Read all:** `server.environment(scope)`

**Unset:** `server.unsetEnvironment(name, in: scope)`, `.removeEnvironment(name,
in:)`
<!-- /port -->

<!-- port:py,ts,go,rs,csharp,swift -->
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
if err := session.SetEnvironment(ctx, "EDITOR", "hx", tmux.SetEnvironmentOptions{}); err != nil {
    return err
}
values, err := session.ShowEnvironment(ctx)
if err != nil {
    return err
}
fmt.Println(values)
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

<!-- /port -->

`set-environment` writes a value. Its `-u` flag removes the entry, while `-r`
marks the variable for exclusion from new processes, including values tmux
inherited at startup. The listing retains an excluded variable as `-NAME`.

<!-- port:py -->
Use `unset_environment` for `-u`, or `remove_environment` for `-r`.
<!-- /port -->
<!-- port:swift -->
Use `unsetEnvironment` for `-u`, or `removeEnvironment` for `-r`.
<!-- /port -->
<!-- port:csharp -->
Use `.UnsetAsync` for `-u`, or `.RemoveAsync` for `-r`.
<!-- /port -->

<!-- port:java -->
<a id="java-and-c-no-verified-access-to-this-table-at-all"></a>

### Process environment

`SessionSpec.Builder.environment(Map)`, `WindowSpec.Builder.environment(Map)`,
and `SplitSpec.Builder.environment(Map)` pass initial variables to
`new-session -e`, `new-window -e`, and `split-window -e`. These creation options
do not change the stored environment of an existing session.
<!-- /port -->
<!-- port:cxx -->
### Process environment

Creation-time environment values affect the new process. They do not update
an existing process's environment. To change tmux's persistent table, use
`set-environment` on the same socket as the server handle.
<!-- /port -->
