---
title: tmux workspace manager, built in Common Lisp, is source-only
description: Validate, plan, apply and inspect owned JSON workspaces with the native Common Lisp engine.
port: lisp
product: workspace
sidebar:
  label: Availability
  order: 0
tableOfContents: true
---

The Common Lisp workspace manager is implemented and tested from the same
source checkout as the core library. It is not published as a separate system
or executable. Build the pinned toolchain and run it through `mise`:

```console
$ mise exec -- tools/lisp.sh tools/workspace-cli.lisp -h
```

The command validates a bounded JSON document before it contacts tmux. Its
`plan`, `apply` and `inspect` commands take `--socket-path` for the tmux server
that owns the workspace, and `--program` to select the tmux executable. An
owned workspace needs fresh state from that server before it can be planned, so
`plan` reads tmux; the preview itself changes nothing. `apply` reacquires and
verifies each target before it acts, and `inspect` reports stopped work without
mutating. Add `--reconcile` to `plan` or `apply` to permit changes to an owned
workspace; a preview grants no authority to apply. Only the legacy topology
schema plans offline. An application failure reports the retained step outcomes
and dispatch status; it does not claim transactional rollback.

Read the [source installation and command guide](source-guide/) for the file
format, validation limits, planning output, apply behavior, and exit status.
Use the [core guides](../guides/) for snapshot ownership, explicit operations,
and private tmux fixtures.
