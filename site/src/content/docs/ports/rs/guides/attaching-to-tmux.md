---
port: rs
route: guides/attaching-to-tmux
title: Attaching to tmux
description: Connect to an existing tmux server and find a session with Rust.
sidebar:
  label: Attaching to tmux
  group: Guides
  order: 3
tableOfContents: true
---

Connect a `Server` to an explicit socket and find the existing `work` session.
The program prints its name and leaves that server running. It reports an
error if the connection fails or the session is absent.

This controls tmux from your program. To open a session in your terminal, use
`tmux attach-session`; the [shared guide](../../../../tmux/guides/attaching-to-tmux/) covers
interactive attachment and detaching.

<a id="which-socket-a-bare-constructor-reaches"></a>

## Connect to an existing server

Save the complete program as `src/main.rs`. `LIBTMUX_SOCKET_PATH` selects the
existing server: `find_work` connects a new `Server` to that socket, prints the
`work` session and leaves the tmux server running.

Without the variable, the program starts a demonstration server to stand in
for yours. `demonstrate` creates a `work` session on a socket in a new
temporary directory, then stops that server and removes the directory, even if
the lookup fails. If tmux does not stop, the program keeps the directory and
prints its location.

```rust title="src/main.rs" role="program"
use std::error::Error;
use std::path::PathBuf;
use std::time::Duration;

use libtmux::{NewSessionOptions, Server};
use tokio::time::timeout;

type Failure = Box<dyn Error>;

#[tokio::main]
async fn main() -> Result<(), Failure> {
    match std::env::var_os("LIBTMUX_SOCKET_PATH") {
        Some(socket) => find_work(socket.into()).await,
        None => demonstrate().await,
    }
}

async fn find_work(socket: PathBuf) -> Result<(), Failure> {
    let server = Server::builder().socket_path(socket).build()?;
    let result = timeout(Duration::from_secs(5), async {
        let sessions = server.sessions().await?;
        if !sessions
            .iter()
            .any(|session| session.name().as_bytes() == b"work")
        {
            return Err("The work session does not exist".into());
        }
        println!("work");
        Ok::<_, Failure>(())
    })
    .await;
    let closed = server.shutdown().await;
    result??;
    closed?;
    Ok(())
}

async fn demonstrate() -> Result<(), Failure> {
    let directory = tempfile::tempdir()?;
    let socket = directory.path().join("tmux.sock");
    let owner = Server::builder()
        .socket_path(&socket)
        .config_file("/dev/null")
        .build()?;
    let found = async {
        let options = NewSessionOptions::new("work").command("cat");
        timeout(Duration::from_secs(5), owner.new_session(options)).await??;
        find_work(socket).await
    }
    .await;
    if let Err(error) = owner.kill().await.and(owner.shutdown().await) {
        let kept = directory.keep();
        eprintln!("Cannot stop tmux; kept {}", kept.display());
        found?;
        return Err(error.into());
    }
    found
}
```

## Setup and run

Use an empty directory on Linux with tmux 3.3a or newer installed. Cargo
installs `libtmux` 0.1.2 from crates.io ([source](https://github.com/libtmux/libtmux-rs/tree/15cfa2b1845d9894c93d8025d8b83e75d756f073/crates/libtmux)).

This example was checked with Rust 1.97.1.

Save this file beside the program using the displayed filename.

```toml title="Cargo.toml"
[package]
name = "connect-example"
version = "0.1.0"
edition = "2024"

[dependencies]
libtmux = "=0.1.2"
tempfile = "3.27.0"
tokio = { version = "1.53.1", features = ["macros", "rt-multi-thread", "time"] }
```

Build and run:

```console
$ cargo +1.97.1 run
```

The program prints `work`. To attach to a server of your own, set
`LIBTMUX_SOCKET_PATH` to its socket path in the environment of `cargo run`. The
program then starts no server and leaves yours running.

<a id="finding-a-session-instead-of-always-creating-one"></a>

## Find or create a session

The example only looks up a session. If your application creates a session
after an unsuccessful lookup, another client may create the same name between
those operations. Handle the creation error instead of assuming the lookup
reserves the name.

For a program that sends input and captures output, see
[Capture pane output](/examples/capture-pane-output/). Continue with
[Sending keys](/guides/sending-keys/) once you have a pane handle.
