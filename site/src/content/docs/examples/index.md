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

<!-- port:py -->
<!-- port:root -->
### Python
<!-- /port -->
The test configuration includes `README.md` and `src/libtmux/` in its
doctest collection. The `>>>` examples run against isolated tmux sessions.
<!-- /port -->

<!-- port:ts -->
<!-- port:root -->
### TypeScript
<!-- /port -->
`scripts/check-doc-runnable.ts` checks that a block tagged with its
example source matches that file line for line. The integration suite
executes the source program.
<!-- /port -->

<!-- port:go -->
<!-- port:root -->
### Go
<!-- /port -->
`go generate ./tmux` refreshes documented regions from matching source
regions under `examples/`. CI checks that those generated excerpts are current.
<!-- /port -->

<!-- port:rs -->
<!-- port:root -->
### Rust
<!-- /port -->
The library includes its README as a crate doc comment.
`cargo test --doc` compiles and runs its executable Rust code blocks.
<!-- /port -->

<!-- port:java -->
<!-- port:root -->
### Java
<!-- /port -->
`./gradlew :docs-tests:test` compiles executable Java blocks in READMEs
and guides against the library artifacts, then runs them against tmux through
`libtmux-junit5`.
<!-- /port -->

<!-- port:csharp -->
<!-- port:root -->
### C#
<!-- /port -->
`sync_snippets.py --check` checks excerpts from tested `[Example]`
methods. `ReadmeExampleTests` also compiles and executes blocks marked
`csharp run`.
<!-- /port -->

<!-- port:cxx -->
<!-- port:root -->
### C++
<!-- /port -->
`tools/docs/check_readme.py` checks that README examples match their
source regions in `examples/05-readme.cpp`. CTest builds and runs that program.
<!-- /port -->

<!-- port:swift -->
<!-- port:root -->
### Swift
<!-- /port -->
`Scripts/check_examples.py` checks that README examples match sources
under `Examples/Sources/`. `swift test --package-path Examples` compiles
those examples through the public products.
<!-- /port -->

See [Testing with libtmux](/guides/testing-with-libtmux/) for the fixture
each of those test suites runs against, and each example page for the
exact file a given snippet was quoted from.
