---
title: C# MCP examples
description: Run complete C# clients that discover sessions and execute a command in an owned tmux server.
port: csharp
product: mcp
sidebar:
  label: Overview
  group: Examples
  order: 3
cards:
  - label: List sessions through MCP
    href: inspect-sessions/
    body: Verify tool discovery, read the capability resource, and check structured session metadata.
  - label: Run a command through MCP
    href: run-command/
    body: Discover a pane, check shell completion and output, and clean up the owned server.
---

Each example includes its project file, complete program, pinned tool
installation, run command, and expected output. The programs create private
tmux servers and attempt cleanup after successful and failed requests.

## List sessions

[List sessions through MCP](inspect-sessions/) uses an inspection-only
connection. It checks the advertised tools, reads `tmux://capabilities`, and
verifies the session name and window count in structured content.

## Run a command

[Run a command through MCP](run-command/) discovers the pane ID, submits a
bounded shell command, and checks its exit status separately from the MCP
result. It also checks whether the captured output is complete.

For an existing server, follow the [connection guide](../guides/connect-client/)
and keep its ownership separate from the private servers in these examples.
See [Waits and captured output](../topics/waits-and-output/) before adding
retries or cancellation to a client that controls long-running processes.
