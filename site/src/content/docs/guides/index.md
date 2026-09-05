---
title: Guides
description: Task-oriented walkthroughs that sit between the concepts and each port's own API reference.
sidebar:
  label: Overview
  group: Guides
  order: 1
---

Guides are where you land once you know roughly what you want to do and
need a walkthrough rather than a mental model or a reference page. If you
haven't yet decided which port fits your project, or you're unsure what
"control mode" or "filtering" mean in this ecosystem, start with
[Concepts](/concepts/) instead — this section assumes you've read that or
don't need it.

- **[Getting started](getting-started/)** — install tmux, pick a
  port, and run the smallest thing that proves your setup works: open a
  session, send a command, read back what it printed.
- **[Attaching to tmux](attaching-to-tmux/)** — which socket a plain
  constructor call actually reaches, and how to find a session that might
  already exist instead of always creating a new one.
- **[Sending keys](sending-keys/)** — the difference between typing
  and pressing Enter, why a command can outrun the shell that's about to
  run it, and how each port's `send_keys` actually spells "literal text."
- **[Capturing output](capturing-output/)** — the visible pane versus
  its scrollback, why polling `capture_pane` in a loop is the wrong default
  once a port gives you something better, and how to wait for text instead
  of guessing how long a command takes.
- **[Filtering and querying, in practice](querying-and-filtering/)**
  — the how-to companion to [Filtering and queries](/concepts/queries/):
  finding the one pane you mean, and what each port does when zero or
  several match.
- **[Testing with libtmux](testing-with-libtmux/)** — every port ships
  a way to give your own tests a real, disposable tmux server. What each
  one hands you, and what it guarantees about cleanup.

Each guide links out to [Examples](/examples/) for the literal, sourced
code behind whatever it discusses — a guide is where the tradeoffs and the
gotchas live; the tested snippet lives on the example page.
