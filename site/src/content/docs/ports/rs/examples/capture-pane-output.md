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
tmux and a Unix environment; no existing tmux session is required.

## Read what's on screen

The program sends `printf` with a leading newline, then waits for the complete
line `libtmux capture ready`. The newline keeps a late shell prompt off that
line. Matching the whole line avoids mistaking the echoed command for its output.

```rust title="main.rs"
use std::error::Error;
use std::time::Duration;

use libtmux::{NewSessionOptions, Server};
use tokio::time::{sleep, timeout};

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let directory = tempfile::tempdir()?;
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
    captured??;
    killed?;
    closed?;
    Ok(())
}
```

<a id="wait-for-text-instead-of-guessing-a-delay"></a>

## Wait for output or completion

The program above checks the captured screen for up to five seconds. The short
pause between checks limits polling; the observed output determines when the loop
finishes. A tmux capture is a view of the screen and scrollback, so it can miss
output that has already scrolled away. Use a stream or a completion signal for
long-running commands when that distinction matters.

[Capturing output](/guides/capturing-output/) covers capture options, while
[Sending keys](/guides/sending-keys/#the-race-you-cant-see-from-the-call-site)
explains why sending and waiting are separate operations.

## Setup and run

Use an empty directory. The commands pin the library
revision used to verify the program.

Save the program as `src/main.rs` and this file as `Cargo.toml`. Use the
repository's Rust 1.97.1 toolchain for this pinned revision.

```toml title="Cargo.toml"
[package]
name = "capture-example"
version = "0.1.0"
edition = "2024"

[dependencies]
libtmux = { path = "libtmux/crates/libtmux" }
tempfile = "3.27.0"
tokio = { version = "1.53.1", features = ["macros", "rt-multi-thread", "time"] }
```

```console
$ git clone https://github.com/libtmux/libtmux-rs libtmux &&
  git -C libtmux checkout d4e08b4eaab62ef4eeedab79b47973ae9a1de310 &&
  cargo +1.97.1 run
```

<a id="source-inclusion"></a>

## Where this comes from

This complete program was run against the library revision pinned above.
The displayed code is checked against the bytes from that run.
