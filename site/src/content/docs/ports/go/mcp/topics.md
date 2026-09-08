---
title: Go MCP topics
description: Understand capability profiles, operation ceilings, caller confirmation, and managed jobs.
port: go
product: mcp
sidebar:
  label: Topics
  order: 1
---

The Go server applies independent access capabilities and an operation
ceiling. A tool must satisfy both to appear in the catalog or run.

## Capabilities and ceiling

`LIBTMUX_MCP_CAPABILITIES` defaults to `metadata-read`. It permits
topology and process metadata without pane content or configuration values.

The `inspect` profile adds `content-read`. `operate` also adds
`pane-control`, `workspace-create`, `tmux-layout`, and
`tmux-settings`. `all` additionally includes `tmux-destroy`.

`LIBTMUX_SAFETY` independently selects `readonly`, `mutating`, or
`destructive`; the default is `mutating`. Dedicated destruction needs
both the destructive ceiling and `tmux-destroy`. Unrecognized
capabilities grant nothing, with a metadata-only fallback if none are
recognized. An invalid nonempty safety value selects readonly.

Batch calls cannot bypass either gate. Content resources and subscriptions
require content-read; hierarchy metadata requires metadata-read.

## Caller context and endpoint lifetime

Flags and environment choose one endpoint before the transport starts.
A client cannot supply a different socket per tool call.

Pane rows report `isCaller`. The server checks inherited tmux context
and can also identify its ancestor pane when the client strips that
environment. Writes to the caller's pane require client elicitation.
A client without that capability is refused.

These checks do not confine effects from shell input on another pane.
Socket permissions and the process identity determine who can access the
underlying tmux server.

## Background work and output

`run_command` with `detach` returns a `jobId` immediately.
`get_job` collects its result later. A scoped `list_panes` with
`detail: full` reads process state without capturing terminal content.

Waits default to a maximum of 300 seconds. Larger requested waits are
clamped and report `effectiveTimeoutSeconds` and `timeoutClamped`.

Resources can notify clients of changes. Recipes are also exposed through
`get_recipe` when `LIBTMUX_MCP_PROMPTS_AS_TOOLS=1`; this optional tool
changes the registered catalog.

[Configuration and lifecycle contract](https://github.com/libtmux/libtmux-go/blob/5f808882015a975a65acc7f9da5b3ff0d5cbdc91/mcp/README.md).
