---
title: tmux workspace manager, forged in Elixir, is not published
description: The Elixir repository contains a workspace package scaffold, not a loader or supported builder API.
port: elixir
product: workspace
sidebar:
  label: Availability
  order: 0
tableOfContents: true
---

Elixir has no published libtmux workspace manager. The repository's
`packages/workspace` directory is a scaffold: its README says the package is
under implementation and has no loader or executable yet.

This page records availability without advertising placeholder code. There is
no Elixir equivalent of `libtmux-workspace validate`, `plan`, or `load`, and no
workspace reference tree is generated.

Use the [core Elixir library](../guides/overview/) to observe tmux and run
commands on an existing server. A workspace tool from another language remains
a separate application with its own configuration contract; it is not an
Elixir feature.
