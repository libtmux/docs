---
port: fsharp
route: concepts
title: Concepts
description: Understand F# handles, filters, transports and layout ownership.
sidebar:
  label: Overview
  group: Concepts
  order: 1
tableOfContents: false
cards:
  - label: Server, session, window, pane
    href: ./server-session-window-pane/
    body: Navigate captured sessions, windows, and panes, and refresh their state.
  - label: Filtering and queries
    href: ./queries/
    body: Combine predicates, handle result counts, and match related windows.
  - label: Commands and control mode
    href: ./transports/
    body: Run bounded commands and manage a persistent control client.
  - label: Layouts and repeated setup
    href: ./workspaces/
    body: Create a split window and reuse a named window safely.
---

Use these concepts to reason about F# handles, selection and command execution. Each page includes complete programs with imports, project files, run commands and cleanup.

For individual types and operations, open the [API reference](../reference/). For a first connection, start with [attaching to tmux](../guides/attaching-to-tmux/).
