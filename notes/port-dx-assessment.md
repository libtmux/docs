# Port DX assessment

Where each port stands against the bar the agent prompts assume, measured on
2026-09-12 by running each port's setup prompt end to end against tmux 3.7d and
then reading for the nine items below. Every claim here was checked against the
port's source or a real toolchain; nothing is inferred from another port.

The prompts are why this exists. A prompt tells an agent to install a package,
read a README, and use an API without guessing, so anything wrong in those three
places becomes an agent failure rather than a reader's mild confusion.

## What was measured

tmux correctness, idiomatic language, runnable examples, docs, scannability,
MCP discoverability, async and control mode and streaming, non-blocking
correctness, benchmarks.

## Per port

| Port | Examples | Benchmarks | MCP in README | Public test fixture |
| ---- | -------- | ---------- | ------------- | ------------------- |
| Python | none user-facing | none | separate repository | pytest plugin |
| TypeScript | 18 | `scripts/bench-modes.ts` | own heading | none, deliberately |
| Rust | 8 | 2, with `just` recipes | mentioned | `libtmux::test::TestServer` |
| Go | 23 | yes | mentioned | `tmuxtest.NewServer` |
| Java | 6 | 2 | mentioned | `io.github.libtmux.junit5` |
| .NET | 11 | 3 | mentioned | `TemporaryServerScope` |
| C++ | 14 | `08-modes`, added here | own heading | `ScopedTmuxServer` |
| Swift | 23 | yes | own heading | `withTmuxServer` |

Every port implements control mode. Python's is the only one that is not public
API: `ControlMode` sits in `libtmux._internal`, absent from `__init__.py` and
from `__all__`. Python also has no `async def` anywhere in `src/`, so the two
prompt topics that ask for streaming or non-polling behaviour carry a note
saying so and pointing at `retry_until` from `libtmux.test.retry`.

## One root cause, three ports

Go, .NET and Java each published an opening example that could not run as
printed, for the same underlying reason and through three different tools: the
example is executed by a harness that supplies part of the setup, and the
published region shows only what runs inside it.

- Go's extraction region began after `tmux.NewServer` and `NewSession`, and the
  README's only server construction anywhere was the test helper.
- .NET's `ExampleCase.RunAsync` calls `ExampleNamespace.EnterAsync` first, which
  starts a server; the snippet opens with `Server.ConnectAsync()`, which needs
  one already running and reports `server generation discovery failed` without.
- Java's `SnippetCompiler` declares `public static Path socket;` as a harness
  field, so the snippet closes over a binding a reader never sees.

All three suites were green throughout. A passing example suite is evidence the
code compiles and runs; it is not evidence the published text is self-contained,
and none of the three pipelines checks the isolated form. Better snippet
tooling makes this more likely rather than less, because the machinery that
removes drift is the same machinery that supplies the invisible binding.

Worth adding to each port's docs gate: compile the published region alone,
without harness bindings in scope.

## Open, and not ours to close

- **Python has no user-facing examples and no benchmarks.** It is the reference
  port and the only one with a stable release, so this is the largest single
  gap. Its origin is `tmux-python`, a different organisation from the other
  seven, so changes there need the maintainer.
- **TypeScript exports no test fixture.** `TestServer` exists under
  `_internal/test/`, and the exclusion is deliberate in three places: the
  `files` array negates both `dist/_internal/test` and `src/_internal/test`, and
  `testkit.ts` states the directory is excluded from the published package.
  Vending it means either shipping the whole internal harness or relocating the
  type, which is an API decision rather than a defect.
- **.NET's opening example needs a running server.** The README now says so and
  shows `CreateOwnedAsync`, but which example should open the page is a design
  call left to the maintainer.
