---
title: Ruby workspace topics
description: Workspace format, planning boundaries, application effects, and failure ledgers.
port: ruby
product: workspace
sidebar:
  label: Topics
  order: 2
---

## Configuration boundary

The supported format describes one session with windows, panes, options,
directories, environment values, and shell commands. YAML tags, aliases,
duplicate keys, ERB, plugins, and callbacks are rejected. Environment
substitution is opt-in and consults only the explicitly supplied mapping.

## Creation-only plans

Plans create new state and reject a captured session-name conflict. They do
not reconcile an existing workspace. Every apply takes a fresh snapshot and
rechecks its binding and the target name before the first creation command.

## Effects and failure

Shell commands are dispatched as literal text followed by Enter. Success means
tmux accepted the dispatch, not that the shell command finished. An apply
failure retains completed steps, positively identified created references,
observed or dispatch-only effects, uncertainty, and cleanup diagnostics.

Optional compensation kills only a positively returned new session after an
atomic guard proves ownership of every current window and pane. Unknown or
borrowed entities cause cleanup refusal.

[Source-owned workspace guide](../source-guide/)
