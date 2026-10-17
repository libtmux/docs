---
supportedPorts: []
title: Topics
description: Native tmux sockets, state, cleanup, pane input and output, configuration, and command failures.
sidebar:
  label: Overview
  group: Topics
  order: 1
cards:
  - label: Architecture
    href: architecture/
    body: Understand clients, servers, command queues, and native state.
  - label: Traversal
    href: traversal/
    body: Navigate related objects, test membership, and compare identity.
  - label: Ownership and cleanup
    href: context-managers/
    body: Use explicit kill commands and shell traps for owned objects.
  - label: Pane interaction
    href: pane-interaction/
    body: Choose input modes, capture ranges, and completion waits.
  - label: Options and hooks
    href: options-and-hooks/
    body: Configure tmux and register event commands at a supported scope.
  - label: Format-token fields
    href: format-tokens/
    body: Read tmux format fields and diagnose empty values.
  - label: Waiting and retrying
    href: waiting-and-retry/
    body: Wait on a condition or a named tmux signal.
  - label: Environment
    href: environment/
    body: Locate objects from process variables and configure new panes.
  - label: Socket and servers
    href: socket-and-servers/
    body: Select a server, check liveness, and detect a replacement daemon.
  - label: Command failures
    href: errors-and-exceptions/
    body: Handle command failures and decide whether a mutation can be retried.
---

Use these pages for tmux object traversal, cleanup, pane input and output,
configuration, and command failures. [Concepts](/concepts/) introduces the
server, session, window, and pane model.

The concept guides also cover [control mode vs one-shot](/concepts/transports/),
[filtering and queries](/concepts/queries/), and
[workspaces](/concepts/workspaces/). Choose a topic for more detailed
behavior.

Use [`show-options`](/tmux/latest/manual/show-options/) to inspect settings,
[`display-message`](/tmux/latest/manual/display-message/) to evaluate formats,
and the [tmux manual](/tmux/latest/manual/) for each command's flags and
failure behavior.
