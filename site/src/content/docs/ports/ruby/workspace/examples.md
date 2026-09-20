---
title: Ruby workspace examples
description: A bounded creation-only workspace for libtmux-workspace.
port: ruby
product: workspace
sidebar:
  label: Examples
  order: 3
---

Save this as `workspace.yaml`:

```yaml
session_name: work
environment:
  PROJECT_MODE: development
windows:
  - window_name: editor
    window_index: 1
    layout: tiled
    panes:
      - shell_command: printf 'editor ready\n'
      - {}
```

Run `libtmux-workspace validate workspace.yaml`, inspect
`libtmux-workspace plan --json workspace.yaml`, then pass an owned socket to
`load`. Relative directories resolve against the configuration file.

The [source-owned workspace guide](../source-guide/) links the installed-package
example that checks inert planning, apply, and guarded compensation.
