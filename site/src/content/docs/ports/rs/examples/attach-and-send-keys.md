---
port: rs
route: examples/attach-and-send-keys
title: Attach and send keys
description: Get a session handle, send a command to a pane, and capture output.
sidebar:
  label: Attach and send keys
  group: Examples
  order: 2
tableOfContents: true
---

Get a session handle, send a command to a pane, and capture output. These
examples use libtmux from your program; to attach your terminal interactively,
see [Attaching to tmux](/guides/attaching-to-tmux/).

The program creates a private tmux server with its own socket, so it never
touches a server you already run. It stops that server before it exits. [Setup
and run](#setup-and-run) lists what to install.

```rust title="src/main.rs"
use std::error::Error;
use std::time::Duration;

use libtmux::{
    NewSessionOptions, NewWindowOptions, PaneWait, Server, SplitDirection,
    SplitOptions,
};
use tokio::time::timeout;

// Each pane runs a plain shell with no startup file.
const SHELL: &str = "env ENV=/dev/null sh";

async fn demonstrate(server: &Server) -> Result<(), Box<dyn Error>> {
    let session = server
        .new_session(NewSessionOptions::new("scratch").command(SHELL))
        .await?;
    println!("session {} created", session.id());

    let window = session
        .new_window(NewWindowOptions::new("work").command(SHELL))
        .await?;
    println!("window {} running sh", window.id());

    let below = SplitOptions::new(SplitDirection::Below).command(SHELL);
    window.split(below).await?;
    println!("split it: {} panes", window.panes().await?.len());

    let pane = window
        .active_pane()
        .await?
        .ok_or("the window has no active pane")?;
    println!("typing into {}", pane.id());

    // The format string keeps the echoed command from matching the wait.
    pane.send_line("printf 'hello from %s\\n' tmux").await?;

    // A wait that reached its deadline still returns successfully, so check
    // the outcome instead of assuming the text arrived.
    let deadline = Duration::from_secs(5);
    let seen = pane.wait_for_text("hello from tmux", deadline).await?;
    if seen != PaneWait::Arrived {
        return Err(format!("the pane did not print it: {seen:?}").into());
    }
    println!("the pane printed it");

    for line in pane.capture().await? {
        if !line.as_bytes().is_empty() {
            println!("| {}", line.to_string_lossy());
        }
    }
    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let directory = tempfile::tempdir()?;
    let server = Server::builder()
        .socket_path(directory.path().join("tmux.sock"))
        .config_file("/dev/null")
        .build()?;

    let outcome = timeout(Duration::from_secs(15), demonstrate(&server)).await;

    // Stop the tmux server this program started, then release the client.
    let killed = server.kill().await;
    let closed = server.shutdown().await;
    outcome??;
    killed?;
    closed?;
    Ok(())
}
```

## Finding an existing session instead

For a script that runs repeatedly, look up a session before creating it.
[Attaching to
tmux](/guides/attaching-to-tmux/#finding-a-session-instead-of-always-creating-one)
shows that pattern, and [Filtering and querying, in
practice](/guides/querying-and-filtering/) covers absent and ambiguous matches.

## Setup and run

Use an empty directory with tmux 3.3a or newer. Cargo installs `libtmux`
0.1.2 from crates.io. The program was run with Rust 1.97.1.

Save the program as `src/main.rs` and this file as `Cargo.toml`:

```toml title="Cargo.toml"
[package]
name = "attach-example"
version = "0.1.0"
edition = "2024"

[dependencies]
libtmux = "=0.1.2"
tempfile = "3.27.0"
tokio = { version = "1.53.1", features = ["macros", "rt-multi-thread", "time"] }
```

```console
$ cargo +1.97.1 run
```

<a id="source-inclusion"></a>

## Where this comes from

This program uses `libtmux` 0.1.2 from crates.io. Its source is on
[GitHub](https://github.com/libtmux/libtmux-rs/tree/15cfa2b1845d9894c93d8025d8b83e75d756f073/crates/libtmux).
