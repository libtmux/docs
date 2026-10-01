---
port: fsharp
route: concepts
title: F# concepts
description: Understand F# handles, filters, transports and layout ownership.
sidebar:
  label: F# concepts
  group: Concepts
  order: 1
tableOfContents: true
---

Use these concepts to reason about F# handles, selection and command execution. Each page includes complete programs with imports, project files, run commands and cleanup.

| Concept | What you will do |
| --- | --- |
| [Server, session, window, pane](./server-session-window-pane/) | Traverse a capture and refresh after a rename. |
| [Filtering and queries](./queries/) | Combine predicates, handle result counts and match related windows. |
| [Commands and control mode](./transports/) | Run bounded commands and manage a persistent control client. |
| [Layouts and repeated setup](./workspaces/) | Create a split window and reuse a named window safely. |

For individual types and operations, open the [API reference](../reference/). For a first connection, start with [attaching to tmux](../guides/attaching-to-tmux/).
