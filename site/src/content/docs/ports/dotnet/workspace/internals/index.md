---
title: ".NET workspace internals"
description: "Architecture and development interfaces of the .NET workspace builder."
port: dotnet
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

`WorkspaceFile.Parse` validates the YAML. `WorkspaceBuilder.BuildAsync`
creates the session through a supplied core `Server` and returns its
materialized objects. The caller supplies file reading, cancellation,
command-line handling, attachment, and server lifetime.

## Read the implementation

- [Guides](./guides/) show builder setup and application code.
- [Topics](./topics/) explain configuration, behavior, and failures.
- [Examples](./examples/) exercise the builder through the language API.
- [API](../reference/) links the configuration and construction interfaces.

## Implementation scope

`LibTmux.Workspace` reads a YAML file
and builds its session through LibTmux. It returns the session, materialized
windows, and any layouts that tmux rejected while leaving their windows usable.

Use it from a launcher or another .NET application that already controls a
tmux server. The package adds YAML parsing separately from the core client.

## Package and runtime

The package targets .NET 8 and .NET 10 and uses YamlDotNet. tmux must run on
the host. Pin the prerelease selected by your package manager because public
contracts can change between alpha versions.

The parser rejects unknown fields. The caller reads the file and selects
the server; parsing does not search configuration directories or load
extensions.

[Package documentation](https://github.com/libtmux/libtmux-dotnet/blob/6656a563ec9e07ab52e0c3ac96f7704fc94cc0c0/src/LibTmux.Workspace/README.md)
