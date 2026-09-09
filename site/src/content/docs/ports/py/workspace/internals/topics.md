---
title: "Python workspace builder behavior"
description: "tmuxp's internal configuration pipeline, builder selection, and session handling."
port: py
product: workspace
sidebar:
  label: Topics
  group: Internals
  order: 1
tableOfContents: true
---

The CLI separates configuration processing, construction, and attachment.
These Python implementation interfaces have no stability guarantee.

## Expand before building

The loader reads YAML or JSON, expands command shorthand, variables, and
paths, then applies inherited defaults. The builder expects the expanded
configuration. The [internal example](../examples/) shows this sequence with
an isolated libtmux server.

## Select a builder

`ClassicWorkspaceBuilder` is the default builder. `workspace_builder` selects
an importable class or a registered entry point; `workspace_builder_paths`
adds explicitly configured import directories. Plugins and custom builders
run inside the Python process. Those extension imports are not portable
workspace data for the other language ports.

The classic builder accepts an optional existing session and an append
choice. Failure handling depends on the operation and CLI path; a workspace
build does not have universal transactional rollback. The CLI owns its
existing-session prompts and the attachment or client-switching workflow.

See the upstream [custom builder guide](https://tmuxp.git-pull.com/topics/custom-workspace-builders/)
for extension configuration and the [API](../api/) for interface contracts.

[Configuration loader](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/loader.py); [Classic builder](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/classic.py).
