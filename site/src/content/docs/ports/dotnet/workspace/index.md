---
title: "Workspace Manager for .NET (in development)"
description: "The .NET workspace manager is unfinished; builder APIs are available, but there is no workspace loader CLI."
port: dotnet
product: workspace
sidebar:
  label: Overview
  order: 0
tableOfContents: true
---

The current implementation is `LibTmux.Workspace`, a library package for parsing YAML and building sessions.
Using it requires application code. Installing or building it does not provide
a command that accepts a workspace file and loads your session.

## Load a workspace from the terminal

Use [tmuxp](https://tmuxp.git-pull.com/) for the existing workspace CLI. Its
[Python workspace guide](/py/latest/workspace/guides/) covers installation and
`tmuxp load` with YAML or JSON configuration. tmuxp is a separate Python
application, not a .NET command.

## Start here

The [Internals](./internals/) section documents the current builder:

- [Guides](./internals/guides/) show application setup and builder calls.
- [Topics](./internals/topics/) explain supported configuration and behavior.
- [Examples](./internals/examples/) exercise the library or source consumer.
- [API](./internals/api/) covers the builder and configuration interfaces.
