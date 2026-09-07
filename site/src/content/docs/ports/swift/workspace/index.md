---
title: "Workspace Manager for Swift"
description: "Build tmux sessions from Swift values, JSON, or optional YAML with TmuxWorkspace."
port: swift
product: workspace
sidebar:
  label: Overview
  order: 0
tableOfContents: true
---

`TmuxWorkspace` builds a tmux session from Swift values or a tmuxp-style
configuration. It is a SwiftPM library product beside the core `LibTmux`
product.

Swift and JSON descriptions work without a YAML dependency. Enable the
`YAMLWorkspaces` package trait to add YAML decoding. Building uses the same
async core server API under either format.

## Start here

- [Guides](./guides/) select the product and build an isolated session.
- [Topics](./topics/) explain format limits, values, and cleanup.
- [Examples](./examples/) include the port's compiled workspace source.
- [API](./api/) covers configuration and builder errors.

## Existing sessions and versions

The builder refuses an existing session with the requested name. On a later
failure, it attempts to remove the exact session it created and reports both
errors if cleanup also fails.

These pages describe the current source API. The port distinguishes its
unreleased source examples from the released alpha package. Use a matching
source revision for these examples, or consult the release's own README when
pinning a published version.

[Product and version guidance](https://github.com/libtmux/libtmux-swift/blob/46b003c3606e03f1e4ce1ecfc92d87748e4c2095/README.md)
