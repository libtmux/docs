---
title: "Python workspace internal API"
description: "tmuxp APIs for expanding configuration, building sessions, and exporting layouts."
port: py
product: workspace
sidebar:
  group: Internals
  label: API
  order: 4
tableOfContents: true
---

tmuxp's workspace APIs are internal implementation details with no stability
guarantee. They use libtmux's `Server`, `Session`, `Window`, and `Pane` objects
for tmux control. Use the [CLI guide](../../guides/) to load workspace files.

## Load and validate

`tmuxp.workspace.loader.expand` normalizes shorthand, variables, and paths.
`loader.trickle` applies inherited configuration after expansion. Both operate
on workspace dictionaries. `validation.validate_schema` checks required
structure; it is not a complete machine-readable schema of every runtime
behavior.

Consult the upstream [loader API](https://tmuxp.git-pull.com/internals/api/workspace/loader/)
and [validation API](https://tmuxp.git-pull.com/internals/api/workspace/validation/)
for parameter and error details.

## Build and extend

`tmuxp.workspace.builder.WorkspaceBuilder` is the compatibility alias for
`ClassicWorkspaceBuilder`. Construct it with expanded `session_config` and a
libtmux server, call `build`, then read `ClassicWorkspaceBuilder.session`.

`WorkspaceBuilderProtocol` defines the interface used by the CLI, including
construction callbacks, building into an optional existing session, and
session discovery. The registry resolves named entry points or import paths.
Use the upstream [builder API](https://tmuxp.git-pull.com/internals/api/workspace/builder/)
and [custom builder guide](https://tmuxp.git-pull.com/topics/custom-workspace-builders/)
when implementing an extension.

## Export and CLI

`tmuxp.workspace.freezer.freeze(session)` reads a live session into a
configuration dictionary. `freezer.inline` compacts that expanded structure
for a file. The [freezer API](https://tmuxp.git-pull.com/internals/api/workspace/freezer/)
documents both operations.

The [CLI reference](https://tmuxp.git-pull.com/cli/) covers loading, freezing,
listing, searching, editing, importing, and converting workspaces. These are
application commands, separate from the language-level workspace builder.

[Public builder exports](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/__init__.py)
