---
title: "C++ workspace internals"
description: "Architecture and development interfaces of the C++ workspace builder."
port: cxx
product: workspace
sidebar:
  label: Overview
  group: Internals
  order: 0
tableOfContents: true
---

Build and inspect tmux sessions from application code with the workspace
library. To load files from a terminal, start with the
[native CLI walkthrough](../guides/installation/).

## Builder pipeline

`parse_tmuxp` converts YAML into typed workspace data. `build` applies that
data through a core `Server`. The `workspace_builder` target keeps YAML
parsing separate from the core library. Its executables exercise parsing and
builder tests; they do not load workspace files as a user application.

## Read the implementation

- [Guides](./guides/) show builder setup and application code.
- [Topics](./topics/) explain configuration, behavior, and failures.
- [Examples](./examples/) exercise the builder through the language API.
- [API](../reference/) links the configuration and construction interfaces.

## Implementation scope

The C++ repository includes a workspace consumer that builds a described tmux
session and reads YAML. It exercises
libtmux's public API from a separate target.

The workspace headers and parser belong to `examples/workspace`. They are
not installed with the core libtmux package. Use the consumer from a source
checkout or adapt it into your own application with its dependencies.

## Dependencies

The workspace builder uses the core C++ API. Reading YAML adds yaml-cpp to the
consumer target; the core library does not acquire that dependency. Building
and exercising the consumer requires the repository's CMake toolchain and
tmux on a supported host.

The consumer creates a new session. It does not converge an existing session
or export a live session back to a workspace file.

[Consumer documentation](https://github.com/libtmux/libtmux-cxx/blob/c7f1146d2ebd7a8323d9f9814517dc3cdf86b4ee/examples/workspace/README.md)
