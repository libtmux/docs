---
supportedPorts: [py, ts, rs, go, java, csharp, cxx, swift]
title: Topics
description: Object traversal, cleanup, pane I/O, configuration, and failure handling.
sidebar:
  label: Overview
  group: Topics
  order: 1
cards:
  - label: Architecture
    href: architecture/
    body: Locate operations and field definitions in the library source.
  - label: Traversal
    href: traversal/
    body: Navigate related objects, test membership, and compare identity.
  - label: Ownership and cleanup
    href: context-managers/
    body: Manage cleanup on block exit and identify objects that need a kill.
  - label: Pane interaction
    href: pane-interaction/
    body: Choose input modes, capture ranges, and completion waits.
  - label: Options and hooks
    href: options-and-hooks/
    body: Configure tmux and register event commands at a supported scope.
  - label: Format-token fields
    href: format-tokens/
    body: Read typed state and handle absent fields.
  - label: Waiting and retrying
    href: waiting-and-retry/
    body: Wait on a condition or a named tmux signal.
  - label: Environment
    href: environment/
    body: Locate objects from process variables and configure new panes.
  - label: Socket and servers
    href: socket-and-servers/
    body: Select a server, check liveness, and detect a replacement daemon.
  - label: Errors and exceptions
    href: errors-and-exceptions/
    body: Handle command failures and decide whether a mutation can be retried.
---

Use these pages for object traversal, cleanup, pane I/O, configuration, and
failure handling. [Concepts](/concepts/) introduces the shared object model.

The concept guides also cover [control mode vs one-shot](/concepts/transports/),
[filtering and queries](/concepts/queries/), and
[workspaces](/concepts/workspaces/). Choose a topic for more detailed
behavior.

Use your port's API reference for signatures and defaults. Each topic explains
the behavior behind those calls.
