---
supportedPorts: [py, ts, rs, go, java, csharp, cxx, swift]
title: Guides
description: Task-oriented walkthroughs that sit between the concepts and each port's own API reference.
sidebar:
  label: Overview
  group: Guides
  order: 1
cards:
  - label: Getting started
    href: getting-started/
    body: Install tmux and run a complete example.
  - label: Attaching to tmux
    href: attaching-to-tmux/
    body: Select a socket and find or create a session.
  - label: Sending keys
    href: sending-keys/
    body: Send literal text, named keys, and Enter.
  - label: Capturing output
    href: capturing-output/
    body: Read the screen or scrollback and wait for a result.
  - label: Filtering and querying
    href: querying-and-filtering/
    body: Find objects and handle missing or ambiguous matches.
  - label: Batching commands
    href: batching-commands/
    body: Group commands, inspect their results, and handle failures.
    ports: [rs]
  - label: Control mode
    href: control-mode/
    body: Keep a connection open for commands and tmux notifications.
    ports: [rs]
  - label: Testing
    href: testing-with-libtmux/
    body: Use isolated tmux servers and manage test cleanup.
---

Use these guides to connect to tmux, send input, capture output, query objects,
and test your program. [Concepts](/concepts/) explains the object model and
transport choices.

[Examples](/examples/) provides complete programs with setup and cleanup.

<!-- port:root -->
The general guides use tmux shell commands. Select a port from the dropdown
for its library APIs, imports and native project setup.
<!-- /port -->
