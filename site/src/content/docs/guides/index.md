---
supportedPorts: []
title: Guides
description: Run tmux commands to create sessions, send input, capture output, query objects, and isolate tests.
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
  - label: tmux support
    href: tmux-support/
    body: Find the tmux release every port requires and which features need a newer one.
---

Use these guides to run tmux tasks from a terminal or a shell script. Start
with [getting started](getting-started/) to create a session, window, and
pane. [Concepts](/concepts/) explains their identities and relationships.

[Examples](/examples/) provides complete scripts with setup and cleanup.

The command references for [`new-session`](/tmux/latest/manual/new-session/)
and [`capture-pane`](/tmux/latest/manual/capture-pane/) describe their flags
for the selected tmux release. The guides state their prerequisites and own
their private server cleanup.
