---
title: "C++ workspace builder behavior"
description: "Internal configuration, application, and failure contracts of the C++ workspace builder."
port: cxx
product: workspace
sidebar:
  group: Internals
  label: Topics
  order: 1
tableOfContents: true
---

The consumer separates parsing from application. `parse_tmuxp` reads a YAML
document into a `Workspace`; `build` applies the typed description through a
core `Server`.

## Supported data

Configuration covers session and window names, working directories,
environment values, options, layouts, focus, window indexes, and pane
commands. The YAML reader rejects keys outside its supported subset and
returns a document path and reason. Python runtime features are not loaded.

A `Command` holds text, whether to press Enter, pauses before and after
sending, and history suppression. A command with `enter: false` leaves text
at the prompt. Pauses delay construction; they do not check application
readiness. History suppression adds a leading space, whose effect depends on
the shell's history configuration.

## Build ordering

Open the core server handle after its tmux socket exists. A handle opened
before daemon startup can become stale when the builder creates the first
session. The consumer tests use a running isolated fixture before connecting.

The builder creates all described windows and panes before delivering pane
commands. It addresses panes by their actual IDs, so a configured
`pane-base-index` does not redirect input to the wrong pane.

Window options are applied before layouts. `options_after` is applied once
panes exist, which allows settings such as synchronized input to take effect
after creation. Focus choices are applied after the corresponding objects
exist.

## Failure effects

The requested session must be new. A failure returns `BuildError` with a
window position and diagnostic reason. Operations completed before the failure
remain in tmux; there is no rollback or attached partial-session handle in the
error. Inspect the dedicated server before retrying or removing a session.

The parser has its own `ParseError`, with a path through the YAML document.
Keep parsing errors separate from tmux failures when reporting a problem to
someone editing the workspace file.

[Build and command contracts](https://github.com/libtmux/libtmux-cxx/blob/c7f1146d2ebd7a8323d9f9814517dc3cdf86b4ee/examples/workspace/include/libtmux_consumers/workspace.hpp); [Parsing contract](https://github.com/libtmux/libtmux-cxx/blob/c7f1146d2ebd7a8323d9f9814517dc3cdf86b4ee/examples/workspace/include/libtmux_consumers/tmuxp.hpp).
