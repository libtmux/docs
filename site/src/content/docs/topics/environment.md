---
title: Environment
description: Two different things tmux calls "environment" — the OS variables it writes into every pane, and its own persistent variable store — and how each port reaches both.
sidebar:
  label: Environment
  group: Topics
  order: 9
tableOfContents: true
---

tmux uses the word "environment" for two genuinely different things, and a
port's API keeps them as separate as tmux does: the ordinary OS process
environment tmux writes into every pane it spawns, and tmux's *own*
persistent variable store — set with `set-environment`, read with
`show-environment` — that a new pane inherits but which lives in the server,
not in any one process's memory. The first is how code running inside a pane
finds its way back to the server that launched it; the second is a small,
scoped configuration surface, structurally the twin of the hooks tables in
[Options and hooks](../options-and-hooks/).

## Locating yourself from inside a pane

tmux exports two variables into every pane it spawns: `TMUX`
(`<socket path>,<server pid>,<session id>`) and `TMUX_PANE` (that pane's own
id, e.g. `%1`). Code that is *running inside* a pane — a script launched in a
split, a hook, a test harness — reads them back to get a handle on itself,
rather than searching the whole server for a pane it already is. Every port
gives you some form of this, but they stop at different levels of the
hierarchy:

| Port | Server | Session | Window | Pane |
|------|:------:|:-------:|:------:|:----:|
| Python | `Server.from_env()` | `Session.from_env()` | `Window.from_env()` | `Pane.from_env()` |
| TypeScript | — | `Session.fromEnv()` | — | — |
| Go | `NewServerFromEnv(env)` | `SessionFromEnv(ctx, env)` | `WindowFromEnv(ctx, env)` | `PaneFromEnv(ctx, env)` |
| Rust | `Server::from_env()` | `Session::from_env(&server)` | `Window::from_env(&server)` | `Pane::from_env(&server)` |
| Java | — | — | — | — (see below) |
| .NET | `Server.FromEnvironment(env)` | `Session.FromEnvironmentAsync()` | `Window.FromEnvironmentAsync()` | `Pane.FromEnvironmentAsync()` |
| C++ | `Server::from_env()` | — | — | — |
| Swift | `TmuxContext.current()` | `TmuxContext.current()` (same call — see below) | — | — |

Python, Go, and .NET give every level its own standalone call. Rust's
`Session`/`Window`/`Pane::from_env` take `&Server` as a parameter — you
already need a `Server` handle before asking any of them where you are,
where Python's, Go's, and .NET's `Pane`-level call needs nothing but the
environment. TypeScript verifiably has only `Session.fromEnv()`; no
`Pane`, `Window`, or `Server` equivalent was found in its source.

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

- **C++** has `Server::from_env()` and nothing past it — no verified
  `Session`, `Window`, or `Pane::from_env()` reading `TMUX_PANE` exists in
  the source for this page. Getting to your own pane means resolving
  `TMUX_PANE` yourself and looking it up through the server `from_env()`
  gave you.
- **Java** goes the other direction: `TmuxEnvironment.current()` parses both
  `TMUX` and `TMUX_PANE` fully, but hands back plain identifiers — a socket
  path, a server pid, a `SessionId`, an `Optional<PaneId>` — not a live
  `Session` or `Pane`. Resolving one of those ids into an object you can call
  methods on is a lookup you write yourself, shown in the class's own
  Javadoc example:

  ```java
  TmuxEnvironment here = TmuxEnvironment.current().orElseThrow();

  try (Server server = Server.open(here.config())) {
      Session mine = server.sessions().stream()
              .filter(session -> session.id().equals(here.session()))
              .findFirst()
              .orElseThrow();
  }
  ```

### Swift reads less than it could

`TmuxContext.current()` parses `$TMUX` only — socket path, server pid,
session id — and never reads `TMUX_PANE` at all, so it cannot name the pane
or window a Swift process is running in, only the server and session:

```swift
let context = TmuxContext.current()! // socket path, server pid, session id
let server = try context.server()
```

Getting from there to the actual pane a script is running in is not covered
by anything in `TmuxContext` — a real, verified gap rather than an
overlooked accessor, since `TMUX_PANE` is simply never read.

## tmux's own environment variable store

Separately from the OS process environment above, tmux keeps a persistent
table of variables set with `set-environment` and read with
`show-environment` — inherited by new panes tmux spawns, but not the same
thing as any process's actual environment at any given moment. Like hooks
([Options and hooks](../options-and-hooks/#window-and-pane-hook-scopes-are-mostly-fiction)),
tmux keeps exactly **two** of these tables — global and per-session — and
unlike hooks, no port even offers a window or pane scope to get wrong: there
is no `-w`/`-p` flag for `set-environment` to begin with, so the trap that
section describes for hooks has no equivalent here. Swift's own doc comment
states the contrast directly: "tmux keeps two, and only two: one global, and
one per session... unlike `OptionScope`, whose four tables are all real."

| Port | Set | Read all | Unset |
|------|-----|----------|-------|
| Python | `server.set_environment(name, value)`, `session.set_environment(...)` | `server.show_environment()`, `session.show_environment()` | `server.unset_environment(name)` (also `.remove_environment()` — see note below) |
| TypeScript | `server.setEnvironment(name, value)`, `session.setEnvironment(...)` | `server.showEnvironment()`, `session.showEnvironment()` | `server.unsetEnvironment(name)`, `session.unsetEnvironment(name)` |
| Go | `server.SetEnvironment(ctx, name, value, opts)` (global, `-g`) | `server.ShowEnvironment(ctx)` | `server.UnsetEnvironment(ctx, name)` |
| Rust | `server.set_environment(...)`, `session.set_environment(...)` | `server.environment_all()`, `session.environment_all()` | `server.unset_environment(name)`, `session.unset_environment(name)` |
| Java | not found — see below | not found — see below | not found — see below |
| .NET | `server.Environment.SetAsync(name, value)`, `session.Environment.SetAsync(...)` | `server.Environment.GetAllAsync()` | `server.Environment.UnsetAsync(name)`, `.RemoveAsync(name)` |
| C++ | not found — see below | not found — see below | not found — see below |
| Swift | `server.setEnvironment(name, to: value, in: scope)` | `server.environment(scope)` | `server.unsetEnvironment(name, in: scope)`, `.removeEnvironment(name, in:)` |

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

Python's model is worth a specific note: `set_environment` writes a value,
`unset_environment` (`-u`) removes it from the listing outright, and
`remove_environment` (`-r`) is a third, different operation — it marks the
name so *new* processes start without it, even if it was inherited from
tmux's own environment when the server started, while still listing it (as
`-NAME`) rather than making it disappear. Swift keeps the same three-way
split explicitly (`setEnvironment`, `unsetEnvironment`, `removeEnvironment`)
with a doc comment spelling out exactly this distinction; TypeScript's,
Go's, and Rust's tables above show only set/read/unset because a `-r`-shaped
remove wasn't verified in their source for this page — treat its absence
from those rows as unverified, not as confirmed missing.

### Java and C++: no verified access to this table at all

Neither port's main source exposes `set-environment` or `show-environment`
under any name for this page. Both do let you seed a *new* pane, window, or
session's environment at spawn time — Java's `SessionSpec.Builder.
environment(Map)`, `WindowSpec.Builder.environment(Map)`, and
`SplitSpec.Builder.environment(Map)` all set initial variables passed to
`new-session -e` / `new-window -e` / `split-window -e` — but that is a
one-shot value handed to a single spawning command, not a read/write handle
on the persistent table `show-environment` reads back. If your program needs
to read or change that table on an existing session in Java or C++, this
page found no way to do it through either library.
