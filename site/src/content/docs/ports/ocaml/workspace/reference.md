---
title: OCaml workspace API reference
description: Public OCaml workspace validation, planning and execution APIs.
port: ocaml
product: workspace
sidebar:
  label: Language API
  order: 4
---

Use `Libtmux_workspace` to validate configuration and build a plan without I/O.
Execute the plan through an explicit native client and retain its journal for
recovery. `Libtmux_json` decodes the versioned workspace JSON format.

The declarations below document the workspace library at this site's source
revision. The [workspace guide](../source-guide/) shows installation, planning,
execution and receipt inspection with `tmux-workspace`.
