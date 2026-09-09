---
title: "Java workspace builder behavior"
description: "Internal configuration, application, and failure contracts of the Java workspace builder."
port: java
product: workspace
sidebar:
  group: Internals
  label: Topics
  order: 1
tableOfContents: true
---

A `Workspace` is an immutable description of a session. `read` and `parse`
create that description. `build` is the operation that changes tmux.

## Supported configuration

The root accepts `session_name` and `windows`. Windows carry names, layouts,
and panes. A pane can be a command string, a list of commands, or a mapping
with `shell_command`. An omitted pane list still produces tmux's initial pane.

Unknown keys and unsupported value shapes are rejected. Layout names and
layout descriptions are checked before construction; support for a named
layout is checked against the target tmux version before creating objects.
Session names containing `.` or `:` are rejected because those characters
conflict with tmux target syntax.

## Construction and commands

The builder creates a uniquely named staging session and renames that exact
session to the requested name. It does not take over an existing session with
the same name. All windows and panes are created before pane commands are
sent, and layouts are applied before those commands run.

Completion returns a refreshed `Session`. It establishes that the builder's
tmux operations completed; it does not establish that a server launched by a
pane command is ready to serve requests.

## Failure cleanup

When construction fails, the builder attempts to kill the exact session it
created. If the initial creation did not produce a usable handle, it targets
the unique staging name. This keeps cleanup scoped to the new workspace.

Cleanup can also fail. The builder preserves that failure as a suppressed
exception on the original exception. Inspect suppressed exceptions before
assuming the partial session was removed. Removing tmux objects cannot undo
external effects already produced by shell commands.

[Construction and cleanup](https://github.com/libtmux/libtmux-java/blob/4f057d367a25dee818d70876fa283fc503a3a7eb/libtmux-workspace/src/main/java/io/github/libtmux/workspace/WorkspaceApplier.java); [YAML validation](https://github.com/libtmux/libtmux-java/blob/4f057d367a25dee818d70876fa283fc503a3a7eb/libtmux-workspace/src/main/java/io/github/libtmux/workspace/WorkspaceParser.java).
