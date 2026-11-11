---
port: haskell
route: core
title: "tmux client library for Haskell"
description: "tmux client library for Haskell. Capture tmux state, query detached snapshots, rename sessions and windows, and set pane titles"
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
  - label: Rename and set titles
    href: ../guides/mutations/
    body: Select explicit targets, apply checked changes and capture fresh observations.
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
Rename sessions and physical windows, or set a pane title through an explicit
reference. Capture again to observe the change; existing snapshots retain their
values. Creation, input, event streams and workspace tooling remain in development.
This port ships no MCP server; the [Python MCP server](/py/latest/mcp/) lets an assistant
control tmux through the Python library. Read the
[implementation status](../guides/status/)
before choosing the package for automation.
