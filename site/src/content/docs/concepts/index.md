---
title: Concepts
description: The mental model every libtmux port shares, before you read any one port's reference.
sidebar:
  label: Overview
  group: Concepts
  order: 1
---

Eight ports, one tmux underneath. Before reaching for a port's API reference,
it helps to have the model that all eight agree on — and the places where
they genuinely differ, so you're not surprised when Python's `.filter()`
doesn't look like TypeScript's `.where()`, or when "sending keys" is a
single subprocess call in one port and a persistent connection in another.

This section covers four things every port shares or deliberately varies on:

- **[Server, session, window, pane](server-session-window-pane/)** —
  the object hierarchy tmux itself defines, and the one thing that sits
  outside it (the attached client).
- **[Control mode vs one-shot](transports/)** — how a call in your
  program actually reaches the tmux server: a subprocess per command, a
  persistent control-mode client, or several commands folded into one
  invocation.
- **[Filtering and queries](queries/)** — how you go from "every
  session on the server" to "the one pane I mean," and what happens when
  zero or several match.
- **[Workspaces](workspaces/)** — building a multi-pane layout
  from code instead of by hand, and the tmuxp-shaped declarative builders
  most ports ship alongside the object API.

None of this is reference material for one specific port — for that, use the
port switcher to jump to a port's own API pages. This section is what stays
true (or interestingly doesn't) as you move between them.
