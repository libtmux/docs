---
title: "Swift workspace internals"
description: "Architecture and development interfaces of the Swift workspace builder."
port: swift
product: workspace
sidebar:
  label: Overview
  group: Internals
  order: 0
tableOfContents: true
---

These pages document the in-development workspace builder for contributors
and applications that call its APIs. For workspace loading from a terminal,
see [tmuxp](https://tmuxp.git-pull.com/).

## Builder pipeline

`Workspace` holds typed configuration or decodes JSON and optional YAML.
`WorkspaceBuilder.build` applies that description through an async core
`Server`. The caller supplies file reading, server startup, command-line
handling, and attachment.

## Read the implementation

- [Guides](./guides/) show builder setup and application code.
- [Topics](./topics/) explain configuration, behavior, and failures.
- [Examples](./examples/) exercise the builder through the language API.
- [API](./api/) links the configuration and construction interfaces.

## Implementation scope

`TmuxWorkspace` builds a tmux session from Swift values or a
[tmuxp](https://tmuxp.git-pull.com)-style configuration. It is a SwiftPM
library product beside the core [`LibTmux`](/reference/swift/) product.

Swift and JSON descriptions work without a YAML dependency. Enable the
`YAMLWorkspaces` package trait to add YAML decoding. Building uses the same
async core server API under either format.

## Existing sessions and versions

The builder refuses an existing session with the requested name. On a later
failure, it attempts to remove the exact session it created and reports both
errors if cleanup also fails.

These pages describe the current source API. The port distinguishes its
unreleased source examples from the released alpha package. Use a matching
source revision for these examples, or consult the release's own README when
pinning a published version.

[Product and version guidance](https://github.com/libtmux/libtmux-swift/blob/f02a4668570e1cc5198c941413750e021f42c214/README.md)
