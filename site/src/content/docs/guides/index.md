---
title: Guides
description: Task-oriented walkthroughs that sit between the concepts and each port's own API reference.
sidebar:
  label: Overview
  group: Guides
  order: 1
---

Use these guides to connect to tmux, send input, capture output, query objects,
and test your program. [Concepts](/concepts/) explains the object model and
transport choices.

- **[Getting started](getting-started/)**: install tmux, choose a port, and run
  an example.
- **[Attaching to tmux](attaching-to-tmux/)**: select a socket and find or
  create a session.
- **[Sending keys](sending-keys/)**: send literal text, named keys, and Enter.
- **[Capturing output](capturing-output/)**: read the screen or scrollback and
  wait for a result.
- **[Filtering and querying, in practice](querying-and-filtering/)**: apply the
  lookup contracts from [Filtering and queries](/concepts/queries/).
- **[Testing with libtmux](testing-with-libtmux/)**: use isolated tmux servers
  and manage test cleanup.

[Examples](/examples/) provides source-backed programs for the same tasks, with
source and validation details on each page.
