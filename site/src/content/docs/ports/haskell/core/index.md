---
port: haskell
route: core
title: "tmux client library for Haskell"
description: "tmux client library for Haskell. Create sessions, windows and panes. Send input, observe pane text and query detached snapshots."
cards:
  - label: Getting started
    href: ../guides/getting-started/
    body: Install the source package and capture a running tmux server.
  - label: Create sessions, windows and panes
    href: ../guides/creation/
    body: Retain created identities and choose exact window-link and pane context.
  - label: Run terminal applications
    href: ../guides/programs/
    body: Send literal input, observe rendered output and clean up owned application resources.
  - label: Capture and traverse
    href: ../guides/capture/
    body: Follow physical panes and linked-window context in one snapshot.
  - label: Query snapshots
    href: ../guides/query/
    body: Filter typed fields, follow relationships and check selection cardinality.
  - label: Change targets and observe pane text
    href: ../guides/mutations/
    body: Rename, select and remove targets, send input, capture text and wait for a match.
  - label: API reference
    href: ../reference/
    body: Public modules, types, constructors and functions from Haddock.
  - label: Implementation status
    href: ../guides/status/
    body: Check public capabilities, compatibility evidence and package boundaries.
---

Adopt a running daemon with `withServer`. Create sessions, windows and panes
through explicit references, then query detached snapshots. Select window
links, apply layouts, change named environment entries and observe pane text.
Capture again to see changes to the object graph.

Use `withProgram` or `runProgram` for an owned terminal application on that
borrowed daemon. Program operations require tmux 3.8, Linux 6.9 process-group
pidfds and compatible Bash. The [program guide](../guides/programs/) explains
the host checks, rendered output bounds and cleanup ownership.
