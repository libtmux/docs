---
port: cxx
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

**Server:** `Server::from_env()`

**Session:** Not listed.

**Window:** Not listed.

**Pane:** Not listed.

### Examples

Environment lookup requires valid tmux targeting variables. If your process
can run outside tmux, handle that case before using the result.

<a id="java-and-c-stop-short-of-the-pane"></a>

### Resolve the server socket

`Server::from_env()` selects the socket. Use the resulting server to resolve
sessions or panes.

## tmux's own environment variable store

Like [Options and hooks](../options-and-hooks/),
tmux's persistent environment store has global and per-session scopes. It is
read with `show-environment` and updated with `set-environment`. Newly spawned
processes inherit it; existing processes retain their own environments.

**Set:** Not documented here; see the process-environment note below.

**Read all:** Not documented here; see the process-environment note below.

**Unset:** Not documented here; see the process-environment note below.

`set-environment` writes a value. Its `-u` flag removes the entry, while `-r`
marks the variable for exclusion from new processes, including values tmux
inherited at startup. The listing retains an excluded variable as `-NAME`.

### Process environment

Creation-time environment values affect the new process. They do not update
an existing process's environment. To change tmux's persistent table, use
`set-environment` on the same socket as the server handle.
