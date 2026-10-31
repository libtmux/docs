---
title: tmux workspace manager, forged in Julia
shortTitle: Julia-based tmux workspace manager
description: Read, validate, plan and load tmux workspace files with LibTmuxWorkspace.
port: julia
product: workspace
sidebar:
  label: Overview
  order: 0
---

`LibTmuxWorkspace` reads a tmuxp-style YAML and JSON subset. Validation,
expansion and planning do not contact tmux. Applying a plan creates tmux
resources and can execute shell input.

Follow the [workspace guide](./source-guide/) to install the package,
inspect a plan and run the complete owned-server example. The
[API reference](./reference/) documents the workspace types and methods.
