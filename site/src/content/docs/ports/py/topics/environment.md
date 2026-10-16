---
port: py
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

**Server:** `Server.from_env()`

**Session:** `Session.from_env()`

**Window:** `Window.from_env()`

**Pane:** `Pane.from_env()`

### Examples

```python
Pane.from_env().pane_id
Window.from_env().window_id
Session.from_env().session_id
Server.from_env().sessions
```

Environment lookup requires valid tmux targeting variables. If your process
can run outside tmux, handle that case before using the result.

`NotInsideTmux` reports a missing or invalid tmux environment.

## tmux's own environment variable store

Like [Options and hooks](../options-and-hooks/),
tmux's persistent environment store has global and per-session scopes. It is
read with `show-environment` and updated with `set-environment`. Newly spawned
processes inherit it; existing processes retain their own environments.

**Set:** `server.set_environment(name, value)`, `session.set_environment(...)`

**Read all:** `server.show_environment()`, `session.show_environment()`

**Unset:** `server.unset_environment(name)`. See below for `.remove_environment()`.

### Examples

```python
server.set_environment("EDITOR", "vim")     # global
session.set_environment("EDITOR", "hx")     # this session only
session.show_environment()
```

`set-environment` writes a value. Its `-u` flag removes the entry, while `-r`
marks the variable for exclusion from new processes, including values tmux
inherited at startup. The listing retains an excluded variable as `-NAME`.

Use `unset_environment` for `-u`, or `remove_environment` for `-r`.
