---
title: "Swift workspace topics"
description: "Understand the structural format, session values, YAML traits, and rollback."
port: swift
product: workspace
sidebar:
  label: Topics
  order: 1
tableOfContents: true
---

`Workspace`, `WindowPlan`, and `PanePlan` are Swift values that describe the
objects to create. Their Codable keys use tmuxp's field spelling.

## Supported format

JSON decoding is always available. YAML decoding is compiled only when the
package enables `YAMLWorkspaces`, which brings in Yams. Unknown keys are
ignored by decoding; successful decoding does not establish full tmuxp
compatibility.

The model covers names, directories, layouts, and pane commands. Python
plugins, hooks, and tmuxp's environment runtime are outside that model. A
window directory overrides the workspace directory. A split pane can provide
its own directory; the initial pane is created with its window's directory.

Commands can request Enter or leave literal text unsubmitted. A successful
build means the builder delivered its operations, not that a program launched
in a pane is ready or has finished.

## Values and observation

The returned `Session` is a captured value, not a live object that refreshes
its properties. The builder creates additional windows after obtaining the
initial session value. Ask the server for a fresh snapshot when inspecting
the completed window and pane membership.

Encoding a `Workspace` serializes the description you already hold. It is not
a live-session freeze operation and does not export the current state of tmux.

## Existing names and failure cleanup

The builder refuses an existing session name. If a later operation fails, it
attempts cleanup using the exact created session, with an independent bounded
cleanup task. Cancellation of the build does not itself cancel that cleanup.

`WorkspaceBuilderError.rollbackFailed` carries the original error and the
cleanup error. Inspect both before deciding whether a partial session remains.
Removing a session cannot undo external effects already caused by its commands.

[Configuration model](https://github.com/libtmux/libtmux-swift/blob/46b003c3606e03f1e4ce1ecfc92d87748e4c2095/Sources/TmuxWorkspace/Workspace.swift); [Builder and rollback](https://github.com/libtmux/libtmux-swift/blob/46b003c3606e03f1e4ce1ecfc92d87748e4c2095/Sources/TmuxWorkspace/WorkspaceBuilder.swift).
