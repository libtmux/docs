---
title: Examples
description: The same real task, worked through in each of libtmux's eight ports, sourced from each port's own README and test-executed example programs.
sidebar:
  label: Overview
  group: Examples
  order: 1
---

Examples show one concrete task done in every port side by side, so you can
compare syntax directly instead of translating between a Python guide and
your own language in your head. Every snippet on these pages is drawn from
a specific file in the port's own repository — its README, or a program its
own test suite compiles and runs against a real tmux server — and each page
ends with a table naming that source per port, whether it was read straight
from the file at build time or quoted by hand, and how the port's own test
suite checks it. Where a port has no checked snippet for the task, the page
says so instead of composing one from the API surface.

A block quoted straight from a file cannot drift from it: the build reads
the file itself rather than a copy pasted into this page, so an example page
fails to build the day the two disagree. That is only possible for a
snippet that lives in its own file — one embedded inside a README's prose,
or sliced out of a longer file by hand for space, is quoted instead, and the
sourcing table says which is which.

- **[Attach and send keys](attach-and-send-keys/)** — get a handle
  on a tmux session, send a command into its active pane, and read back what
  it printed. The flagship example: every port does this, it's usually the
  first thing a real program needs, and it exercises the object hierarchy
  from [Server, session, window, pane](/concepts/server-session-window-pane/)
  end to end.
- **[Capture pane output](capture-pane-output/)** — read back what a
  pane is showing, and wait for output to appear instead of guessing a
  delay. The companion to [Capturing output](/guides/capturing-output/).
- **[Build a workspace from a file](workspace-from-file/)** — the
  tmuxp-shaped job of describing a multi-window session as data and
  building it in one call, in each port that has one.

## What "verified" means, per port

Every port has its own answer to "how do we know this snippet still works,"
and they're genuinely different mechanisms, not just different names for the
same thing:

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
