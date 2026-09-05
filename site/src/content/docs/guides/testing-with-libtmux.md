---
title: Testing with libtmux
description: Every port ships a way to give your own tests a real, disposable tmux server. What each one hands you, and what it guarantees about cleanup.
sidebar:
  label: Testing with libtmux
  group: Guides
  order: 7
tableOfContents: true
---

None of the eight ports mocks tmux for its own test suite, and seven of the
eight expose the fixture that does that to you, for testing *your* code
against real tmux instead of a fake. The recurring guarantee, worded
differently in every port, is the same one: a server your test owns, on a
socket nothing else can collide with, gone by the time the test ends — even
when the test crashes or the process is killed outright.

Each fixture below is the same shape — ask for it, get a running server on
a socket nothing else can reach, and never write the teardown yourself.
Python's `session` fixture pulls in `server` automatically, so a test that
only asks for a session still gets the isolation:

```python
>>> def test_example(session: "Session") -> None:
...     assert isinstance(session.name, str)
...     assert session.name.startswith('libtmux_')
...     window = session.new_window(window_name='new one')
...     assert window.name == 'new one'
```

That exact block is a doctest in `src/libtmux/pytest_plugin.py`, checked by
running it as a nested pytest run and asserting it passes. `session_params`
overrides how the fixture builds a session (window size, for instance)
without forking it; a temporary `HOME` and tmux config keep window and pane
indices stable across machines, so an assertion like `window_name == "test"`
doesn't depend on whatever `.tmux.conf` the test runner happens to have.

```go
pane := tmuxtest.RunInPane(ctx, t, "printf 'ready\\n'; cat")

tmuxtest.WaitForText(ctx, t, pane, "ready")
tmuxtest.Type(ctx, t, pane, "a line for the program")
tmuxtest.WaitForLine(ctx, t, pane, "a line for the program")
```

`tmuxtest.NewServer(ctx, t)`, underneath the block above, snapshots the
effective environment and working directory, resolves one absolute tmux
executable, and gives back a server on its own socket, killed when the test
ends — construction itself returns an error rather than a zero-value server,
so there's no invalid handle to accidentally use. A wait that runs out fails
with the screen the pane last held rather than sending you back to add a
print statement. Source: `README.md`, "Testing your own code," backed by
`tmux/tmuxtest/`.

```rust
let guard = TestServer::new().await?;
let server = guard.server();
// ... drive `server` normally ...
guard.shutdown().await?;
```

Behind the `test-support` feature (a dev-dependency, not part of the default
build). Every example in the crate README runs against one of these guards —
true by construction, since the whole file is doctested via
`#![doc = include_str!("../README.md")]`. `libtmux::test::retry_until(deadline,
condition)` is the polling-with-a-deadline helper used throughout the README
for "wait until this becomes true," distinct from `Pane::wait_for_text` (see
[Capturing output](../capturing-output/)) in that it checks an arbitrary
async condition rather than pane text specifically.

```java
@ExtendWith(TmuxExtension.class)
class MyToolTest {
    @Test
    void itRunsSomethingInAPane(Server server) {
        Session session = server.sessions().get(0);
        Pane pane = session.windows().get(0).panes().get(0);
        pane.sendLine("echo hello");
        assertTrue(pane.capture().stream().anyMatch(line -> line.contains("hello")));
    }
}
```

`libtmux-junit5`'s `Server` parameter arrives already running, with one
session named `libtmux` in it; ask for a `TmuxSocketPath` instead for code
that takes a path directly. A server per test, never shared — a field would
leak state across parallel tests, so everything lives in JUnit's per-test
extension store. The socket path is named after the *owning JVM's pid*, a
shutdown hook kills that JVM's own servers on termination, and before making
its first server each run sweeps the process table for servers whose owning
JVM is already gone — because a killed test JVM leaves a server behind that
the OS's temp cleaner won't touch and no in-process finalizer will ever run
for. Source: `libtmux-junit5/README.md`.

<a id="java-docs-tests"></a>A different, inward-facing use of
the same fixture is `docs-tests`: it compiles every Java fence in the
READMEs and guides against the real published artifacts, then runs it
against a real tmux server from `libtmux-junit5` — one case per snippet, one
server per case. It's the citation behind every "verified" claim about a
Java block on this site. An `<!-- snippet: ... -->` directive immediately
above a fence says how it's checked: run against live tmux by default, must
throw a named exception, must fail to compile, or explicitly skipped with a
reason. Source: `docs-tests/README.md`.

```csharp
using LibTmux.Testing;

TmuxTestFactory factory = new();
await using TemporaryHierarchyScope scope = await factory.CreateHierarchyAsync();

await scope.Pane.SendTextAsync("echo hello");
```

`LibTmux.Testing` is a namespace (`src/LibTmux/Testing/`), not a package of
its own — the only `.csproj` under `src/` that could compile those files is
`LibTmux.csproj` itself. So it ships inside `LibTmux`, the one package every
consumer already has. Disposing the scope kills the server, so a test that
fails partway through leaves nothing behind — `await using` makes that
automatic rather than something every test has to remember in a `finally`
block. `TmuxWait.UntilAsync` (see [Capturing output](../capturing-output/))
is what keeps assertions against that server from being timing-dependent.
Source: `README.md`, "Testing your own code," one of the nine documents
`ReadmeExampleTests` compiles and runs.

```cpp
// A private tmux for a suite of your own, gone when the scope ends.
auto fixture = libtmux::test::ScopedTmuxServer::start(
    {.socket_namespace = libtmux::test::SocketNamespace::consumer("my-suite")});
if (!fixture.has_value()) {
  std::fprintf(stderr, "%s\n", fixture.error().c_str());
  return 1;
}
const auto under_test =
    libtmux::Server::at_socket_path(fixture->socket_path().string());
std::printf("sessions on it: %zu\n", under_test->sessions()->size());
```

Quoted verbatim from `README.md`'s "Testing your own tmux tools," checked
against `examples/05-readme.cpp`'s `fixture` region by
`tools/docs/check_readme.py`. `libtmux::testing` is a CMake component, not a
header the main library always pulls in — `find_package(libtmux COMPONENTS
testing)` — so a consumer opts in explicitly and the core library still
links nothing extra. That gives a private server on its own socket, under
its own `mkdtemp` tree with `TMUX_TMPDIR` pointed inside it and `TMUX` /
`TMUX_PANE` erased from the child's environment, so a suite run from inside
tmux can't reach the surrounding server. `SocketNamespace::consumer(...)`
labels a run's sockets so a stray leftover directory under `/tmp` names the
suite that made it — worth doing on a machine running more than one
libtmux-cxx-based project's tests at once. `examples/tests/README.md`
documents using this exact component from *outside* the library's own build
tree, which is the harder and more honest way to prove it works for a
consumer.

```swift
import Testing
import TmuxFixture

try await withTmuxServer { server in
    let sessions = try await server.sessions()
    #expect(sessions.map(\.name) == ["bootstrap"])
}
```

`TmuxFixture` is a package product of its own. Each call starts a server
under `/tmp/libtmux-swift-test/` with a bootstrap session already in it, and
limits how many fixtures run concurrently so a big test suite can't exhaust
processes or pseudo-terminals — a rate limiter the fixture owns, not
something a test author has to coordinate by hand. It drives a real tmux
rather than mocking one; `LIBTMUX_TMUX_BIN` picks the executable, falling
back to the usual installed locations. Source: `Tests/TmuxFixture/README.md`.

TypeScript is the one port without a published fixture: the library's own
real-tmux harness (`packages/libtmux/src/_internal/test/testkit.ts`) is
"internal and unpublished — in-repo consumers use it directly; external
ones have no need for it," and there is no `@libtmux/testing` package as of
this page. A project needing one is building its own thin wrapper around a
real `Server`, the same way this guide's other examples do.

## Where to go next

- [Capturing output](../capturing-output/) — the wait helpers most of these
  fixtures are meant to be used alongside, instead of a fixed `sleep` in a
  test.
- [Attach and send keys](/examples/attach-and-send-keys/) and
  [Capture pane output](/examples/capture-pane-output/) — the same
  operations these fixtures give you a server to run, shown as tested
  examples in their own right.
