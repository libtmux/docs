---
supportedPorts: [py, ts, rs, go, java, dotnet, cxx, swift]
title: Testing with libtmux
description: Test against a private tmux server and clean up its sessions and socket.
sidebar:
  label: Testing with libtmux
  group: Guides
  order: 7
tableOfContents: true
---

Use a private tmux server to test code that creates sessions, sends input, or
captures output. The fixtures below allocate a separate socket and manage normal
test cleanup. Give each test suite its own socket so it cannot target a
developer's existing sessions.

<!-- port:py -->
Request the fixture to obtain its server. Python's `session` fixture depends on
`server`, so requesting a session also creates an isolated server:

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
<!-- /port -->

<!-- port:go -->
```go
package example_test

import (
    "context"
    "os"
    "testing"
    "time"

    "github.com/libtmux/libtmux-go/tmux/tmuxtest"
)

func TestMain(m *testing.M) {
    os.Exit(tmuxtest.Main(m))
}

func TestProgram(t *testing.T) {
    ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
    defer cancel()
    pane := tmuxtest.RunInPane(ctx, t, "printf 'ready\\n'; cat")
    tmuxtest.WaitForLine(ctx, t, pane, "ready")
}
```

`tmuxtest.NewServer(ctx, t)` captures the environment and working directory,
resolves the tmux executable, and creates a server on its own socket.
Setup failures stop the test with `t.Fatal`. Test cleanup kills the server,
and wait failures include the last captured screen. Call `tmuxtest.Main` once
from `TestMain` before using these helpers. Run the test with `go test`; tmux
3.2a or newer must be available on `PATH`.
<!-- /port -->

<!-- port:rs -->
```rust
let guard = TestServer::new().await?;
let server = guard.server();
// ... drive `server` normally ...
guard.shutdown().await?;
```

Enable the `test-support` feature in a dev-dependency. The crate README uses
these guards in doctests through `#![doc = include_str!("../README.md")]`.
`libtmux::test::retry_until(deadline, condition)` polls an arbitrary async
condition; `Pane::wait_for_text` waits specifically for pane text. See
[Capturing output](../capturing-output/).
<!-- /port -->

<!-- port:java -->
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

`libtmux-junit5` supplies each test with a running `Server` containing a session
named `libtmux`. Request `TmuxSocketPath` when your code takes a socket path.
Fixtures live in JUnit's per-test extension store. A shutdown hook kills servers
owned by that JVM, and startup cleanup removes servers left by JVMs that have
exited. Source: `libtmux-junit5/README.md`.

<a id="java-docs-tests"></a>The port's `docs-tests` module compiles Java fences
from READMEs and guides, then runs them against `libtmux-junit5` servers. A
`<!-- snippet: ... -->` directive can instead require a named exception, a
compile failure, or an explicit skip reason. Source: `docs-tests/README.md`.
<!-- /port -->

<!-- port:dotnet -->
```csharp
using LibTmux.Testing;

TmuxTestFactory factory = new();
await using TemporaryHierarchyScope scope = await factory.CreateHierarchyAsync();

await scope.Pane.SendTextAsync("echo hello");
```

`LibTmux.Testing` ships as a separate package, under
`src/LibTmux.Testing/`. `await using` disposes the scope and kills its server
when the block exits. Use `TmuxWait.UntilAsync` to wait for expected state; see
[Capturing output](../capturing-output/). Source: `README.md`, "Testing your own
code," exercised by `ReadmeExampleTests`.
<!-- /port -->

<!-- port:cxx -->
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

The example comes from `README.md`, "Testing your own tmux tools," and is
checked against the `fixture` region in `examples/05-readme.cpp` by
`tools/docs/check_readme.py`. Enable the `testing` CMake component with
`find_package(libtmux COMPONENTS testing)`. It creates a private socket and
temporary directory, sets `TMUX_TMPDIR`, and removes `TMUX` and `TMUX_PANE` from
the child environment. `SocketNamespace::consumer(...)` labels sockets with the
consumer suite's name. `examples/tests/README.md` shows use from outside the
library's build tree.
<!-- /port -->

<!-- port:swift -->
```swift
import Testing
import TmuxFixture

try await withTmuxServer { server in
    let sessions = try await server.sessions()
    #expect(sessions.map(\.name) == ["bootstrap"])
}
```

`TmuxFixture` is a separate package product. It starts a server with a bootstrap
session and limits concurrent fixtures to reduce process and pseudo-terminal
exhaustion. `LIBTMUX_TMUX_BIN` selects the executable; otherwise it checks
installed locations. Source: `Tests/TmuxFixture/README.md`.
<!-- /port -->

<!-- port:ts -->
TypeScript's harness at `packages/libtmux/src/_internal/test/testkit.ts` is
internal and unpublished. For external tests, create an isolated `Server` and
manage its cleanup in your test framework.
<!-- /port -->

## Where to go next

- [Capturing output](../capturing-output/): the wait helpers most of these
  fixtures are meant to be used alongside, instead of a fixed `sleep` in a
  test.
- [Attach and send keys](/examples/attach-and-send-keys/) and
  [Capture pane output](/examples/capture-pane-output/): the same
  operations these fixtures give you a server to run, shown as tested
  examples in their own right.
