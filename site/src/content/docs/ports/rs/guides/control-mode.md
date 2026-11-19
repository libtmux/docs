---
port: rs
route: guides/control-mode
title: Send commands over control mode
description: Route typed Rust calls over a persistent tmux connection, drain notifications, and close it with explicit ownership.
sidebar:
  label: Control mode
  group: Guides
  order: 8
tableOfContents: true
---

Use [`ControlMode::attach`](../../reference/control-controlmode-attach/) to open
a persistent connection to an existing session. Use
[`Server::over_control_mode`](../../reference/server-server-over_control_mode/)
to obtain a handle whose typed commands use that connection. The original
server handle keeps its subprocess route.

This program creates its own session, sends a line through a routed pane,
checks captured output, and observes the attached client. It drains events
while waiting for command results, closes the connection, verifies that tmux
is still alive, and finally stops the tmux server it started.

## Setup and run

Use an empty directory with rustup, the 1.97.1 toolchain installed, tmux
3.7 or newer, and a Unix environment. Control mode needs tmux 3.7; older
releases refuse it. Cargo installs `libtmux` 0.1.2 from crates.io. The program creates a private socket in a temporary directory,
starts `cat` in its panes, and stops only the server it created. No existing
session, socket, or environment variable is required.

Save this file as `Cargo.toml`:

```toml title="Cargo.toml"
[package]
name = "libtmux-control-example"
version = "0.0.0"
edition = "2024"
publish = false

[dependencies]
libtmux = { version = "=0.1.2", default-features = false, features = ["control-mode"] }
tempfile = "=3.27.0"
tokio = { version = "=1.53.1", features = ["macros", "rt", "time"] }

[[bin]]
name = "control"
path = "control.rs"
```

Only the `control-mode` feature is enabled. It does not require [plan][plan-feature],
`query`, or `test-support`.

Save the complete program as `control.rs`:

```rust title="control.rs"
use std::error::Error;
use std::time::Duration;

use libtmux::control::ControlMode;
use libtmux::{NewSessionOptions, Server};

type ExampleError = Box<dyn Error>;

fn check(condition: bool, message: &str) -> Result<(), ExampleError> {
    if condition {
        Ok(())
    } else {
        Err(message.into())
    }
}

async fn demonstrate(server: &Server) -> Result<(), ExampleError> {
    let host = server
        .new_session(NewSessionOptions::new("work").command("cat"))
        .await?;
    let control = ControlMode::attach(server, host.id())
        .await?
        .reply_timeout(Duration::from_secs(3));
    let (sender, mut events) = control.split();

    let operation = async {
        let routed = server.over_control_mode(&sender).await?;
        let sessions = routed.sessions().await?;
        check(sessions.len() == 1, "expected one session")?;
        let panes = sessions[0].panes().await?;
        let pane = panes.first().ok_or("the session has no pane")?;
        pane.send_line("hello from control").await?;

        loop {
            let lines = pane.capture().await?;
            if lines
                .iter()
                .any(|line| line.as_bytes() == b"hello from control")
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        println!("captured: hello from control");

        // This original handle still uses subprocesses.
        check(
            server.clients().await?.len() == 1,
            "control client is missing",
        )?;
        println!("attached control clients: 1");
        Ok::<(), ExampleError>(())
    };

    // Drain notifications while commands wait for their replies.
    let outcome = tokio::select! {
        result = tokio::time::timeout(Duration::from_secs(10), operation) => {
            match result {
                Ok(result) => result,
                Err(error) => Err(Box::new(error) as ExampleError),
            }
        }
        error = async {
            loop {
                match events.next_event().await {
                    Some(Ok(_event)) => {}
                    Some(Err(error)) => break Box::new(error) as ExampleError,
                    None => break "control connection closed early".into(),
                }
            }
        } => Err(error),
    };

    let closed = events.shutdown().await;
    drop(sender);
    let mut failures = Vec::new();
    if let Err(error) = outcome {
        failures.push(format!("control operation: {error}"));
    }
    if let Err(error) = closed {
        failures.push(format!("control cleanup: {error}"));
    }
    if !failures.is_empty() {
        return Err(failures.join("; ").into());
    }

    server.check_alive().await?;
    check(
        server.clients().await?.is_empty(),
        "control client remained attached",
    )?;
    println!("connection closed; server still running");
    Ok(())
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), ExampleError> {
    let directory = tempfile::Builder::new()
        .prefix("docs-control-")
        .tempdir()?;
    let server = Server::builder()
        .socket_path(directory.path().join("tmux.sock"))
        .config_file("/dev/null")
        .default_timeout(Duration::from_secs(5))
        .build()?;
    let outcome = tokio::time::timeout(Duration::from_secs(20), demonstrate(&server)).await;

    // Stop the tmux server this program started, then release the client.
    let killed = server.kill().await;
    let closed = server.shutdown().await;
    let cleanup_failed = killed.is_err() || closed.is_err();
    let mut failures = Vec::new();
    match outcome {
        Ok(Ok(())) => {}
        Ok(Err(error)) => failures.push(format!("example failed: {error}")),
        Err(error) => failures.push(format!("example deadline: {error}")),
    }
    if let Err(error) = killed {
        failures.push(format!("could not stop tmux: {error}"));
    }
    if let Err(error) = closed {
        failures.push(format!("could not close the client: {error}"));
    }
    if cleanup_failed {
        let retained = directory.keep();
        failures.push(format!(
            "left the temporary directory at {}",
            retained.display()
        ));
    } else if let Err(error) = directory.close() {
        failures.push(format!("could not remove the directory: {error}"));
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; ").into())
    }
}
```

```console
$ cargo +1.97.1 run --quiet --bin control
```

Expected output:

```text
captured: hello from control
attached control clients: 1
connection closed; server still running
```

## Route the handles you use

`attach()` returns after the control client has attached. A successfully
started child process alone would not establish that the connection is ready.
The session must already exist; this program creates it through the ordinary
subprocess server first.

The routed `Server`, sessions it lists, and panes obtained from those sessions
all share the connection. An older `Session` or `Pane` from the original
server keeps its original route. Opening a control connection does not rewrite
all existing handles. The routing method checks that sender and server refer
to the same endpoint and can probe the tmux version during setup.

## Drain events while awaiting replies

`split()` separates a command sender from an event receiver. The program uses
[`tokio::select!`](https://docs.rs/tokio/1.53.1/tokio/macro.select.html) to keep polling [`next_event()`](../../reference/control-controlevents-next_event/)
while the command future runs. It discards ordinary notifications because its
task only needs command results, but it reports a terminal event error or
unexpected closure.

The event queue is bounded. Leaving an event receiver alive without consuming
it can stop the connection from reading tmux and prevent command progress.
Dropping the event receiver is an option when no notifications are needed;
retaining and draining it, as here, also gives explicit shutdown and terminal
error reporting.

For an observer application, handle the event variants your task needs.
Pane output is byte data, not necessarily UTF-8 or complete lines. A
notification stream does not by itself supply a prior screen snapshot; obtain
one explicitly when needed. `watch_only()` can narrow pane output, but muting
can affect tmux's reading of a pane's pseudo-terminal, so it is not merely a
local filter over received events.

## What a successful reply proves

Typed object methods interpret the command result for their documented task.
The lower-level [`ControlSender::send`](../../reference/control-controlsender-send/)
returns a `BlockResult`. A tmux `%error` block is a received result, not a
transport [`Err`](https://doc.rust-lang.org/std/result/enum.Result.html#variant.Err); inspect `succeeded()` before using its output.

A reply marks a command boundary, not arbitrary work completing inside a pane.
The example explicitly waits for the captured line. Use the original process
server for queue-blocking operations such as `wait-for` or foreground
`run-shell`, and for arguments containing bytes that the UTF-8 control
command protocol cannot represent.

## Timeouts and shutdown

The server's five-second default bounds subprocess commands and attaching.
The connected sender's three-second `reply_timeout` bounds an entire command
round trip, including time spent queued or writing. The program also gives
its routed operation ten seconds and its overall demonstration twenty seconds.
A timeout may follow a committed command; inspect state before retrying a
mutation.

[`ControlEvents::shutdown`](../../reference/control-controlevents-shutdown/)
stops the connection, drains unread notifications for cleanup, and reports an
undelivered terminal error. It succeeds while other sender handles still
exist. The program records both an operation error and any shutdown error,
then verifies the client detached without killing the daemon.

The outer cleanup kills this program's private server and releases the
client. An application connected to someone else's server should close its
clients and leave that server running. A failed cleanup here reports the
socket directory and leaves it in place.

See [Command transports](../../concepts/transports/) for the default process
route and [Batching commands](../batching-commands/) for recorded plans.
The [control connection contract](https://github.com/libtmux/libtmux-rs/blob/15cfa2b1845d9894c93d8025d8b83e75d756f073/crates/libtmux/src/control.rs)
and [typed routing contract](https://github.com/libtmux/libtmux-rs/blob/15cfa2b1845d9894c93d8025d8b83e75d756f073/crates/libtmux/src/server.rs)
describe the `libtmux` 0.1.2 source used by the program.

[plan-feature]: https://github.com/libtmux/libtmux-rs/blob/15cfa2b1845d9894c93d8025d8b83e75d756f073/crates/libtmux/Cargo.toml#L148
