---
port: rs
route: examples/capture-pane-output
title: Capture pane output
description: Run a complete program that captures a pane and waits for a complete output line.
sidebar:
  label: Capture pane output
  group: Examples
  order: 3
tableOfContents: true
---

A pane runs asynchronously: sending a command does not mean its output is
already on screen. Capture repeatedly until the expected line appears, with a
deadline so a failed command cannot leave the program waiting forever.

This complete program creates a private tmux server, captures its output, and
cleans up. Follow the [setup and run instructions](#setup-and-run) below. You need
tmux and Linux; no existing tmux session is required. Async operations use
`libtmux-tokio`, imported as `libtmux_tokio`.

## Read what's on screen

The program sends `printf` with a leading newline, then waits for the complete
line `libtmux capture ready`. The newline keeps a late shell prompt off that
line. Matching the whole line avoids mistaking the echoed command for its
output.

```rust title="src/main.rs"
use std::error::Error;
use std::time::Duration;

use libtmux_tokio::{NewSessionOptions, Server};
use tokio::time::{sleep, timeout};

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let root = std::path::Path::new("/tmp/libtmux-rs-dev");
    std::fs::create_dir_all(root)?;
    let directory = tempfile::Builder::new().prefix("capture-").tempdir_in(root)?;
    std::fs::write(directory.path().join("owner"), std::process::id().to_string())?;
    let server = Server::builder()
        .socket_path(directory.path().join("tmux.sock"))
        .config_file("/dev/null")
        .build()?;

    let captured = timeout(Duration::from_secs(5), async {
        let session = server
            .new_session(NewSessionOptions::new("capture").command("env ENV=/dev/null sh"))
            .await?;
        let panes = session.panes().await?;
        let pane = panes.first().ok_or("the session has no pane")?;
        pane.send_line("printf '\\nlibtmux capture ready\\n'").await?;
        loop {
            let lines = pane.capture().await?;
            if let Some(line) = lines
                .iter()
                .find(|line| line.as_bytes() == b"libtmux capture ready")
            {
                println!("{}", line.to_string_lossy());
                return Ok::<_, Box<dyn Error>>(());
            }
            sleep(Duration::from_millis(20)).await;
        }
    })
    .await;

    let killed = server.kill().await;
    let closed = server.shutdown().await;
    let cleanup_failed = killed.is_err() || closed.is_err();
    let mut failures = Vec::new();
    match captured {
        Ok(Ok(())) => {}
        Ok(Err(error)) => failures.push(format!("capture: {error}")),
        Err(error) => failures.push(format!("capture deadline: {error}")),
    }
    if let Err(error) = killed {
        failures.push(format!("daemon cleanup: {error}"));
    }
    if let Err(error) = closed {
        failures.push(format!("client cleanup: {error}"));
    }
    if cleanup_failed {
        let retained = directory.keep();
        failures.push(format!("inspect retained directory {}", retained.display()));
    } else if let Err(error) = directory.close() {
        failures.push(format!("directory cleanup: {error}"));
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; ").into())
    }
}
```

<a id="wait-for-text-instead-of-guessing-a-delay"></a>

## Wait for output or completion

The program above checks the captured screen for up to five seconds. The short
pause between checks limits polling; the observed output determines when the
loop
finishes. A tmux capture is a view of the screen and scrollback, so it can miss
output that has already scrolled away. Use a stream or a completion signal for
long-running commands when that distinction matters.

[Capturing output](/guides/capturing-output/) covers capture options, while
[Sending keys](/guides/sending-keys/#the-race-you-cant-see-from-the-call-site)
explains why sending and waiting are separate operations.

## Setup and run

Use an empty directory. The commands fetch the pinned library revision.

Save the program as `src/main.rs` and this file as `Cargo.toml`. Use the
repository's Rust 1.97.1 toolchain for this pinned revision.

```toml title="Cargo.toml"
[package]
name = "capture-example"
version = "0.1.0"
edition = "2024"

[dependencies]
libtmux-tokio = { path = "libtmux/crates/libtmux-tokio" }
tempfile = "3.27.0"
tokio = { version = "1.53.1", features = ["macros", "rt-multi-thread", "time"] }
```

```console
$ git init -q libtmux &&
  git -C libtmux fetch -q --depth=1 \
    https://github.com/libtmux/libtmux-rs.git c26bcbb5127352d80dd2a8e9527494f21baa5fd6 &&
  git -C libtmux checkout -q --detach FETCH_HEAD &&
  cargo +1.97.1 run
```

<a id="source-inclusion"></a>

## Where this comes from

The complete program and manifest above use the same source revision. It
reports operation and cleanup failures together and retains the socket
directory if cleanup fails.
