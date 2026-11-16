---
title: Examples
description: Tested Scala examples against an isolated tmux server.
port: scala
route: examples
sidebar:
  group: Examples
  order: 1
---

Start with [Capture pane output](./capture-pane-output/) for a standalone program with imports, Gradle files, and private-server cleanup.

For an existing server, use [Attaching to tmux](../guides/attaching-to-tmux/).
That program includes the imports and build files. It reads a session without
stopping the server that owns it, or starts and stops a private server of its
own when `LIBTMUX_SOCKET_PATH` is unset.
