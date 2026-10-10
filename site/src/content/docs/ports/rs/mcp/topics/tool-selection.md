---
title: Tool selection
description: Choose toolsets, add individual tools, and apply exclusions to direct and batched calls.
port: rs
product: mcp
sidebar:
  group: Topics
  order: 10
---

`tmux-mcp` freezes its offered tools at startup. Changing a client's
environment requires restarting the connection. Inspect the result with
`tools/list` and `tmux://capabilities`; a tool omitted from the direct
interface cannot be called directly by guessing its name.

Complete the [client setup](../../guides/connect-client/) first. These
examples change that client's environment and retain its chosen socket.

## Toolsets

`LIBTMUX_TOOLSETS` selects an unordered set of groups. Commas separate
names; surrounding whitespace is ignored. These are categories, not
levels that imply the categories before them.

| Toolset | Operations | Examples |
| --- | --- | --- |
| `inspect` | Read tmux metadata and terminal output | `list_sessions`, `snapshot_pane`, `capture_since` |
| `manage` | Change tmux objects without supplying executable input | `rename_session`, `resize_pane`, `select_layout` |
| `execute` | Start configured processes or supply pane input | `create_session`, `send_keys`, `run_shell_command` |
| `teardown` | Delete tmux state | `kill_session`, `clear_pane_scrollback`, `set_history_limit` |

Creating a session belongs to `execute`: it starts the configured pane
process. Lowering a history limit can discard existing scrollback on
tmux 3.7 and later, so that operation belongs to `teardown`.

For inspection and command execution, set:

```json
{
  "LIBTMUX_TOOLSETS": "inspect,execute"
}
```

This JSON is the client entry's `env` object. It does not include the
`manage` or `teardown` groups.

## Unset and empty values

An **unset** `LIBTMUX_TOOLSETS` uses defaults. An explicit empty string
selects no toolsets.

| Startup condition | Default toolsets |
| --- | --- |
| The launcher creates its default dedicated daemon and verifies the minimal configuration | `inspect`, `manage`, `execute`, `teardown` |
| An existing daemon, an explicit socket or configuration, or unknown provenance | `inspect`, `manage`, `execute` |

To offer only one direct tool, start with an empty group selection and
add its exact name:

```json
{
  "LIBTMUX_TOOLSETS": "",
  "LIBTMUX_TOOLS": "list_sessions"
}
```

With an empty group selection and no named additions, `tools/list` is
empty. The capabilities resource remains available.

## Additions and exclusions

The server expands toolsets, adds names from `LIBTMUX_TOOLS`, then
removes names from `LIBTMUX_EXCLUDE_TOOLS`. Exclusions win even when the
same name appears in the additions.

This offers inspection plus `send_keys`, while removing `capture_pane`:

```json
{
  "LIBTMUX_TOOLSETS": "inspect",
  "LIBTMUX_TOOLS": "send_keys",
  "LIBTMUX_EXCLUDE_TOOLS": "capture_pane"
}
```

Removing one capture tool does not remove other ways to read terminal
output. For example, `snapshot_pane` and `capture_since` remain in
`inspect`. Choose the exact operations your client needs, then inspect
the complete offered list.

## Batched reads

[`call_read_tools_batch`](../../tools/call_read_tools_batch/) carries
its own nested operations. Offering only that tool can still allow
reads that are absent from the direct tool list:

```json
{
  "LIBTMUX_TOOLSETS": "",
  "LIBTMUX_TOOLS": "call_read_tools_batch",
  "LIBTMUX_EXCLUDE_TOOLS": "show_environment"
}
```

The direct list contains only `call_read_tools_batch`. Its capability
metadata and input schema describe the nested operations it accepts.
The exclusion removes `show_environment` from both. It cannot be
restored by placing it inside a batch.

This `tools/call` params object reads sessions through the batch:

```json
{
  "name": "call_read_tools_batch",
  "arguments": {
    "operations": [
      {"tool": "list_sessions", "arguments": {}}
    ]
  }
}
```

Read the batch's structured result and each result row. A successful
outer MCP call can contain failed child operations. An excluded nested
tool produces a failed row with an `invalid_input` error; the batch
reports that failure in its totals. Do not infer that every child
succeeded from the outer `isError` flag.

One client approval covers the whole batch. Nested tools do not receive
separate approvals. Inspect the batch's `nestedAuthority` metadata when
deciding whether to offer it.

## Invalid selections

Unknown tool or toolset names fail startup. So do empty elements inside
a nonempty list, such as `inspect,` or `inspect,,execute`. An entirely
empty value is valid. The launcher validates selections before opening
a tmux connection; a typo does not fall back to the defaults.

The retired `LIBTMUX_SAFETY` and `TMUX_MCP_SAFETY` settings also stop
startup. Remove them and choose the required toolsets explicitly.

A direct call to a known but unoffered tool returns an invalid-params
error. A batched call reports a refused child in its result rows.
Changing either selection requires a new connection.

Tool selection shapes the interface. Execute operations still act with
the tmux user's authority, and MCP annotations give the client hints
for its approval policy. Neither mechanism confines a pane's command
to a filesystem or network sandbox.

[Selection source](https://github.com/libtmux/libtmux-rs/blob/a6fc2a65674177b92b17fa380757155d2ba150fd/crates/tmux-mcp/src/policy.rs)
and [tool registration](https://github.com/libtmux/libtmux-rs/blob/a6fc2a65674177b92b17fa380757155d2ba150fd/crates/tmux-mcp/src/manifest.rs)
define these rules.
