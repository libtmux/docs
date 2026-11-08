---
title: tmux workspace manager, built in Common Lisp, is source-only
description: Validate, plan, and explicitly apply bounded JSON workspaces with the native Common Lisp engine.
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

The command validates a bounded JSON document before it contacts tmux. Planning
is local. Applying a plan uses the native client and reports every step's
outcome; it does not claim transactional rollback.

Read the [source installation and command guide](source-guide/) for the file
format, validation limits, planning output, apply behavior, and exit status.
Use the [core guides](../guides/) for snapshot ownership, explicit operations,
and private tmux fixtures.
