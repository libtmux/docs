---
title: Concepts
description: tmux objects, command transports, queries, and workspaces.
sidebar:
  label: Overview
  group: Concepts
  order: 1
---

libtmux lets you create sessions, arrange windows and panes, send commands, and
read output from tmux. Start with the object hierarchy, then read about the
transport, query, or workspace behavior your program needs.

<!-- port:root,py,ts,rs,go,java,dotnet,cxx,swift -->
Choose the concept behind your task:

- **[Server, session, window, pane](server-session-window-pane/)**: tmux's
  object hierarchy and attached clients.
- **[Control mode vs one-shot](transports/)**: subprocess commands, persistent
  connections, and batching.
- **[Filtering and queries](queries/)**: find objects and handle absent or
  ambiguous matches.
- **[Workspaces](workspaces/)**: build pane layouts from code or configuration
  files.

<!-- /port -->

<!-- port:ruby,lua,kotlin,scala,fsharp -->
Start with [the object hierarchy](server-session-window-pane/), then use
[the native guides](../guides/) for queries, execution, and resource ownership.
<!-- /port -->

Use the API reference for signatures, defaults, and failure conditions.
