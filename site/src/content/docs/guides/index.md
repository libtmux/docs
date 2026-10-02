---
supportedPorts: [py, ts, rs, go, java, dotnet, cxx, swift]
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

- **[Getting started](getting-started/)**: install tmux and run a complete example.
- **[Attaching to tmux](attaching-to-tmux/)**: select a socket and find or
  create a session.
- **[Sending keys](sending-keys/)**: send literal text, named keys, and Enter.
- **[Capturing output](capturing-output/)**: read the screen or scrollback and
  wait for a result.
- **[Filtering and querying, in practice](querying-and-filtering/)**: apply the
  lookup contracts from [Filtering and queries](/concepts/queries/).
- **[Testing](testing-with-libtmux/)**: use isolated tmux servers
  and manage test cleanup.

[Examples](/examples/) provides complete programs with setup and cleanup.

<!-- port:root -->
The general guides use tmux shell commands. Select a port from the dropdown
for its library APIs, imports and native project setup.
<!-- /port -->
