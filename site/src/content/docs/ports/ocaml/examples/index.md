---
title: OCaml examples
description: Run complete native OCaml programs against an isolated tmux server.
port: ocaml
route: examples
cards:
  - label: Capability showcases
    href: ../guides/showcases/
    body: Run installed programs with explicit setup, output checks and cleanup.
  - label: Partial-failure recovery
    href: ../guides/recovery/
    body: Inspect retained outcomes before deciding which action to take next.
  - label: Workspaces
    href: ../workspace/source-guide/
    body: Validate, plan and apply a complete JSON workspace.
  - label: Interrupted workspace
    href: ../workspace/recovery/
    body: Cancel an Eio waiter, inspect its journal and check the created session.
---

Start with the [graph program](../guides/getting-started/), then run the
[capability showcases](../guides/showcases/). Each complete program uses public
packages and documents its inputs and ownership of tmux resources.
