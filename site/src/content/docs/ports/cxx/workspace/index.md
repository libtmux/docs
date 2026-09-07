---
title: "Workspace Manager for C++"
description: "Build tmux workspaces with the C++ repository consumer and its YAML reader."
port: cxx
product: workspace
sidebar:
  label: Overview
  order: 0
tableOfContents: true
---

The C++ repository includes a workspace consumer that builds a described tmux
session and reads tmuxp-style YAML. It exercises libtmux's public API from a
separate target.

The workspace headers and parser belong to `examples/workspace`. They are
not installed with the core libtmux package. Use the consumer from a source
checkout or adapt it into your own application with its dependencies.

## Start here

- [Guides](./guides/) build and run the consumer's existing tests.
- [Topics](./topics/) explain supported data, command order, and failure
  effects.
- [Examples](./examples/) connect the typed workspace example to real-tmux
  tests.
- [API](./api/) describes the consumer's headers and result types.

## Dependencies

The workspace builder uses the core C++ API. Reading YAML adds yaml-cpp to the
consumer target; the core library does not acquire that dependency. Building
and exercising the consumer requires the repository's CMake toolchain and
tmux on a supported host.

The consumer creates a new session. It does not converge an existing session
or export a live session back to a workspace file.

[Consumer documentation](https://github.com/libtmux/libtmux-cxx/blob/3770a3f83d73aeb4af01c25c3d817733fa558c99/examples/workspace/README.md)
