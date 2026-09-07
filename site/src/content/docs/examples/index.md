---
title: Examples
description: Programs for sending input, capturing output, and building workspaces in each language.
sidebar:
  label: Overview
  group: Examples
  order: 1
---

These examples show how to complete a tmux task in each language. Use the tabs
to select your port. Each page includes the source file and the checks run by
that port's test suite; see those details before adapting an excerpt into a
standalone program.

Examples marked with `file=` are read from the port source during the build.
Other blocks are copied excerpts. The source details identify which mechanism
each block uses.

- **[Attach and send keys](attach-and-send-keys/)**: get a session, send a
  command, and read output. Uses the hierarchy described in [Server, session,
  window, pane](/concepts/server-session-window-pane/).
- **[Capture pane output](capture-pane-output/)**: read back what a
  pane is showing, and wait for output to appear instead of guessing a
  delay. The companion to [Capturing output](/guides/capturing-output/).
- **[Build a workspace from a file](workspace-from-file/)**: the
  tmuxp-shaped job of describing a multi-window session as data and
  building it in one call, in each port that has one.

## What "verified" means, per port

Port repositories use the following checks for their source examples. This site
reads or copies those examples; a successful site build alone does not execute
them:

| Port | Mechanism | What it checks |
|------|-----------|-----------------|
| Python | `pytest` `testpaths` includes `README.md` and `src/libtmux` | `>>>` doctest blocks run against a real, isolated tmux session on every test run |
| TypeScript | `scripts/check-doc-runnable.ts` | A block tagged `<!-- runs: examples/foo.ts -->` must appear, line for line, in that file, which the integration suite executes |
| Go | `go generate ./tmux` (`internal/generate/docs`) | A `<!-- docs:name -->` region in `README.md` is rewritten from the matching `// docs:name` … `// docs:end` region in `examples/`; CI fails on drift |
| Rust | `#![doc = include_str!("../README.md")]` | The entire README is a doc comment, so `cargo test --doc` compiles and runs every fenced Rust block in it |
| Java | `docs-tests` (`./gradlew :docs-tests:test`) | Every Java fence in READMEs and guides is compiled against the real artifacts, then run against real tmux via `libtmux-junit5` |
| .NET | `sync_snippets.py --check` + `ReadmeExampleTests` | A `<!-- snippet: Name -->` region is quoted from a tested `[Example]` method; every `csharp run` block is additionally compiled and executed |
| C++ | `tools/docs/check_readme.py` | Each ` ```cpp ` block in `README.md` must appear verbatim as a `#region` in `examples/05-readme.cpp`, which CTest builds and runs |
| Swift | `Scripts/check_examples.py` | Each ` ```swift ` block in `README.md` and product READMEs must appear in `Examples/Sources/`, which `swift test --package-path Examples` compiles through its public products |

See [Testing with libtmux](/guides/testing-with-libtmux/) for the fixture
each of those test suites runs against, and each example page below for the
exact file a given snippet was quoted from.
