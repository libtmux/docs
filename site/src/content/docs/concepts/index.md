---
title: Concepts
description: tmux objects, command transports, queries, and workspaces across the libtmux language ports.
sidebar:
  label: Overview
  group: Concepts
  order: 1
---

libtmux lets you create sessions, arrange windows and panes, send commands, and
read output from tmux. Start with the object hierarchy, then read about the
transport, query, or workspace behavior your program needs.

These pages explain shared concepts and differences between language ports:

- **[Server, session, window, pane](server-session-window-pane/)**: tmux's
  object hierarchy and attached clients.
- **[Control mode vs one-shot](transports/)**: subprocess commands, persistent
  connections, and batching.
- **[Filtering and queries](queries/)**: find objects and handle absent or
  ambiguous matches.
- **[Workspaces](workspaces/)**: build pane layouts from code or configuration
  files.

Use the header's port links to open documentation for your language, including
its API reference.
