---
title: "Workspace Manager for .NET"
description: "Build tmux sessions from YAML with LibTmux.Workspace."
port: dotnet
product: workspace
sidebar:
  label: Overview
  order: 0
tableOfContents: true
---

`LibTmux.Workspace` reads a tmuxp-style YAML file and builds its session through
LibTmux. It returns the session, materialized windows, and any layouts that
tmux rejected while leaving their windows usable.

Use it from a launcher or another .NET application that already controls a
tmux server. The package adds YAML parsing separately from the core client.

## Start here

- [Guides](./guides/) install the package and build an isolated workspace.
- [Topics](./topics/) explain validation, readiness, and partial results.
- [Examples](./examples/) connect the documented example to its checks.
- [API](./api/) covers configuration, results, and builder options.

## Package and runtime

The package targets .NET 8 and .NET 10 and uses YamlDotNet. tmux must run on
the host. Pin the prerelease selected by your package manager because public
contracts can change between alpha versions.

The accepted format is a closed subset. Unknown keys, Python plugins,
configuration search paths, and tmuxp hooks are not silently accepted.

[Package documentation](https://github.com/libtmux/libtmux-dotnet/blob/6656a563ec9e07ab52e0c3ac96f7704fc94cc0c0/src/LibTmux.Workspace/README.md)
