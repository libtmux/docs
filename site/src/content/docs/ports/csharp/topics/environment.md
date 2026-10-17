---
port: csharp
route: topics/environment
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

**Server:** `Server.FromEnvironment(env)`

**Session:** `Session.FromEnvironmentAsync()`

**Window:** `Window.FromEnvironmentAsync()`

**Pane:** `Pane.FromEnvironmentAsync()`

### Examples

```csharp
Server server = Server.FromEnvironment(null);
Session session = await Session.FromEnvironmentAsync();
Window window = await Window.FromEnvironmentAsync();
Pane pane = await Pane.FromEnvironmentAsync();
```

Environment lookup requires valid tmux targeting variables. If your process
can run outside tmux, handle that case before using the result.

Handle `TmuxObjectNotFoundException` when the environment cannot identify an
object.

## tmux's own environment variable store

Like [Options and hooks](../options-and-hooks/),
tmux's persistent environment store has global and per-session scopes. It is
read with `show-environment` and updated with `set-environment`. Newly spawned
processes inherit it; existing processes retain their own environments.

**Set:** `server.Environment.SetAsync(name, value)`,
`session.Environment.SetAsync(...)`

**Read all:** `server.Environment.GetAllAsync()`

**Unset:** `server.Environment.UnsetAsync(name)`, `.RemoveAsync(name)`

### Examples

```csharp
await server.Environment.SetAsync("EDITOR", "vim");
await session.Environment.SetAsync("EDITOR", "hx");
await session.Environment.GetAllAsync();
```

`set-environment` writes a value. Its `-u` flag removes the entry, while `-r`
marks the variable for exclusion from new processes, including values tmux
inherited at startup. The listing retains an excluded variable as `-NAME`.

Use `.UnsetAsync` for `-u`, or `.RemoveAsync` for `-r`.
