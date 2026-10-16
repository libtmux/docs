---
supportedPorts: []
title: Concepts
description: tmux objects, command transports, queries, and workspaces.
sidebar:
  label: Overview
  group: Concepts
  order: 1
cards:
  - label: Server, session, window, pane
    href: server-session-window-pane/
    body: Understand the tmux object hierarchy and attached clients.
  - label: Control mode vs one-shot
    href: transports/
    body: Choose subprocess commands, persistent connections, and batching.
    ports: [root, py, ts, rs, go, java, csharp, cxx, swift]
  - label: Filtering and queries
    href: queries/
    body: Find objects and handle absent or ambiguous matches.
    ports: [root, py, ts, rs, go, java, csharp, cxx, swift]
  - label: Workspaces
    href: workspaces/
    body: Build pane layouts with commands or tmux command files.
    ports: [root, py, ts, rs, go, java, csharp, cxx, swift]
  - label: Native guides
    href: ../guides/
    body: Learn the library's query, execution, and resource ownership APIs.
    ports: [ruby, lua]
---

tmux creates sessions, arranges windows and panes, and keeps their programs
running when you detach. Start with the object hierarchy, then read about
command clients, filters, or workspace layouts.

The concepts include complete shell scripts on private servers. Use
[`list-sessions`](/tmux/latest/manual/list-sessions/) and
[`list-panes`](/tmux/latest/manual/list-panes/) to inspect live state, and
read the [tmux manual](/tmux/latest/manual/) for command flags and formats.
