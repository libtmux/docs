---
port: rs
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
hooks](../options-and-hooks/), this persistent store has explicit scopes. The
async calls below use `libtmux_tokio`.

## Locating yourself from inside a pane

Inside a pane, `TMUX` contains `<socket path>,<server pid>,<session id>`, and
`TMUX_PANE` contains the pane ID, such as `%1`. Use these variables to locate
the current tmux objects. Select the object your operation needs:

**Server:** [`Server::from_env()`](../../reference/libtmux_tokio-server-server-from_env/)

**Session:** [`Session::from_env(&server)`](../../reference/libtmux_tokio-session-session-from_env/)

**Window:** [`Window::from_env(&server)`](../../reference/libtmux_tokio-window-window-from_env/)

**Pane:** [`Pane::from_env(&server)`](../../reference/libtmux_tokio-pane-pane-from_env/)

### Examples

[`Session`](../../reference/libtmux_tokio-session-session/), [`Window`](../../reference/libtmux_tokio-window-window/), and [`Pane::from_env`](../../reference/libtmux_tokio-pane-pane-from_env/) require an existing `&Server`.

```rust
let server = libtmux_tokio::Server::from_env()?;
let session = libtmux_tokio::Session::from_env(&server).await?; // Option<Session>
let window = libtmux_tokio::Window::from_env(&server).await?;
let pane = libtmux_tokio::Pane::from_env(&server).await?;
```

Environment lookup requires valid tmux targeting variables. If your process
can run outside tmux, handle that case before using the result.

## tmux's own environment variable store

Like [Options and hooks](../options-and-hooks/),
tmux's persistent environment store has global and per-session scopes. It is
read with `show-environment` and updated with `set-environment`. Newly spawned
processes inherit it; existing processes retain their own environments.

**Set:** [`server.set_environment(...)`](../../reference/libtmux_tokio-server-server-set_environment/), [`session.set_environment(...)`](../../reference/libtmux_tokio-session-session-set_environment/)

**Read all:** [`server.environment_all()`](../../reference/libtmux_tokio-server-server-environment_all/), [`session.environment_all()`](../../reference/libtmux_tokio-session-session-environment_all/)

**Unset:** [`server.unset_environment(name)`](../../reference/libtmux_tokio-server-server-unset_environment/), [`session.unset_environment(name)`](../../reference/libtmux_tokio-session-session-unset_environment/)

### Examples

```rust
server.set_environment("EDITOR", "vim").await?;
session.set_environment("EDITOR", "hx").await?;
session.environment_all().await?;
```

`set-environment` writes a value. Its `-u` flag removes the entry, while `-r`
marks the variable for exclusion from new processes, including values tmux
inherited at startup. The listing retains an excluded variable as `-NAME`.
