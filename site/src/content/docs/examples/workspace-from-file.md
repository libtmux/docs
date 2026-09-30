---
supportedPorts: [py, ts, rs, go, java, dotnet, cxx, swift]
title: Build a workspace from a file
description: Describe a session in configuration, validate it, and build its windows and panes.
sidebar:
  label: Build a workspace from a file
  group: Examples
  order: 4
tableOfContents: true
---

[tmuxp](https://tmuxp.git-pull.com/) describes sessions, windows, panes, and
shell commands in configuration files. A workspace builder turns that
configuration into tmux objects. [Source details](#where-this-comes-from) identify the example
files and their checks.

<!-- port:py -->
For Python, use [tmuxp](https://tmuxp.git-pull.com/), a separate application
built on libtmux's `Server`, `Session`, `Window`, and `Pane` APIs.
<!-- /port -->

```typescript file="examples/workspace/workspace.ts"
```

<!-- port:ts -->
TypeScript's `applyWorkspace` reuses existing objects when the same
configuration is applied again.
<!-- /port -->

```go file="workspace/example_test.go"
```

<!-- port:go -->
Go's `Example()`, in `workspace/example_test.go`, is a Go `Example`
function: `go test` runs it and checks its output against the
`// Output:` comment at the end, so this is executed on every test run
rather than merely present in a README. `Parse` rejects a field it doesn't
recognize rather than dropping it silently, and reports every problem it
finds at once with the line it's on. `Build` is not atomic: tmux has no
transaction, so a failure partway through leaves whatever was already
created in place, identified by the session `Build` still returns.
<!-- /port -->

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

<!-- port:rs -->
Rust's `freeze(&session).await?` exports an existing session to the workspace
format. It recovers windows, panes, and working directories, but cannot recover
the shell command originally typed to start a process.
<!-- /port -->

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

<!-- port:java -->
Java's `read` and `parse` validate the configuration and return a `Workspace`
value. Only `build` changes tmux state.
<!-- /port -->

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

<!-- port:dotnet -->
The .NET builder can wait for shell readiness before sending commands; [Sending
keys](/guides/sending-keys/#the-race-you-cant-see-from-the-call-site) explains
the startup race. It polls `pane_current_command`, `cursor_x`, and `cursor_y`
for up to ten seconds by default. `PaneReadiness.Auto` waits for zsh, `Always`
waits for every pane running the session's default shell, and `Never` sends
immediately. If `BuildAsync` fails partway through,
`WorkspaceBuildException.PartialResult` identifies what was created.
<!-- /port -->

<!-- port:cxx -->
C++'s `examples/workspace/` implements a consumer of the core API with its own
`workspace.hpp` and `tmuxp.hpp` types. Those types are part of the example, not
the library package. See [the example's
README](https://github.com/libtmux/libtmux-cxx/tree/main/examples/workspace) to
adapt it.
<!-- /port -->

```swift file="Examples/Sources/ExampleCode/Workspaces.swift"
```

<!-- port:swift -->
Swift's `WorkspaceBuilder.build` rejects an existing session with the requested
name. `Workspace.decode(yaml:)` reads tmuxp YAML when the `YAMLWorkspaces` trait
is enabled. `Workspace.decode(json:)` needs no additional trait.
<!-- /port -->

## Where this comes from

<!-- port:py -->
<!-- port:root -->
### Python
<!-- /port -->

**Source:** Not listed.

**In this page:** no fence; the README says tmuxp is a separate project by
design

**Checked by:** n/a
<!-- /port -->

<!-- port:ts -->
<!-- port:root -->
### TypeScript
<!-- /port -->

**Source:** `examples/workspace/workspace.ts` (`@libtmux/workspace`)

**In this page:** read whole from the file

**Checked by:** run against real tmux by `bun test examples/workspace`
<!-- /port -->

<!-- port:go -->
<!-- port:root -->
### Go
<!-- /port -->

**Source:** `workspace/example_test.go` (`workspace.Parse` / `workspace.Build`)

**In this page:** read whole from the file

**Checked by:** `Example()` and its siblings run under `go test` and are checked
against their own `// Output:` comments
<!-- /port -->

<!-- port:rs -->
<!-- port:root -->
### Rust
<!-- /port -->

**Source:** `crates/tmux-workspace/README.md`, "Build it"

**In this page:** hand-quoted

**Checked by:** the crate's own `crates/tmux-workspace/src/lib.rs` includes the
README as a doc comment (`#![doc = include_str!("../README.md")]`), so `cargo
test --doc` runs this exact block
<!-- /port -->

<!-- port:java -->
<!-- port:root -->
### Java
<!-- /port -->

**Source:** `libtmux-workspace/README.md`, "What you get back"

**In this page:** hand-quoted

**Checked by:** every Java fence in the module's README is compiled and run
against real tmux by `docs-tests`
<!-- /port -->

<!-- port:dotnet -->
<!-- port:root -->
### .NET
<!-- /port -->

**Source:** `src/LibTmux.Workspace/README.md`

**In this page:** hand-quoted

**Checked by:** one of the READMEs and docs `ReadmeExampleTests` compiles and
runs against real tmux
<!-- /port -->

<!-- port:cxx -->
<!-- port:root -->
### C++
<!-- /port -->

**Source:** `examples/workspace/` (a consumer, not a library API)

**In this page:** prose only

**Checked by:** `examples/workspace/tests/` runs the consumer suite against
real tmux; `ctest -R consumer.workspace` selects it. It exercises the
example's own types, not a published `libtmux` API
<!-- /port -->

<!-- port:swift -->
<!-- port:root -->
### Swift
<!-- /port -->

**Source:** `Examples/Sources/ExampleCode/Workspaces.swift`

**In this page:** read whole from the file

**Checked by:** matched against the README's "Workspaces, from a file or from
Swift" section by `Scripts/check_examples.py`; compiled and run by `swift test
--package-path Examples`
<!-- /port -->

### Source inclusion

Some blocks are excerpts from tested README examples. The source
details above identify those files and their checks.
