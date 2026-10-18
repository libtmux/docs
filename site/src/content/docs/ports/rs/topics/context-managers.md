---
port: rs
route: topics/context-managers
title: Ownership and cleanup
description: Scope-based cleanup for tmux objects, and when your program must kill them explicitly.
sidebar:
  label: Ownership and cleanup
  group: Topics
  order: 4
tableOfContents: true
---

A tmux session, window, or pane normally remains until you kill it. Scope-based
cleanup can kill it when your code leaves a block, including after an exception.
See [Workspaces](/concepts/workspaces/) for a temporary layout example.

<a id="rust-no-async-drop-so-cleanup-is-explicit-or-best-effort"></a>

## Explicit asynchronous cleanup

The async `libtmux_tokio` handles require explicit shutdown when you need to
observe cleanup failures. Rust's synchronous `Drop` cannot await a tmux kill:

- **`kill(self)` consumes the handle.** Session, window, and pane kill methods
  take `self` by value, preventing subsequent use of that handle.
- **`libtmux_tokio::test::TestServer` provides a test guard.** Call
  [`TestServer.shutdown`](../../reference/libtmux_tokio-test-testserver-shutdown/) to handle cleanup errors. Its `Drop` implementation
  makes a synchronous cleanup attempt.

```rust
use libtmux_tokio::test::TestServer;

let guard = TestServer::new().await?;
let server = guard.server();

let session = server.new_session("work").await?;
session.new_window("editor").await?;

// Await shutdown to handle cleanup errors.
guard.shutdown().await?;
```

<a id="what-this-means-in-practice"></a>

## Testing cleanup

Use explicit cleanup for objects whose handles have no disposal hook. For an
entire disposable test server, prefer your port's test fixture or server guard;
see [Testing with libtmux](/guides/testing-with-libtmux/).
