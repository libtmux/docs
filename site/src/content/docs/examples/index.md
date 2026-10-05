---
supportedPorts: [py, ts, rs, go, java, csharp, cxx, swift]
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

| Port | Mechanism | What it checks |
|------|-----------|-----------------|
<!-- port:py -->| Python | `pytest` `testpaths` includes `README.md` and `src/libtmux` | `>>>` doctest blocks run against a real, isolated tmux session on every test run |
<!-- /port --><!-- port:ts -->| TypeScript | `scripts/check-doc-runnable.ts` | A block tagged `<!-- runs: examples/foo.ts -->` must appear, line for line, in that file, which the integration suite executes |
<!-- /port --><!-- port:go -->| Go | `go generate ./tmux` (`internal/generate/docs`) | A `<!-- docs:name -->` region in `README.md` is rewritten from the matching `// docs:name` … `// docs:end` region in `examples/`; CI fails on drift |
<!-- /port --><!-- port:rs -->| Rust | `#![doc = include_str!("../README.md")]` | The entire README is a doc comment, so `cargo test --doc` compiles and runs every fenced Rust block in it |
<!-- /port --><!-- port:java -->| Java | `docs-tests` (`./gradlew :docs-tests:test`) | Every Java fence in READMEs and guides is compiled against the real artifacts, then run against real tmux via `libtmux-junit5` |
<!-- /port --><!-- port:csharp -->| C# | `sync_snippets.py --check` + `ReadmeExampleTests` | A `<!-- snippet: Name -->` region is quoted from a tested `[Example]` method; every `csharp run` block is additionally compiled and executed |
<!-- /port --><!-- port:cxx -->| C++ | `tools/docs/check_readme.py` | Each ` ```cpp ` block in `README.md` must appear verbatim as a `#region` in `examples/05-readme.cpp`, which CTest builds and runs |
<!-- /port --><!-- port:swift -->| Swift | `Scripts/check_examples.py` | Each ` ```swift ` block in `README.md` and product READMEs must appear in `Examples/Sources/`, which `swift test --package-path Examples` compiles through its public products |
<!-- /port -->
See [Testing with libtmux](/guides/testing-with-libtmux/) for the fixture
each of those test suites runs against, and each example page for the
exact file a given snippet was quoted from.
