---
title: Topics
description: Object traversal, cleanup, pane I/O, configuration, and failure handling.
sidebar:
  label: Overview
  group: Topics
  order: 1
---

Use these pages for object traversal, cleanup, pane I/O, configuration, and
failure handling. [Concepts](/concepts/) introduces the shared object model.

The concept guides also cover [control mode vs one-shot](/concepts/transports/),
[filtering and queries](/concepts/queries/), and
[workspaces](/concepts/workspaces/). Choose a topic below for more detailed
behavior:

- **[Architecture](architecture/)**: locate operations and field definitions in
  each port's source.
- **[Traversal](traversal/)**: navigate related objects, test membership, and
  compare identity.
- **[Context managers](context-managers/)**: manage cleanup on block exit and
  identify objects that need an explicit kill.
- **[Pane interaction](pane-interaction/)**: choose input modes, capture ranges,
  and completion waits.
- **[Options and hooks](options-and-hooks/)**: configure tmux and register event
  commands at a supported scope.
- **[Format-token fields](format-tokens/)**: read typed state and handle fields
  absent from a scope, version, or capture.
- **[Waiting and retrying](waiting-and-retry/)**: wait on a condition or a named
  tmux signal.
- **[Environment](environment/)**: locate objects from process variables and
  configure values inherited by new panes.
- **[Socket and servers](socket-and-servers/)**: select a server, check
  liveness, and detect a replacement daemon.
- **[Errors and exceptions](errors-and-exceptions/)**: handle command failures
  and determine whether a mutation can be retried.

Use your port's API reference for signatures and defaults. These pages call out
differences that affect how you use the APIs.
