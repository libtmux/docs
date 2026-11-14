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
The optional [LibTmux-Async distribution](../reference/libtmux-async-server/)
returns Future values and requires a caller-owned
[IO::Async::Loop::Ppoll](https://metacpan.org/pod/IO::Async::Loop::Ppoll)
loop. Its [transport reference](../reference/libtmux-async-transport/) explains
admission, cancellation, and cleanup. Linux x86_64 LP64 is qualified; other
platforms and ABIs remain unsupported.

The LibTmux, LibTmux-Async, and LibTmux-Workspace distributions are on CPAN.
The [installation guide](../guides/) lists the `cpm` command for each, and a
source checkout remains available for development.
