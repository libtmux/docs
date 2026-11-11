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
  - label: API reference
    href: ../reference/
    body: Public modules, types, constructors and functions from Haddock.
  - label: Implementation status
    href: ../guides/status/
    body: Check public capabilities, compatibility evidence and package boundaries.
---

Open a `Server`, capture it, and work with sessions, windows and panes as
ordinary Haskell records. Rename sessions and windows or set pane titles, then
capture again to see the change. Creating sessions and sending input are in
development.
