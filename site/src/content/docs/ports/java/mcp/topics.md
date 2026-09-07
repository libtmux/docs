---
title: Java MCP topics
description: Understand Java toolsets, socket provenance, bounded synchronous waits, and stable targets.
port: java
product: mcp
sidebar:
  label: Topics
  order: 1
---

The Java MCP server freezes its tool selection before serving requests.
The same selection controls tool listing and invocation.

## Toolsets and endpoint provenance

`LIBTMUX_TOOLSETS` selects any combination of `inspect`, `manage`,
`execute`, and `teardown`. `LIBTMUX_TOOLS` adds names;
`LIBTMUX_EXCLUDE_TOOLS` removes them last. An empty set selects none.
Unknown names and empty list elements fail startup.

Without a socket selector, the launcher uses `libtmux-mcp`. If it creates
that daemon with the shipped minimal configuration, all four sets are
enabled by default. Existing or explicitly selected daemons omit teardown
from the default.

The static `tmux://capabilities` resource reports the effective surface
and its provenance. Toolsets configure the interface; shell input and
server configuration still act with the tmux user's authority.

## Stable targets and input checks

Use IDs returned by listings. A bare numeric index is refused where a
stable object ID is required. Pane input checks caller context, human
attention, pane modes, and synchronized-input membership.

Framed commands require one live shell and reject a synchronized cohort.
A check is an observation, so tmux state can still change before dispatch.

## Waiting and cancellation

`run_shell_command` returns output and exit status from a framed
subshell. Directory changes and exports do not persist in the parent
shell. `wait_for_text` observes output produced elsewhere.
`capture_since` returns a cursor and flags discontinuity when retained
history no longer follows it.

Waits are capped at 30 seconds by default and two minutes absolutely.
Oversized requests are clamped. A client's own request timeout is separate.

The SDK dispatches synchronous handlers on a worker scheduler. A client
timeout or cancellation abandons the answer but does not stop an already
running synchronous handler or undo effects. Inspect state before retrying.

[Behavior and waiting contract](https://github.com/libtmux/libtmux-java/blob/4f057d367a25dee818d70876fa283fc503a3a7eb/docs/guide/mcp.md).
