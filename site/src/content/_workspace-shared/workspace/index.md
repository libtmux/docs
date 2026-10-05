---
title: Workspace manager
description: Describe a tmux session in a file, then load, inspect and capture it.
product: workspace
ports:
  py:
    title: Python workspace manager
  ts:
    title: TypeScript workspace manager
  rs:
    title: Rust workspace manager
  go:
    title: Go workspace manager
  java:
    title: Java workspace manager
  csharp:
    title: C# workspace manager
  cxx:
    title: C++ workspace manager
  swift:
    title: Swift workspace manager
sidebar:
  label: Workspace manager
  order: 0
tableOfContents: true
cards:
  - label: Command reference
    href: ./cli/
    body: Commands, options and machine output.
  - label: Configuration
    href: ./configuration/
    body: Workspace fields, normalization and execution.
  - label: Install and load
    href: ./guides/installation/
    body: Load a workspace on a private socket, then capture it.
  - label: Example gallery
    href: ./examples/gallery/
    body: Workspace files to start from, with their prerequisites.
  - label: Runtime support
    href: ./reference/compatibility/
    body: Runtime requirements and supported behavior.
  - label: Internals
    href: ./internals/
    body: The workspace library, for building sessions from code.
---

<!-- port:py -->
[tmuxp](https://tmuxp.git-pull.com/) loads tmux sessions from YAML or JSON using
libtmux. A file describes windows, panes and commands. `tmuxp load` builds the
session and can attach to it or leave it detached.

## Start here

1. [Install tmuxp and load a workspace](./guides/installation/).
2. [Configure windows and panes](./configuration/).
3. [Capture and reload a session](./guides/export-session/).

The [command reference](./cli/) covers discovery, search, editing, conversion
and import. Use [examples](./examples/gallery/) for complete files and their
prerequisites.

Install tmuxp separately from the core libtmux package. Its dependency resolver
selects a compatible libtmux release. [Workspace internals](./internals/)
describe the builder and Python extension APIs.

[Quickstart source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/docs/quickstart.md).
<!-- /port -->

<!-- port:ts,rs,go,java,csharp,cxx,swift -->
`tmux-workspace` creates tmux sessions from YAML or JSON. A file describes
windows, panes, commands, directories and environment. Load it from a terminal
or request machine output for automation.

## Load a workspace from the terminal

1. [Install the command and load a workspace](./guides/installation/).
2. [Configure windows and panes](./configuration/).
3. [Capture and reload a session](./guides/export-session/).

The [command reference](./cli/) covers discovery, search, editing, loading,
capture, conversion and import. [Examples](./examples/gallery/) provide
complete configurations with their prerequisites.

## Automate and inspect

Use `load -d` when the caller should return without attaching. `--json` returns
a result, and `--ndjson` supports a stream of records. Read
[automation](./guides/automation/) for retry and cleanup decisions and
[errors](./reference/exit-codes/) for failure handling.

Loaded workspaces are ordinary tmux sessions. Select the same socket when
inspecting them from tmux or the [MCP server](../mcp/).

## Build from application code

The [workspace library](./internals/) has its own API and configuration
contract. Use it when a program needs direct control over construction. The
CLI task guides here describe the `tmux-workspace` executable and link to its
documented source revision.

<!-- port:ts -->
[CLI source](https://github.com/libtmux/libtmux-ts/blob/f36d692552bb9a373b45338bb5fece854e57cc3d/packages/workspace-cli/README.md).
<!-- /port -->
<!-- port:rs -->
[CLI source](https://github.com/libtmux/libtmux-rs/blob/e9be0b6f6d22cd2eb79b0ec08964f82e717e5fe4/crates/tmux-workspace/docs/cli.md).
<!-- /port -->
<!-- port:go -->
[CLI source](https://github.com/libtmux/libtmux-go/blob/bb06e26e116e941813ca40bf45e7e3a47d38f52a/workspace/CLI.md).
<!-- /port -->
<!-- port:java -->
[CLI source](https://github.com/libtmux/libtmux-java/blob/3e5b20d22af3890ae5f7f52842e4b05d170a983f/libtmux-workspace-cli/README.md).
<!-- /port -->
<!-- port:csharp -->
[CLI source](https://github.com/libtmux/libtmux-dotnet/blob/f77fe776ba67a04abb20ddbbc26cf4a000d63b74/src/LibTmux.Workspace.Cli/README.md).
<!-- /port -->
<!-- port:cxx -->
[CLI source](https://github.com/libtmux/libtmux-cxx/blob/9c8c6a264114277df84c9f6819855093adae5c6e/apps/workspace/README.md).
<!-- /port -->
<!-- port:swift -->
[CLI source](https://github.com/libtmux/libtmux-swift/blob/53c67947879f4976ddf2c43f3c8df7c7671c5b19/Sources/TmuxWorkspaceCLI/README.md).
<!-- /port -->
<!-- /port -->
