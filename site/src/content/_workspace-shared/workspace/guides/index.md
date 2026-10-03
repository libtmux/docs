---
title: Guides
description: Install the workspace command, find configurations and automate tmux sessions.
product: workspace
sidebar:
  label: Guides
  group: Guides
  order: 0
tableOfContents: false
cards:
  - label: Install and load
    href: ./installation/
    body: Install the command and load a workspace on a private socket.
  - label: Find workspace files
    href: ./discovery/
    body: Discover, search and edit configurations.
  - label: Automate workspace loading
    href: ./automation/
    body: Use machine output and exit codes in scripts.
  - label: Export a session
    href: ./export-session/
    body: Capture a running session and load it again.
  - label: Troubleshooting
    href: ./troubleshooting/
    body: Diagnose installation, configuration and execution problems.
  - label: Inspect with MCP
    href: ./inspect-with-mcp/
    body: Connect the Go MCP server to a loaded workspace.
    ports: [go]
---

Choose a task below. The [CLI reference](../cli/) documents commands and
options; [Internals](../internals/) covers the workspace builder library.
