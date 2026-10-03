---
supportedPorts: [py, ts, rs, go, java, dotnet, cxx, swift, ruby, lua]
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
    ports: [root, py, ts, rs, go, java, dotnet, cxx, swift]
  - label: Filtering and queries
    href: queries/
    body: Find objects and handle absent or ambiguous matches.
    ports: [root, py, ts, rs, go, java, dotnet, cxx, swift]
  - label: Workspaces
    href: workspaces/
    body: Build pane layouts from code or configuration files.
    ports: [root, py, ts, rs, go, java, dotnet, cxx, swift]
  - label: Native guides
    href: ../guides/
    body: Learn the library's query, execution, and resource ownership APIs.
    ports: [ruby, lua]
---

libtmux lets you create sessions, arrange windows and panes, send commands, and
read output from tmux. Start with the object hierarchy, then read about the
transport, query, or workspace behavior your program needs.

Use the API reference for signatures, defaults, and failure conditions.
