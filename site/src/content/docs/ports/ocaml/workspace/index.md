---
port: ocaml
product: workspace
route: workspace
title: tmux workspace manager,
subtitle: forged in OCaml.
shortTitle: OCaml-based tmux workspace manager
description: Validate, preview and apply JSON workspaces through the native OCaml library.
sidebar:
  label: Overview
  order: 0
cards:
  - label: Workspace guide
    href: ./source-guide/
    body: Validate, plan and apply JSON configuration, then inspect its receipt.
  - label: Interrupted execution
    href: ./recovery/
    body: Retain the journal, inspect partial effects and check compensation.
  - label: API reference
    href: ./reference/
    body: Browse pure validation and planning alongside explicit execution.
---

Install `libtmux-workspace-cli` from the source checkout to run `tmux-workspace`.
The CLI uses the JSON decoder, pure workspace plan and native client packages.
It retains a receipt for recovery after partial or uncertain execution.
The journal lives in process memory; it does not resume a later CLI invocation.

[Run a complete workspace](../workspace/source-guide/) ·
[Inspect an interrupted workspace](./recovery/) ·
[Workspace API](../workspace/reference/)
