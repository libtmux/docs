---
port: haskell
route: core
title: "tmux client library for Haskell"
description: "tmux client library for Haskell. Capture tmux state, navigate sessions, windows and panes, and filter detached snapshots"
cards:
  - label: Getting started
    href: ../guides/getting-started/
    body: Install the source package and capture a running tmux server.
  - label: Capture and traverse
    href: ../guides/capture/
    body: Follow physical panes and linked-window context in one snapshot.
  - label: Query snapshots
    href: ../guides/query/
    body: Filter typed fields, follow relationships and check selection cardinality.
  - label: Typed values
    href: ../guides/typed-values/
    body: Understand entity IDs, indices, dimensions and version admission.
  - label: API reference
    href: ../reference/
    body: Public modules, types, constructors and functions from Haddock.
  - label: Implementation status
    href: ../guides/status/
    body: Check public capabilities, compatibility evidence and package boundaries.
---

Capture through a scoped Server handle, then inspect ordinary Haskell records
after it closes. Window links retain each session's index and pane appearances.
Public mutations, event streams and workspace tooling remain under development.
MCP is excluded. Read the
[implementation status](../guides/status/)
before choosing the package for automation.
