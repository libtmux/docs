---
port: java
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

**Server:** Not listed.

**Session:** Not listed.

**Window:** Not listed.

**Pane:** See the Java context example below.

### Examples

Environment lookup requires valid tmux targeting variables. If your process
can run outside tmux, handle that case before using the result.

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

<a id="java-and-c-no-verified-access-to-this-table-at-all"></a>

### Process environment

`SessionSpec.Builder.environment(Map)`, `WindowSpec.Builder.environment(Map)`,
and `SplitSpec.Builder.environment(Map)` pass initial variables to
`new-session -e`, `new-window -e`, and `split-window -e`. These creation options
do not change the stored environment of an existing session.
