---
title: Python MCP topics
description: Understand Python toolsets, socket overrides, terminal output, and command completion.
port: py
product: mcp
sidebar:
  label: Topics
  order: 1
---

Python's MCP toolsets select advertised and callable tools. They do not
confine the programs running inside tmux.

## Select independent toolsets

`inspect` requests state or output. `manage` changes tmux structure,
presentation, or coordination without supplying executable input.
`execute` starts processes, sends input, or changes executable
configuration. `teardown` removes objects or retained history.

The default is `inspect,manage,execute`. `LIBTMUX_TOOLS` adds exact
names, and `LIBTMUX_EXCLUDE_TOOLS` removes them last. Unknown names fail
startup. An empty `LIBTMUX_TOOLSETS` selects no sets.

These settings filter tools only. Hierarchy resources and native prompts
remain available even with no tools. Resource reads contact tmux; native
prompts return text without contacting it.

## Know the endpoint and caller

`LIBTMUX_SOCKET` selects a default socket name. Targeted tools can accept
`socket_name` to override it for one call. This differs from servers that
pin every call to one endpoint.

Dedicated teardown tools refuse the pane containing the MCP process and
its enclosing window, session, or server. The check compares socket
identity as well as `TMUX_PANE`. It cannot turn open-ended shell input
into a constrained operation.

## Choose the completion signal

Use `run_command` for a command the agent authors. Read `exit_status`,
`timed_out`, and `output`; a timeout does not prove the shell stopped.
Use `wait_for_text` for output produced elsewhere and `capture_since`
for repeated observation with an opaque cursor.

The default wait ceiling is 30 seconds, configurable within 1 to 120
seconds. Oversized requests are clamped. Command-history suppression
defaults on for MCP calls to `run_command`, while direct Python calls
default it off; this is best-effort shell behavior.

## Treat terminal output as data

A private socket separates tmux objects. It does not restrict filesystem,
network, or same-user process access. Server aliases and hooks can add
effects even to a nominal inspection. Pane output can contain credentials
or instructions from another program; it remains untrusted data.

See the [upstream trust model](https://libtmux-mcp.git-pull.com/topics/trust/)
and [configuration source](https://github.com/tmux-python/libtmux-mcp/blob/v0.1.0a22/docs/configuration.md).
