---
port: perl
route: core
title: tmux client library for Perl
description: "tmux client library for Perl. Control tmux, connect to and create servers, navigate sessions, windows, and panes, send keys, capture pane contents"
cards:
  - label: Installation and guides
    href: ../guides/
    body: Install the native distributions and work with captured tmux state.
  - label: Filtering example
    href: ../guides/filtering/
    body: Run a complete snapshot, criteria, callback, and native-array workflow.
  - label: API reference
    href: ../reference/
    body: Native package signatures and interlinked POD for core and optional async.
---

The core uses stable Perl 5.44 features and standard-library runtime modules.
The optional [LibTmux-Async distribution](../reference/) adds Future and IO::Async through a
caller-owned loop. Linux x86_64 LP64 is qualified; other platforms and ABIs
remain unsupported.

The distributions are available from source and have no CPAN release.
