---
title: C# MCP topics
description: Choose callable tools, interpret bounded results, and understand pane observation and cancellation.
port: csharp
product: mcp
sidebar:
  label: Overview
  group: Topics
  order: 1
cards:
  - label: Tool selection
    href: tool-selection/
    body: Combine toolsets, exact names, and exclusions; inspect the frozen capability report.
  - label: Waits and captured output
    href: waits-and-output/
    body: Read command results, follow a pane, and handle deadlines, truncation, and lost events.
---

The server selects one tmux endpoint and freezes its offered tools at startup.
Read `tmux://capabilities` to inspect that endpoint's provenance and the
effective tool selection.

## Select tools

[Tool selection](tool-selection/) explains the four groups, exact-name
inclusions, exclusions, and the difference between an unset and an empty
selection. A socket limits the tmux objects the process addresses; it does
not restrict the operating-system authority of commands running in panes.

## Observe a command

[Waits and captured output](waits-and-output/) distinguishes command
completion from terminal text changes. It covers `run_shell_command`,
`wait_for_text`, incremental captures, response budgets, and cancellation.
An expired wait can leave a command running.

## Resources and prompts

The [capability resource](tool-selection/#inspect-the-connection) reports
startup configuration. Read live hierarchy and terminal state through tools.
The server offers no workflow prompts or dynamic resource templates.
