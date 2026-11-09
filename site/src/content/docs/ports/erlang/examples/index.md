---
port: erlang
route: examples
title: Examples
description: Run Erlang programs with private tmux servers and checked cleanup.
cards:
  - label: Create and query a graph
    href: ../guides/getting-started/
    body: Create sessions, windows and panes, then filter captured rows.
  - label: Traverse a linked window
    href: ../concepts/object-graph/
    body: Compare physical windows with their session-relative memberships.
  - label: Capture and send text
    href: ../guides/panes/
    body: Send literal text and inspect pane output on an owned server.
  - label: Work with byte buffers
    href: ../guides/buffers/
    body: Load, inspect, paste and delete named byte buffers.
---

Each guide includes its complete program, setup command and expected result.
The core checks run these programs against private tmux servers and repeat
them as installed consumers. Follow the guide's cleanup contract when adapting
a program to an existing server.
