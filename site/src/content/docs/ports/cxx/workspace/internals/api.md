---
title: "C++ workspace builder API"
description: "Internal reference for the C++ workspace builder and configuration APIs."
port: cxx
product: workspace
sidebar:
  group: Internals
  label: API
  order: 4
tableOfContents: true
---

The workspace API described here belongs to the repository consumer. Its
headers are available through the `workspace_builder` target and are not
installed core library headers.

## Typed description

`libtmux_consumers/workspace.hpp` defines the `libtmux::workspace` namespace:

- `Workspace` holds the session name, directories, options, environment, and
  windows.
- `Window` holds layout, options, index, focus, and panes.
- `Pane` holds its shell, directory, environment, focus, and commands.
- `Command` controls text, Enter, delays, and history suppression.

`build(const Server&, const Workspace&)` returns
`libtmux::expected<libtmux::Session, BuildError>`. `BuildError` contains a
window index and reason. It does not contain a rollback result or guarantee
that the server is unchanged.

## YAML reader

`libtmux_consumers/tmuxp.hpp` declares `parse_tmuxp(std::string_view)`,
returning
`libtmux::expected<Workspace, ParseError>`. `ParseError.where` identifies the
configuration path and `reason` explains the refusal.

The compiled implementation in `src/tmuxp.cpp` is the part that depends on
yaml-cpp. Applications constructing `Workspace` values directly do not need
to parse YAML.

## Core operations

The returned session is a core libtmux value. Use the
[C++ core reference](/reference/cxx/) for subsequent inspection and mutation.
Consumer source contracts remain the authority for the workspace types.

[Workspace header](https://github.com/libtmux/libtmux-cxx/blob/c7f1146d2ebd7a8323d9f9814517dc3cdf86b4ee/examples/workspace/include/libtmux_consumers/workspace.hpp); [YAML header](https://github.com/libtmux/libtmux-cxx/blob/c7f1146d2ebd7a8323d9f9814517dc3cdf86b4ee/examples/workspace/include/libtmux_consumers/tmuxp.hpp).
