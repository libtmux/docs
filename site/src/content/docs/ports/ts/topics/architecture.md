---
port: ts
route: topics/architecture
title: Architecture
description: Locate operations, distinguish snapshots from live commands, and find their implementation.
sidebar:
  label: Architecture
  group: Topics
  order: 2
tableOfContents: true
---

A server handle selects a tmux server. Object IDs select sessions, windows, and
panes within it. For the object hierarchy and stable IDs, start with [Server,
session, window, pane](/concepts/server-session-window-pane/).

<a id="where-behavior-lives-on-the-object-or-through-the-server"></a>

## Calling operations

Session, window, and pane handles carry their ID and server context. Call an
operation on the object you want to change. The examples below send input and
kill that pane.

```typescript
await pane.sendKeys("echo hi");
await pane.kill();
```

<a id="a-generated-data-table-under-a-hand-written-surface"></a>

## Reading tmux fields

Object IDs become tmux targets (`-t`). Format variables (`#{...}`) provide
the state returned by tmux.

`packages/libtmux/src/_generated/format_fields.ts` records each token's scope
and first tmux version. `packages/libtmux/src/_generated/field_aliases.ts`
provides camelCase aliases for fields on `Pane`, `Session`, and `Window`.

<a id="module-layout-by-port"></a>

## Source layout

The public classes live in `packages/libtmux/src/server.ts`,
`packages/libtmux/src/session.ts`, `packages/libtmux/src/window.ts`,
`packages/libtmux/src/pane.ts`, and `packages/libtmux/src/client.ts`.

Their operations are split by concern under
`packages/libtmux/src/_internal/operations/`, including
`packages/libtmux/src/_internal/operations/pane_io.ts`,
`packages/libtmux/src/_internal/operations/hooks.ts`,
`packages/libtmux/src/_internal/operations/options.ts`, and
`packages/libtmux/src/_internal/operations/topology.ts`.
`packages/libtmux/src/_generated/` contains the generated field catalogs.
Workspaces and the MCP server have separate packages in the same repository.
