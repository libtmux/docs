---
port: cxx
route: examples
title: Examples
description: Programs for sending input, capturing output, and building workspaces.
sidebar:
  label: Overview
  group: Examples
  order: 1
cards:
  - label: Attach and send keys
    href: attach-and-send-keys/
    body: Find a session, send a command, and read its output.
  - label: Capture pane output
    href: capture-pane-output/
    body: Read a pane's screen and wait for output to appear.
  - label: Build a workspace from a file
    href: workspace-from-file/
    body: Create a session, windows, and panes from configuration.
---

Use these programs to send input, capture output, and build a workspace.
Each example page includes its source and test coverage. Check those details
before adapting an excerpt into a standalone program.

<a id="what-verified-means-per-port"></a>

## Source and verification

Port repositories use the following checks for their source examples. This site
reads or copies those examples; a successful site build alone does not execute
them:

`tools/docs/check_readme.py` checks that README examples match their
source regions in `examples/05-readme.cpp`. CTest builds and runs that program.

See [Testing with libtmux](/guides/testing-with-libtmux/) for the fixture
each of those test suites runs against, and each example page for the
exact file a given snippet was quoted from.
