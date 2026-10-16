---
port: go
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

**Server:** `NewServerFromEnv(env)`

**Session:** `SessionFromEnv(ctx, env)`

**Window:** `WindowFromEnv(ctx, env)`

**Pane:** `PaneFromEnv(ctx, env)`

### Examples

```go
pane, err := tmux.PaneFromEnv(ctx, nil)
if err != nil {
    return err
}
fmt.Println("current pane:", pane.ID())
```

Environment lookup requires valid tmux targeting variables. If your process
can run outside tmux, handle that case before using the result.

Check the returned `error`. A `FromEnvError` identifies a missing or malformed
variable. Passing `nil` reads the process environment; pass an explicit map to
resolve a captured environment.

## tmux's own environment variable store

Like [Options and hooks](../options-and-hooks/),
tmux's persistent environment store has global and per-session scopes. It is
read with `show-environment` and updated with `set-environment`. Newly spawned
processes inherit it; existing processes retain their own environments.

**Set:** `server.SetEnvironment(ctx, name, value, opts)` (global, `-g`)

**Read all:** `server.ShowEnvironment(ctx)`

**Unset:** `server.UnsetEnvironment(ctx, name)`

### Examples

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

`set-environment` writes a value. Its `-u` flag removes the entry, while `-r`
marks the variable for exclusion from new processes, including values tmux
inherited at startup. The listing retains an excluded variable as `-NAME`.
