---
title: "Python workspace topics"
description: "Understand workspace configuration, existing sessions, and tmuxp freeze."
port: py
product: workspace
sidebar:
  label: Topics
  order: 1
tableOfContents: true
---

Use `tmuxp load` to turn a YAML or JSON configuration into a tmux session.
The configuration controls its windows, panes, directories, and commands.

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

## Export a session

`tmuxp freeze` writes the structure of a running session as YAML or JSON. It
recovers current layouts and working directories, and uses observable current
programs when forming commands. It cannot recover the original command line,
process memory, or a complete application checkpoint. Review its output
before relying on it as a launcher.

See the upstream [workspace configuration](https://tmuxp.git-pull.com/configuration/)
for supported fields. Contributor details about the loader and custom builders
belong in [Internals](../internals/topics/).

[Expansion implementation](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/loader.py); [Freeze implementation](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/freezer.py).
