---
port: raku
route: core
title: tmux client library for Raku
description: "tmux client library for Raku. Control tmux, connect to and create servers, navigate sessions, windows, and panes, send keys, capture pane contents"
cards:
  - label: Getting started
    href: ../guides/getting-started/
    body: Install LibTmux, create and split panes, and find them through typed snapshots.
  - label: Examples
    href: ../examples/programs/
    body: Run six complete programs against private tmux servers and compare their output.
  - label: tmux compatibility
    href: ../topics/compatibility/
    body: Check the supported tmux releases and how the library handles newer ones.
  - label: API reference
    href: ../reference/
    body: Native signatures, RakuDoc and links for every public module, class and method.
---

LibTmux gives Raku programs typed snapshots of a tmux server, ordinary
predicates over them, and explicit commands that change tmux. Reading a
snapshot makes no further tmux calls; an operation through a reference does.

The distribution `LibTmux:auth<zef:libtmux>` is published on Raku Land. Its API
is experimental and may change between `0.x` releases. CI qualifies Rakudo
2026.09 on Linux with tmux 3.3a and 3.8; other platforms and compiler versions
are unverified. The library has no workspace manager or MCP server.
