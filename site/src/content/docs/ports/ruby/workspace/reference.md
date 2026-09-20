---
title: Ruby workspace API reference
description: Public libtmux-workspace parsing, planning, application, and CLI types.
port: ruby
product: workspace
sidebar:
  label: Language API
  order: 4
---

Require `libtmux/workspace` for library use. Parsing and planning do not start
tmux or execute commands. `Plan#apply` requires an explicitly opened core
server and leaves that binding open.

The declarations below come from the public Ruby inventory, enriched with RBS
signatures, YARD documentation, behavior contracts, and source coordinates at
the selected revision.
