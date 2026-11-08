---
title: LibTmux::Workspace API reference
description: Public Perl workspace configuration, planning, loading, and error APIs.
port: perl
product: workspace
sidebar:
  label: Language API
  order: 4
---

Use [LibTmux::Workspace](./libtmux-workspace/) to validate configuration,
inspect a plan, and load sessions, windows, and panes through public core
APIs. Planning performs no tmux I/O. Loading reports completed steps,
conflicts, and partial failures.

The declarations below preserve native signatures, POD links, and source
locations. Read the [workspace guide](../source-guide/) for the versioned
JSON format, source installation, and complete CLI examples.
