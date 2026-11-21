---
port: haskell
route: core
title: "tmux client library for Haskell"
description: "tmux client library for Haskell. Own tmux daemon scopes, query snapshots, change targets, configure scoped settings and observe bounded control events."
cards:
  - label: Getting started
    href: ../guides/getting-started/
    body: Install the source package, start a private daemon and capture its graph.
  - label: Create sessions, windows and panes
    href: ../guides/creation/
    body: Retain created identities and choose exact window-link and pane context.
  - label: Run terminal applications
    href: ../guides/programs/
    body: Send literal input, observe rendered output and clean up owned application resources.
  - label: Observe control notifications
    href: ../guides/control/
    body: Read bounded events through STM and retire the attached observer with its scope.
  - label: Connect an MCP adapter
    href: ../guides/agents/
    body: Inspect the application's socket or run pane commands through libtmux-mcp.
  - label: Capture and traverse
    href: ../guides/capture/
    body: Follow physical panes and linked-window context in one snapshot.
  - label: Query snapshots
    href: ../guides/query/
    body: Filter typed fields, follow relationships and check selection cardinality.
  - label: Change targets and observe pane text
    href: ../guides/mutations/
    body: Rename, select and remove targets, send input, capture text and wait for a match.
  - label: Transfer and paste buffers
    href: ../guides/buffers/
    body: Round-trip binary bytes and choose a paste newline policy for an exact pane.
  - label: Resize panes and windows
    href: ../guides/resizing/
    body: Request absolute geometry, then capture actual cells and native layout effects.
  - label: Configure options and hooks
    href: ../guides/options/
    body: Select a store, read scalar values and register indexed built-in hooks.
  - label: API reference
    href: ../reference/
    body: Public modules, types, constructors and functions from Haddock.
  - label: Implementation status
    href: ../guides/status/
    body: Check public capabilities, compatibility evidence and package boundaries.
---

Start and retire a private daemon with `withOwnedServer`, or borrow an
existing endpoint with `withServer`. Use `killServer` for explicit retirement
of the admitted daemon generation. The [capture guide](../guides/capture/)
explains ownership, host requirements and detached values.

Create sessions, windows and panes through explicit references, then query
snapshots. Select window links, apply layouts, change named environment
entries and observe pane text. Load and paste binary buffers, resize targets
and configure options and hooks in explicit stores. Capture again to see
changes to the graph.

Use `withProgram` or `runProgram` for an owned terminal application within a
Server scope. Program operations require tmux 3.8, Linux 6.9 process-group
pidfds and compatible Bash. The [program guide](../guides/programs/) explains
the host checks, rendered output bounds and cleanup ownership.

Open `withControl` for an attached observer on an exact session. Its client is
excluded from sizing and session environment updates. tmux still counts the
attachment and can run attach hooks. The scope exposes bounded observations;
it has no Haskell command writer. The [control guide](../guides/control/)
shows a real window rename and the queue's terminal outcomes.

Import `LibTmux.Recovery` to inspect and resume retained operation owners after
incomplete cleanup. Keep exception context when handling those failures.

Connect the external `libtmux-mcp` adapter to the application's socket for
agent inspection and pane commands. The [agents guide](../guides/agents/)
keeps the Haskell scope responsible for daemon retirement.
