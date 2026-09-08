---
title: C++ MCP topics
description: Understand the native tool catalog, Windows preview, strict arguments, and wait behavior.
port: cxx
product: mcp
sidebar:
  label: Topics
  order: 1
---

The C++ MCP catalog follows platform support. It does not expose a runtime
toolset or tier setting.

## Platform and target identity

POSIX offers the complete catalog. Native Windows advertises
`inspect_tmux`, `list_sessions`, `list_windows`, and
`list_session_panes`. It refuses unsupported capture, input, creation,
search, waits, global pane discovery, and socket-path operations.

Retain owning session IDs from discovery. In psmux, window and pane IDs
can repeat between sessions; a bare object ID does not preserve enough
context.

The Windows preview has additional upstream limits: psmux can perform
global registry maintenance before processing a command. A socket name
does not isolate that maintenance. Follow the
[Windows contract](https://github.com/libtmux/libtmux-cxx/blob/c7f1146d2ebd7a8323d9f9814517dc3cdf86b4ee/README.md#windows-through-psmux)
before using that preview.

## Arguments and input

Tools publish closed JSON Schemas. Unknown arguments, incorrect types,
out-of-range integers, and oversized strings fail before reaching tmux.
String bounds count validated Unicode code points.

`send_text` sends literal text. `send_keys` validates the entire
space-separated key list before sending a key. Neither operation confines
what the receiving pane program can do.

Tool annotations describe requested effects. Server aliases or hooks can
add other effects, so an inspection annotation is not proof that an
untrusted tmux configuration is harmless.

## Waits and failures

`wait_for_text` defaults to 10000 milliseconds and accepts values from
1 through 60000. It uses control-output events when available, otherwise
bounded capture polling. One deadline includes target resolution and
connection setup, and the result identifies its transport mode.

Cancellation is checked between library operations. A tmux subprocess
already running remains bounded by the library's execution policy.
A returned tool error can describe a well-formed request that tmux refused;
malformed protocol envelopes fail at the JSON-RPC layer.

Successful calls carry schema-described structured content and matching
JSON text. Search reports a failed pane capture instead of treating it
as no match.

[Tool and failure contract](https://github.com/libtmux/libtmux-cxx/blob/c7f1146d2ebd7a8323d9f9814517dc3cdf86b4ee/apps/mcp/README.md).
