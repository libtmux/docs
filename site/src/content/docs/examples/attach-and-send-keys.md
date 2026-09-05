---
title: Attach and send keys
description: The same task in every port with a checked snippet — get a session, send a command into its active pane, and read back what happened.
sidebar:
  label: Attach and send keys
  group: Examples
  order: 2
tableOfContents: true
---

The task: get a handle on a tmux session, find its active pane, type a
command into it, and read back what printed. This is the round trip nearly
every real program built on libtmux starts from — an agent that runs a
command and checks the result, a test harness driving a CLI, a dashboard
polling a long-running process. "Attach" here means obtaining a live handle
from your program, not a terminal takeover — see
[Attaching to tmux](/guides/attaching-to-tmux/) for that distinction and
for the real, terminal-taking-over kind Python also exposes.

Every block below is either read straight out of a file in that port's own
repository at build time, or quoted by hand from a doctest or README where
no standalone file exists — the table at the end of this page says which,
names the exact source, and says how that port's own test suite checks it.
None of it was rewritten to look alike: a whole tested file naturally
carries more or fewer than exactly the three steps above — error handling,
a second helper, a comment explaining a choice specific to that port, or
no read-back at all — and that surrounding code is left in rather than
trimmed to match. A difference in shape below is real fidelity to what
each port actually ships, not inconsistency.

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

Every snippet above creates a fresh session. A script that runs more than
once usually wants the opposite — attach if a session by that name already
exists, create it otherwise. See
[Attaching to tmux](/guides/attaching-to-tmux/#finding-a-session-instead-of-always-creating-one)
for the verified call in each port, and
[Filtering and querying, in practice](/guides/querying-and-filtering/)
for what to do when the lookup might match more than one.

## Where this comes from

| Port | Source | In this page | Checked by |
|---|---|---|---|
| Python | `src/libtmux/server.py`, `session.py`, `pane.py` docstrings | hand-quoted, composed from three separate docstrings | `pytest` runs every `>>>` doctest (`testpaths` includes `src/libtmux`) against a real, isolated tmux session on every test run |
| TypeScript | `examples/quickstart/quickstart.ts` | read whole from the file | run against real tmux by `bun test examples`; its first half is also mirrored into README.md under a `<!-- runs: ... -->` marker, checked line-for-line by `scripts/check-doc-runnable.ts` |
| Rust | `crates/libtmux/examples/scratch.rs` | read whole from the file | run to completion against a throwaway tmux by `scripts/run-examples.sh` (`just examples`), which CI runs and which also asserts the example leaves no session behind |
| Go | `examples/quickstart/main.go` | read whole from the file | the whole file runs against a real tmux server as `TestQuickstart`; the `docs:quickstart` region inside it is additionally mirrored into README.md by `go generate ./tmux`, and CI fails if the two drift |
| Java | `examples/src/main/java/io/github/libtmux/examples/BuildAWorkspace.java` | read whole from the file | run against real tmux by the `examples` module's own `ExamplesRunTest` |
| .NET | `examples/LibTmux.Examples/Snippets/OneShot.cs` | read whole from the file | its `ConnectAndBuild` region is mirrored into README.md and checked by `sync_snippets.py --check`; the mirrored `csharp run` block is additionally compiled and run by `ReadmeExampleTests` |
| C++ | `examples/05-readme.cpp`, the `connect` and `build` regions | hand-quoted — the file also carries the regions for five other sections of the README | quoted verbatim into README.md, checked for drift by `tools/docs/check_readme.py`, and the whole file is built and run by CTest |
| Swift | `Examples/Sources/ExampleCode/Changing.swift` | read whole from the file | matched against the README's "Change what is there" section by `Scripts/check_examples.py`; compiled and run through the package's public products by `swift test --package-path Examples` |

"Read whole from the file" means the fence names the file with `file="..."`
and the page is built by reading it, so the block above cannot say anything
the file itself does not — there is no separate copy to fall out of sync.
Nothing in any port's repository uses the marker comments (`region: name` /
`endregion`) this site's own tooling looks for to slice a *piece* out of a
longer file, so where only part of a file is relevant here, that part is
quoted by hand instead, with the file and region named in the table above
rather than pretended into a `file=` fence that would fail to build.
