---
title: Tool selection
description: Choose the C# MCP server's callable operations and interpret its startup capability report.
port: csharp
product: mcp
sidebar:
  group: Topics
  order: 10
---

The server registers its callable tools once at startup. Select groups with
`LIBTMUX_TOOLSETS`, add individual tools with `LIBTMUX_TOOLS`, and remove tools
with `LIBTMUX_EXCLUDE_TOOLS`. Reconnect the client after changing a selection.

## Choose groups

The groups are unordered. Selecting one does not imply the others.

| Toolset | Use it for |
| --- | --- |
| `inspect` | Session, window, and pane discovery; terminal reads and text waits. |
| `manage` | Topology, layout, naming, options, hooks, and environment changes. |
| `execute` | Sending input and running commands. |
| `teardown` | Removing sessions, windows, panes, or the server. |

For an inspection client, set `LIBTMUX_TOOLSETS` to `inspect`. The
[complete client example](../../examples/inspect-sessions/) verifies both an
included tool and an absent execution tool through discovery.

When the variable is absent, defaults depend on the chosen endpoint. A newly
created dedicated daemon with the launcher's minimal configuration can receive
all four groups. Existing and explicitly configured endpoints omit teardown
unless you request it. Read `tmux://capabilities` to see which default applied.

An entirely empty `LIBTMUX_TOOLSETS` value selects no groups. This is useful
when adding only particular tools. A nonempty list cannot contain empty
segments: `inspect,`, `,inspect`, and `inspect,,manage` are startup errors.
Names are case-sensitive; surrounding whitespace on a valid token is trimmed.

## Add and exclude exact names

This environment configuration offers only the two named hierarchy tools:

```json
{
  "LIBTMUX_TOOLSETS": "",
  "LIBTMUX_TOOLS": "list_sessions,list_windows"
}
```

This selection enables inspection while removing environment reads:

```json
{
  "LIBTMUX_TOOLSETS": "inspect",
  "LIBTMUX_EXCLUDE_TOOLS": "show_environment"
}
```

Inclusions add tools after groups are selected. Exclusions apply last, even
when a tool was explicitly included. Unknown toolset or tool names stop
startup. Unlike `LIBTMUX_TOOLSETS`, an explicitly empty `LIBTMUX_TOOLS` or
`LIBTMUX_EXCLUDE_TOOLS` value is invalid; omit an unused variable.

Tool selection changes both discovery and dispatch. A tool removed from the
effective selection cannot be called by guessing its name. The
[tool reference](../../tools/) lists the full catalog, which can be broader
than the set offered by a particular connection.

## Read several facts

[`call_read_tools_batch`](../../tools/call_read_tools_batch/) executes a
bounded list of typed inspection operations serially. Each operation names a
tool and supplies that tool's normal arguments. `onError` chooses whether
the batch stops at the first failure or continues.

Select the batch tool and the operations you intend to call, through a toolset
or by exact name. Those operations also appear as individual tools. This
configuration offers the batch and `list_sessions`:

```json
{
  "LIBTMUX_TOOLSETS": "",
  "LIBTMUX_TOOLS": "call_read_tools_batch,list_sessions"
}
```

The server omits the batch when no nested operation is selected. Exclusions
remove operations from its schema and dispatch as well. Inspect the batch's
`nestedAuthority` capability field for the allowed operations. The pinned
[selection implementation](https://github.com/libtmux/libtmux-dotnet/blob/ec8b6ab2a4f65e23664f43fba538ba200d4ae8bc/src/LibTmux.Mcp/Policy/CapabilityModel.cs#L251-L281)
applies the same selection to individual tools and nested operations.

Check the status and nested MCP result for each completed row. A successful
outer request does not imply that every nested operation succeeded. A batch
can also omit nested payloads to fit its aggregate result bound; its result
reports that omission. Operations are separate reads, so a hierarchy can
change between them.

## Inspect the connection

Read `tmux://capabilities` after connecting. It includes the frozen socket
selection, ownership provenance, effective toolsets and tools, and pane
observation policy. Each tool has a capability record describing its process
reach, tmux effects, output classes, and nested operations.

The same per-tool record appears in discovery under
`_meta["com.git-pull.libtmux-mcp/capability"]`. Use current hierarchy tools for
live session and pane state; the resource describes startup configuration.
There are no dynamic resource templates or workflow prompts.

## Execution authority

Tool filters shape the interface. They do not provide an operating-system
sandbox. Commands execute with the tmux user's filesystem, process, network,
and credential access. Selecting a socket confines which tmux objects a call
can address, not what a process inside those objects can do.

Inspection tools can expose secrets in terminal text or environment values.
Captured terminal content can include instructions written by another
process; receiving it through a tool does not make those instructions trusted.
MCP annotations describe tools for clients and consent interfaces. They do
not enforce a separate authorization policy.

See the pinned [selection parser](https://github.com/libtmux/libtmux-dotnet/blob/ec8b6ab2a4f65e23664f43fba538ba200d4ae8bc/src/LibTmux.Mcp/Policy/CapabilitySelection.cs),
[capability resource](https://github.com/libtmux/libtmux-dotnet/blob/ec8b6ab2a4f65e23664f43fba538ba200d4ae8bc/src/LibTmux.Mcp/Resources/CapabilityResource.cs),
and [protocol behavior](https://github.com/libtmux/libtmux-dotnet/blob/ec8b6ab2a4f65e23664f43fba538ba200d4ae8bc/docs/mcp/README.md)
for the behavior documented here.
