---
title: "TypeScript workspace builder behavior"
description: "Internal configuration, application, and failure contracts of the TypeScript workspace builder."
port: ts
product: workspace
sidebar:
  group: Internals
  label: Topics
  order: 1
tableOfContents: true
---

Applying a workspace reconciles the requested structure with a named session.
It can create missing objects, rename windows, and remove eligible surplus
objects. It returns the resulting `Session`.

## Ownership and shared objects

A session created by the package carries the reserved `@libtmux-workspace`
option. The default `prune: "owned"` removes surplus only from a session with
that ownership stamp. Applying to a session created elsewhere adds the missing
structure and preserves its surplus windows and panes.

`prune: "never"` disables removals. `prune: "always"` authorizes removals for
that call without stamping persistent ownership. Inspect a fresh plan before
using that policy on an existing session.

Windows match by position rather than numeric tmux index. A linked surplus
window is unlinked from this session. Grouped sessions retain surplus windows,
and shared windows retain surplus panes, because removing those objects would
affect their other placements.

## Commands and options

The default `commands: "create-only"` sends setup and pane commands only in
panes created by the current apply. `commands: "always"` replays them in reused
panes too. Completion means workspace operations finished; it does not mean a
long-running command is ready to accept requests.

Named options are applied each time. Removing a key from the description does
not unset its current tmux value. Working directories inherit from workspace
to window to pane, with the most specific value winning.

## Plans and failures

`planWorkspace` describes topology changes without applying them. The plan
contains object identities and retention reasons; it does not describe option,
layout, focus, or command changes. Another tmux client can change the session
after planning, so the plan is advisory.

`WorkspaceApplyError` reports completed milestones, the failed stage, and the
underlying cause. Its `requiresReplan` flag requires a fresh inspection after
failure. There is no rollback, and a transport failure may leave command
delivery uncertain. Do not infer that replaying the same command is safe from
a failed apply alone.

[Workspace behavior](https://github.com/libtmux/libtmux-ts/blob/f85b8de551353f746d50eaf36bf0112f4fe5a528/packages/workspace/README.md)
