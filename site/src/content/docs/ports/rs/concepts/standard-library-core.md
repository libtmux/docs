---
port: rs
route: concepts/standard-library-core
title: Try blocking and Tokio clients
description: >-
  Compare full Rust clients with matching object operations, control mode,
  and complete runnable examples.
sidebar:
  label: 'Blocking and Tokio clients'
  group: Concepts
  order: 4
tableOfContents: true
noindex: true
---

The `standard-library-core` branch makes `libtmux` a blocking tmux client with
no default crate dependencies. `libtmux-tokio` provides native async calls.
Both packages own concrete `Server`, `Session`, `Window`, `Pane`, and `Client`
handles, and both include control mode.

These are refactors of the full Cargo workspace. The examples below use the
client packages that the MCP server and workspace builder also depend on.
They require Linux or WSL, tmux 3.2a or newer, and Rust 1.97.1. These revisions
are under review in [the blocking client PR][blocking-pr] and
[the shared async client PR][shared-pr]. They are not registry releases.

## Choose an implementation

| Design | `libtmux` | `libtmux-tokio` | Dependency-free part |
| --- | --- | --- | --- |
| [Blocking client][blocking-branch] | Blocking operations and control-mode iterators | Native Tokio operations and streams | Default blocking client, including optional control mode and plans |
| [Shared async client][shared-branch] | Async operations using async-io; `.wait()` for synchronous callers | Tokio driver over the shared operations | Separate `libtmux-core` values and protocol |

The blocking design lets a synchronous application control tmux without a Rust
runtime dependency. The shared async design keeps one operation implementation
and changes the process, task, and timer driver. Its full client has dependencies;
only its value and protocol package is dependency-free.

## Run the blocking and async examples

Clone the blocking-client branch:

```console
$ git clone --branch standard-library-core https://github.com/libtmux/libtmux-rs.git
```

Enter the workspace:

```console
$ cd libtmux-rs
```

Select the revision used by this preview:

```console
$ git checkout c26bcbb5127352d80dd2a8e9527494f21baa5fd6
```

Run a complete blocking capture program:

```console
$ cargo run --locked -p libtmux --example api_capture
```

Run its native Tokio counterpart:

```console
$ cargo run --locked -p libtmux-tokio --example api_capture
```

Both programs create an isolated daemon, send a shell command, wait for its
output, capture two lines, and clean up. Their result includes
`capture: first line, second line`. Their sockets stay under
`/tmp/libtmux-rs-dev/`.

Read or copy the complete [blocking program][blocking-capture] and
[Tokio program][tokio-capture]. Each [blocking][blocking-examples] and
[async][tokio-examples] collection also includes construction, listings,
creation, queries, cardinality, and input. The collections provide consumer
manifests for running each file in a separate application.

Check the library's runtime dependencies independently of its example tooling:

```console
$ cargo tree --locked -p libtmux -e normal,build
```

The default graph contains only `libtmux`. The examples use development tools
for temporary directories; enabling query, derive, serialization, tracing, or
test support also adds the dependencies for those features.

## Try control mode

Run the blocking watcher:

```console
$ cargo run --locked -p libtmux --example watch --features control-mode,test-support
```

Run the same workload with Tokio:

```console
$ cargo run --locked -p libtmux-tokio --example watch --features control-mode,test-support
```

Each watcher owns its fixture. Both clients provide direct control commands,
routed object operations, pane output, notifications, snapshot updates, bounded
reply buffers, and cancellation. Blocking readers use iterator and timeout
methods; Tokio readers use streams and futures.

The `matrix` example compares sequential plans, folded plans, direct control
commands, and routed object calls. Run the blocking matrix:

```console
$ cargo run --locked -p libtmux --example matrix --all-features
```

Run the same matrix with Tokio:

```console
$ cargo run --locked -p libtmux-tokio --example matrix --all-features
```

Folding merges command evidence; it cannot always identify which operation
failed. Sequential execution and control replies preserve attribution.

## Compare the shared async design

Select the shared-client revision in a separate checkout, or after saving any
local changes:

```console
$ git checkout a45e1f82996bc96f88ebb8239ea017ea3a303e32
```

Run the same two capture commands from above. The default client's program uses
`.wait()` to run its futures without Tokio. The other program uses the native
Tokio adapter. The object operations share an implementation; the adapter owns
native process and runtime integration.

## Process and resource costs

The blocking client uses Linux procfs and an absolute group-signal helper,
`/usr/bin/kill` by default, to supervise processes without crate dependencies.
A missing helper prevents a command from starting. A failed helper is reported
and can leave descendants running. Applications must leave reaping of the
library's child processes to the library.

A timed-out channel wait can retain its tmux client so a later signal is not
lost. The blocking design uses three sleeping threads per parked client.
Both designs use `DispatchLimits::max_wait_clients` to bound these clients
separately from the ordinary command budget; the default is 64. Tokio uses tasks
for the same work.
For many concurrent waits, compare the thread and memory costs in your workload.

The blocking design's two packages expose cancellation tokens and explicit
shutdown. Scoped operations preserve cleanup when cancellation happens during
setup or the callback.
Shutdown joins owned client work; it does not delete existing tmux sessions.
See the [package contract][package-contract] for failure and ownership details.

## How other libraries split runtimes

[Quinn's protocol crate][quinn] separates deterministic protocol state from
network I/O. [Tokio Tungstenite][tungstenite] adapts a synchronous protocol
implementation to Tokio I/O. Neither pattern implies a dependency-free client.
A blocking API can also wrap an async runtime, as [Postgres][postgres] does;
that API shape alone does not remove Tokio.

These patterns support separate protocol and runtime packages. For this client,
process supervision, cancellation, and control-mode correlation also need
matching implementations and tests. Passing examples establish their tested
workloads; adoption still requires the full package and operational checks.

[blocking-branch]: https://github.com/libtmux/libtmux-rs/tree/c26bcbb5127352d80dd2a8e9527494f21baa5fd6
[shared-branch]: https://github.com/libtmux/libtmux-rs/tree/a45e1f82996bc96f88ebb8239ea017ea3a303e32
[blocking-capture]: https://github.com/libtmux/libtmux-rs/blob/c26bcbb5127352d80dd2a8e9527494f21baa5fd6/crates/libtmux/examples/api_capture.rs
[tokio-capture]: https://github.com/libtmux/libtmux-rs/blob/c26bcbb5127352d80dd2a8e9527494f21baa5fd6/crates/libtmux-tokio/examples/api_capture.rs
[blocking-examples]: https://github.com/libtmux/libtmux-rs/blob/c26bcbb5127352d80dd2a8e9527494f21baa5fd6/crates/libtmux/examples/api/README.md
[tokio-examples]: https://github.com/libtmux/libtmux-rs/blob/c26bcbb5127352d80dd2a8e9527494f21baa5fd6/crates/libtmux-tokio/examples/api/README.md
[package-contract]: https://github.com/libtmux/libtmux-rs/blob/c26bcbb5127352d80dd2a8e9527494f21baa5fd6/crates/libtmux/docs/packages.md
[quinn]: https://github.com/quinn-rs/quinn/blob/eaec0db4bcb698f76df736d89938743c88a2ad5f/quinn-proto/src/lib.rs
[tungstenite]: https://github.com/snapview/tokio-tungstenite/blob/6ee9b33f76d35f9cc7125c3c7511bce4b1e829c4/src/compat.rs
[postgres]: https://github.com/sfackler/rust-postgres/blob/e47a75e72af0a31c7e581f3ccf91e17063f3efc6/postgres/src/lib.rs

[blocking-pr]: https://github.com/libtmux/libtmux-rs/pull/66
[shared-pr]: https://github.com/libtmux/libtmux-rs/pull/82
