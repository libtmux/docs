---
port: swift
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

**Server:** `TmuxContext.current()`

**Session:** `TmuxContext.current()` (same call: see below)

**Window:** Not listed.

**Pane:** Not listed.

### Examples

Environment lookup requires valid tmux targeting variables. If your process
can run outside tmux, handle that case before using the result.

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

Like [Options and hooks](../options-and-hooks/),
tmux's persistent environment store has global and per-session scopes. It is
read with `show-environment` and updated with `set-environment`. Newly spawned
processes inherit it; existing processes retain their own environments.

**Set:** `server.setEnvironment(name, to: value, in: scope)`

**Read all:** `server.environment(scope)`

**Unset:** `server.unsetEnvironment(name, in: scope)`, `.removeEnvironment(name,
in:)`

### Examples

```swift
try await server.setEnvironment("EDITOR", to: "vim", in: .global)
try await server.setEnvironment("EDITOR", to: "hx", in: .session(session.id.rawValue))
try await server.environment(.session(session.id.rawValue))
```

`set-environment` writes a value. Its `-u` flag removes the entry, while `-r`
marks the variable for exclusion from new processes, including values tmux
inherited at startup. The listing retains an excluded variable as `-NAME`.

Use `unsetEnvironment` for `-u`, or `removeEnvironment` for `-r`.
