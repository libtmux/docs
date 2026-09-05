---
title: Build a workspace from a file
description: The tmuxp-shaped job of describing a multi-window session as data and building it in one call, in each port that has a checked way to do it.
sidebar:
  label: Build a workspace from a file
  group: Examples
  order: 4
tableOfContents: true
---

[tmuxp](https://tmuxp.git-pull.com/) popularized describing a tmux session
as YAML — a session name, a list of windows, a list of panes and shell
commands per window — and building it in one call instead of scripting each
piece by hand. Several ports ship their own reader and builder for that
same shape, on top of their object API rather than instead of it. Where a
port has no checked snippet for this, the paragraph below says so instead
of inventing one; see [the table at the end](#where-this-comes-from) for
exactly which file backs each block that does exist.

Not every port folds this into the library itself. Python's own README
draws that line directly: tmuxp is "an app on top of libtmux" for exactly
this job — "declarative tmux workspaces from YAML / TOML" — kept as a
separate project rather than absorbed into the library. Depend on
[tmuxp](https://tmuxp.git-pull.com/) there; it is built on the same
`Server`/`Session`/`Window`/`Pane` objects the rest of this site documents.

```typescript file="examples/workspace/workspace.ts"
```

TypeScript's `applyWorkspace` converges rather than duplicates when run
twice against the same config — it describes a target state, not a
one-shot script.

```go file="workspace/example_test.go"
```

Go's `Example()`, in `workspace/example_test.go`, is a Go `Example`
function: `go test` runs it and checks its output against the
`// Output:` comment at the end, so this is executed on every test run
rather than merely present in a README. `Parse` rejects a field it doesn't
recognize rather than dropping it silently, and reports every problem it
finds at once with the line it's on. `Build` is not atomic: tmux has no
transaction, so a failure partway through leaves whatever was already
created in place, identified by the session `Build` still returns.

```rust
use libtmux::test::TestServer;
use tmux_workspace::{Workspace, WorkspaceBuilder};

let source = "
session_name: dev
windows:
  - window_name: editor
    panes: [/bin/sh, /bin/sh]
";
let workspace = Workspace::from_yaml(source)?;

let guard = TestServer::new().await?;
let session = WorkspaceBuilder::new(guard.server()).build(&workspace).await?;

assert_eq!(session.name().to_string_lossy(), "dev");
assert_eq!(session.windows().await?.len(), 1);
```

The `tmux-workspace` crate can also go the other direction —
`freeze(&session).await?` turns a session someone built by hand back into
the same YAML shape, recovering the topology (windows, panes, working
directories) but not history: "tmux remembers what a pane is running, not
the command someone typed to start it."

```java
Workspace workspace = WorkspaceBuilder.parse("""
        session_name: built
        windows:
          - window_name: editor
            layout: even-horizontal
            panes:
              - shell_command: echo one
              - shell_command: echo two
          - window_name: server
            panes:
              - echo three
        """);

Session session = WorkspaceBuilder.build(server, workspace);

session.name();                                   // → built
session.windows().size();                         // → 2
session.windows().get(0).panes().size();          // → 2
```

Java's `read` and `parse` produce a `Workspace` value; `build` is the only
call that touches tmux — a description tmux couldn't build is rejected
while it's still text, before a single window exists.

```csharp
WorkspaceFile workspace = WorkspaceFile.Parse("""
    session_name: api
    start_directory: /tmp
    windows:
      - window_name: editor
        panes:
          - shell_command: echo editing
      - window_name: server
        panes:
          - shell_command: echo serving
    """);

WorkspaceResult result = await new WorkspaceBuilder(server).BuildAsync(workspace, ct);
Console.WriteLine($"{result.Session.Name}: {result.Windows.Count} windows");
```

The .NET builder waits for a pane to look ready before sending workspace
commands to it, rather than assuming a freshly spawned shell can already
take input — see
[Sending keys](/guides/sending-keys/#the-race-you-cant-see-from-the-call-site)
for why that race is real. It polls `pane_current_command`, `cursor_x`, and
`cursor_y` for up to ten seconds by default. Its default policy,
`PaneReadiness.Auto`, waits only when the session's default shell is zsh;
`PaneReadiness.Always` waits before every pane running the session's
default shell; `PaneReadiness.Never` sends commands immediately.
`BuildAsync` isn't transactional either: its thrown
`WorkspaceBuildException` carries a `PartialResult` with whatever was
materialized before the failure.

No checked, public-API snippet exists for this task in C++.
`examples/workspace/` exists, but its own README frames it plainly as "not
really an example. This is a **consumer**" — a project built to put weight
on the public surface from outside and report where it's awkward, reading
tmuxp's own YAML documents through types (`workspace.hpp`, `tmuxp.hpp`)
that live only in that example directory, not in the library the way
`libtmux::testing` does. Running its corpus probe against tmuxp's real
example files found two real gaps this way — `environment:` and
`window_index:` were unsupported — both since fixed, and worth reading
[the example's own README](https://github.com/libtmux/libtmux-cxx/tree/main/examples/workspace)
if you're building this yourself against the core library's typed API.

```swift file="Examples/Sources/ExampleCode/Workspaces.swift"
```

Swift's `WorkspaceBuilder.build` refuses rather than adopting a session
that already has the name — two callers building the same workspace
shouldn't silently share one. `Workspace.decode(yaml:)`, behind the
`YAMLWorkspaces` trait, reads the tmuxp-format YAML directly;
`Workspace.decode(json:)` needs no trait, because tmuxp's keys decode
straight into these types.

## Where this comes from

| Port | Source | In this page | Checked by |
|---|---|---|---|
| Python | — | no fence; the README says tmuxp is a separate project by design | n/a |
| TypeScript | `examples/workspace/workspace.ts` (`@libtmux/workspace`) | read whole from the file | run against real tmux by `bun test examples/workspace` |
| Go | `workspace/example_test.go` (`workspace.Parse` / `workspace.Build`) | read whole from the file | `Example()` and its siblings run under `go test` and are checked against their own `// Output:` comments |
| Rust | `crates/tmux-workspace/README.md`, "Build it" | hand-quoted | the crate's own `crates/tmux-workspace/src/lib.rs` includes the README as a doc comment (`#![doc = include_str!("../README.md")]`), so `cargo test --doc` runs this exact block |
| Java | `libtmux-workspace/README.md`, "What you get back" | hand-quoted | every Java fence in the module's README is compiled and run against real tmux by `docs-tests` |
| .NET | `src/LibTmux.Workspace/README.md` | hand-quoted | one of the READMEs and docs `ReadmeExampleTests` compiles and runs against real tmux |
| C++ | `examples/workspace/` (a consumer, not a library API) | prose only | `examples/workspace/tests/` runs it against real tmux as `consumer.workspace`; it exercises the example's own types, not a published `libtmux` API |
| Swift | `Examples/Sources/ExampleCode/Workspaces.swift` | read whole from the file | matched against the README's "Workspaces, from a file or from Swift" section by `Scripts/check_examples.py`; compiled and run by `swift test --package-path Examples` |

Rust, Java, and .NET quote a fenced block straight out of a README rather
than a standalone example file — none of the three has one for this task —
so those three rows are hand-quoted rather than read live: a build-time
`file=` read of a whole README would pull in its surrounding prose along
with the code.
