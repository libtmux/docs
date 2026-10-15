---
supportedPorts: []
title: Examples
description: Complete native tmux shell scripts for sending input, capturing output, and building workspaces.
sidebar:
  label: Overview
  group: Examples
  order: 1
cards:
  - label: Attach and send keys
    href: attach-and-send-keys/
    body: Find a session, send a command, and read its output.
  - label: Capture pane output
    href: capture-pane-output/
    body: Read a pane's screen and wait for output to appear.
  - label: Build a workspace from a file
    href: workspace-from-file/
    body: Create a session, windows, and panes from a tmux command file.
---

Run these complete shell scripts to send input, capture output, and build
workspace layouts. Each example states its requirements, includes its setup,
and cleans up the private tmux server it creates.

Save the displayed files with their shown names and run the command below
them. The scripts use explicit sockets and targets so their commands reach
the server and pane they created. Capture examples use completion signals
before reading output.

Use [`send-keys`](/tmux/latest/manual/send-keys/),
[`capture-pane`](/tmux/latest/manual/capture-pane/), and
[`source-file`](/tmux/latest/manual/source-file/) for their command syntax.
[Guides](/guides/) explains variations and failure handling.
