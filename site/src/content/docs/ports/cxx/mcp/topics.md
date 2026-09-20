---
title: C++ MCP topics
description: Select toolsets, inspect the pinned endpoint, and observe bounded commands.
port: cxx
product: mcp
sidebar:
  label: Topics
  order: 1
---

The server selects one tmux endpoint and freezes its offered tools at startup.
Read `tmux://capabilities` to inspect that endpoint's provenance and the
effective tool selection.

## Select tools

`LIBTMUX_TOOLSETS` selects any combination of `inspect`, `manage`,
`execute`, and `teardown`. `LIBTMUX_TOOLS` adds exact names;
`LIBTMUX_EXCLUDE_TOOLS` removes names last. Unknown names and malformed
lists fail startup.

Use `inspect` for discovery and terminal reads. Add `manage` for topology
changes and `execute` for input and process creation. Select `teardown`
explicitly when removal is needed on an existing or explicitly selected
server. A default dedicated daemon can receive teardown tools when the
launcher verifies its own minimal-configuration provenance.

Tool selection shapes the callable interface. Execute tools act with the
tmux user's authority; selecting a socket does not confine shell effects.

## Observe a command

Use [`run_shell_command`](../tools/run_shell_command/) for a bounded command
and its exit status. A deadline ends the wait; the pane command may still
be running. Inspect it before submitting another command.

Use [`capture_since`](../tools/capture_since/) to collect subsequent output
and [`wait_for_text`](../tools/wait_for_text/) for an expected terminal
condition. Their schemas and result limits are in the [tool reference](../tools/).
The current catalog has no detached job-handle API.

## Resources and prompts

The server exposes the static `tmux://capabilities` resource. Read live
hierarchy and terminal state through tools. The current surface has no
workflow prompts or dynamic resource templates.

[Configuration and lifecycle contract](https://github.com/libtmux/libtmux-cxx/blob/393d4b0ad666f18a6581f1eb281741a75a7503f0/apps/mcp/README.md).
