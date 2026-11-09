---
title: tmux workspace manager,
subtitle: forged in Perl.
shortTitle: Perl-based tmux workspace manager
description: Validate, plan, and load versioned JSON workspaces with LibTmux-Workspace.
port: perl
product: workspace
sidebar:
  label: Overview
  order: 0
---

[LibTmux-Workspace](./reference/) is a separate native Perl distribution using public core
APIs. Its `libtmux-workspace` command validates, plans, and loads the
[libtmux.workspace/v1 JSON format](./source-guide/). Planning performs no tmux I/O. Loading
creates sessions, windows, and panes, with explicit conflict and repeat policies.

Install core first, then workspace from the same source checkout. These
packages are not published to CPAN. The [workspace guide](./source-guide/)
contains the configuration contract and installed CLI commands. The
[API reference](./reference/) documents the public loader and report errors.
