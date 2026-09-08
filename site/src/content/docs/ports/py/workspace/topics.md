---
title: "Python workspace topics"
description: "Understand tmuxp configuration expansion, builder behavior, and freezing."
port: py
product: workspace
sidebar:
  label: Topics
  order: 1
tableOfContents: true
---

tmuxp loads a workspace through several stages: read the YAML or JSON,
expand shorthand and variables, apply inherited defaults, then build the
session through a workspace builder.

## Configuration and commands

A workspace names a session and contains windows with panes. Pane shorthand
can name a command directly, while mappings describe command lists, working
directories, focus, and other configuration. The loader expands environment
variables and resolves relative paths using the workspace location.

`shell_command_before` supplies setup commands inherited by the relevant panes.
Commands, scripts, plugins, and custom builders execute code in your runtime.
Use workspace files whose commands and extension imports you intend to run.
Successful construction does not mean a launched application has completed
startup; its own readiness check is a separate task.

## Existing sessions

`tmuxp load` handles attachment and switching as part of its CLI workflow. It
can attach to an existing named session, and its append mode adds windows to
the current session. Those choices differ from replacing a session or
converging a description automatically. Read the load command's prompts and
options before automating an existing-session workflow.

At the Python layer, the classic builder accepts an optional existing session
and an append choice. Failure handling depends on the operation and CLI path;
do not assume a workspace is a transaction with universal rollback.

## Builders and exports

`ClassicWorkspaceBuilder` is the default builder. `workspace_builder` selects
an importable class or a registered entry point; `workspace_builder_paths`
adds explicitly configured import directories. Plugins and custom builders
are Python runtime features rather than portable YAML fields.

`tmuxp freeze` writes the structure of a running session as YAML or JSON. It
recovers current layouts and working directories, and uses observable current
programs when forming commands. It cannot recover the original command line,
process memory, or a complete application checkpoint. Review its output
before relying on it as a launcher.

See the upstream [workspace configuration](https://tmuxp.git-pull.com/configuration/)
and [custom builders](https://tmuxp.git-pull.com/topics/custom-workspace-builders/)
for the full contracts.

[Expansion implementation](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/loader.py); [Freeze implementation](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/freezer.py).
