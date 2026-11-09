---
title: Erlang workspace manager is not published
description: The Erlang source application validates JSON desired state. Its plan and apply workflow and command-line tool are unfinished, and no package or loader command is available.
port: erlang
product: workspace
sidebar:
  label: Availability
  order: 0
tableOfContents: true
---

Erlang has no published libtmux workspace manager. The source application
validates JSON desired state, but its plan and apply workflow and its
command-line tool are unfinished.

There is no workspace package to install, loader command to run, or workspace
API reference yet. The current public core observes tmux, holds the object
graph as native records and sends explicit tmux operations.

Start with the [core library](../core/). The [guides](../guides/) cover
installation and the first connection.
