---
title: Attach and send keys
description: Get a session handle, send a command to a pane, and capture output.
sidebar:
  label: Attach and send keys
  group: Examples
  order: 2
tableOfContents: true
---

Get a session handle, send a command to a pane, and capture output. These
examples use libtmux from your program; to attach your terminal interactively,
see [Attaching to tmux](/guides/attaching-to-tmux/).

Select your port below. The examples retain their source's setup, error
handling, and cleanup, so the operations shown vary by port. [Where this comes
from](#where-this-comes-from) identifies each source and its test coverage.

```python
>>> import libtmux
>>> server = libtmux.Server()
>>> session = server.new_session(session_name='demo')
Session(...)

>>> window = session.active_window
>>> pane = window.split(shell='sh')
>>> pane.capture_pane()
['$']

>>> pane.send_keys('echo "Hello world"', enter=True)

>>> pane.capture_pane()
['$ echo "Hello world"', 'Hello world', '$']
```

```typescript file="examples/quickstart/quickstart.ts"
```

```rust file="crates/libtmux/examples/scratch.rs"
```

```go file="examples/quickstart/main.go"
```

```java file="examples/src/main/java/io/github/libtmux/examples/BuildAWorkspace.java"
```

```csharp file="examples/LibTmux.Examples/Snippets/OneShot.cs"
```

```cpp
// No tmux failure is thrown. Every call answers with a value that is either
// the result or the reason there isn't one.
const auto sessions = server.sessions();
if (!sessions.has_value()) {
  std::fprintf(stderr, "%s\n", sessions.error().diagnostic.c_str());
  return 1;
}

for (const libtmux::Session& session : *sessions) {
  std::printf("%s has %lld window(s)\n", std::string{session.name()}.c_str(),
              session.window_count());
}

const libtmux::Session& session = sessions->at(0);

// Build an arrangement without composing a single tmux argument.
const auto editor = session.new_window({.name = "editor"});
if (!editor.has_value()) {
  std::fprintf(stderr, "%s\n", editor.error().diagnostic.c_str());
  return 1;
}

const auto logs = editor->split({.horizontal = true, .percentage = 30});
if (!logs.has_value()) {
  std::fprintf(stderr, "%s\n", logs.error().diagnostic.c_str());
  return 1;
}

(void)logs->send_text("journalctl -f");
(void)logs->send_key("Enter");
```

```swift file="Examples/Sources/ExampleCode/Changing.swift"
```

## Finding an existing session instead

For a script that runs repeatedly, look up a session before creating it.
[Attaching to
tmux](/guides/attaching-to-tmux/#finding-a-session-instead-of-always-creating-one)
shows that pattern, and [Filtering and querying, in
practice](/guides/querying-and-filtering/) covers absent and ambiguous matches.

## Where this comes from

### Python

**Source:** `src/libtmux/server.py`, `session.py`, `pane.py` docstrings

**In this page:** hand-quoted, composed from three separate docstrings

**Checked by:** `pytest` runs every `>>>` doctest (`testpaths` includes
`src/libtmux`) against a real, isolated tmux session on every test run

### TypeScript

**Source:** `examples/quickstart/quickstart.ts`

**In this page:** read whole from the file

**Checked by:** run against real tmux by `bun test examples`; its first half is
also mirrored into README.md under a `<!-- runs: ... -->` marker, checked
line-for-line by `scripts/check-doc-runnable.ts`

### Rust

**Source:** `crates/libtmux/examples/scratch.rs`

**In this page:** read whole from the file

**Checked by:** run to completion against a throwaway tmux by
`scripts/run-examples.sh` (`just examples`), which CI runs and which also
asserts the example leaves no session behind

### Go

**Source:** `examples/quickstart/main.go`

**In this page:** read whole from the file

**Checked by:** the whole file runs against a real tmux server as
`TestQuickstart`; the `docs:quickstart` region inside it is additionally
mirrored into README.md by `go generate ./tmux`, and CI fails if the two drift

### Java

**Source:**
`examples/src/main/java/io/github/libtmux/examples/BuildAWorkspace.java`

**In this page:** read whole from the file

**Checked by:** run against real tmux by the `examples` module's own
`ExamplesRunTest`

### .NET

**Source:** `examples/LibTmux.Examples/Snippets/OneShot.cs`

**In this page:** read whole from the file

**Checked by:** its `ConnectAndBuild` region is mirrored into README.md and
checked by `sync_snippets.py --check`; the mirrored `csharp run` block is
additionally compiled and run by `ReadmeExampleTests`

### C++

**Source:** `examples/05-readme.cpp`, the `connect` and `build` regions

**In this page:** Copied excerpts from the `connect` and `build` regions.

**Checked by:** quoted verbatim into README.md, checked for drift by
`tools/docs/check_readme.py`, and the whole file is built and run by CTest

### Swift

**Source:** `Examples/Sources/ExampleCode/Changing.swift`

**In this page:** read whole from the file

**Checked by:** matched against the README's "Change what is there" section by
`Scripts/check_examples.py`; compiled and run through the package's public
products by `swift test --package-path Examples`

### Source inclusion

A `file="..."` fence reads the named source during the site build. Hand-quoted
excerpts are copies; their source files and regions are listed above.
