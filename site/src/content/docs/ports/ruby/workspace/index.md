---
title: Workspace Manager for Ruby
description: Validate, plan, and load bounded YAML or JSON workspaces with libtmux-workspace.
port: ruby
product: workspace
sidebar:
  label: Overview
  order: 0
---

`libtmux-workspace` parses bounded YAML or JSON into an immutable creation
plan. `validate` and offline `plan` do not contact tmux. `load` and
`plan --live` borrow an existing server selected with `--socket`.

The manager creates a new session. It does not reconcile, replace, or delete a
preexisting workspace. Applying a plan authorizes declared shell commands;
their delivery does not prove that the pane programs completed.

## Start here

- [Guides](./guides/) covers `validate`, `plan`, and `load`.
- [Topics](./topics/) explains the supported format and creation-only model.
- [Examples](./examples/) provides a bounded YAML configuration.
- [Language API](./reference/) documents the workspace gem.

The [source-owned workspace guide](./source-guide/) is staged from the same
revision as the generated reference.
