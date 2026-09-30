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
The program prints its name and leaves the tmux server running. It reports an
error if the connection fails or the session is absent.

This controls tmux from your program. To open a session in your terminal, use
`tmux attach-session`; the [shared guide](../../../../guides/attaching-to-tmux/) covers
interactive attachment and detaching.

<a id="which-socket-a-bare-constructor-reaches"></a>

## Connect to an existing server

Save the complete program as `src/main.rs`. `LIBTMUX_SOCKET_PATH` selects
the existing server. The launcher below supplies a private socket for trying
the example.

```rust title="src/main.rs"
use std::error::Error;
use std::time::Duration;

use libtmux::Server;
use tokio::time::timeout;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let socket = std::env::var("LIBTMUX_SOCKET_PATH")?;
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
        Ok::<_, Box<dyn Error>>(())
    })
    .await;
    let closed = server.shutdown().await;
    result??;
    closed?;
    Ok(())
}
```

## Setup and run

Use an empty directory on Linux with Git and tmux 3.2a or newer installed.

This example was checked with Rust 1.97.1.

Save this file beside the program using the displayed filename.

```toml title="Cargo.toml"
[package]
name = "connect-example"
version = "0.1.0"
edition = "2024"

[dependencies]
libtmux = { path = "libtmux/crates/libtmux" }
tokio = { version = "1.53.1", features = ["macros", "rt-multi-thread", "time"] }
```

Save the launcher as `run.sh`. It starts an isolated tmux server, runs the
program, checks that the session still exists, then stops only that server.
Cleanup runs after failures too. A failed shutdown keeps its socket directory
and prints its location for inspection.

```sh title="run.sh"
#!/bin/sh
set -eu

binary=$(command -v tmux)
directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-rs-attach.XXXXXX")
socket="$directory/tmux.sock"

cleanup() {
    status=$?
    trap - 0 HUP INT TERM
    if [ -S "$socket" ] && ! "$binary" -S "$socket" kill-server; then
        printf 'Cannot stop tmux; kept %s\n' "$directory" >&2
        exit 1
    fi
    rm -rf "$directory" || exit 1
    exit "$status"
}
trap cleanup 0
trap 'exit 1' HUP INT TERM

unset TMUX TMUX_PANE
export LIBTMUX_SOCKET_PATH="$socket" TMUX_BIN="$binary"
"$binary" -S "$socket" -f /dev/null new-session -d -s work /bin/cat
"$@"
"$binary" -S "$socket" has-session -t '=work'
```

Fetch the verified library revision, build, and run:

```console
$ git clone https://github.com/libtmux/libtmux-rs libtmux &&
  git -C libtmux checkout d4e08b4eaab62ef4eeedab79b47973ae9a1de310 &&
  sh run.sh cargo +1.97.1 run
```

The program prints `work`. To use an existing server of your own, set
`LIBTMUX_SOCKET_PATH` to its socket and run the program without the launcher.
That launcher is responsible for the demonstration server's lifetime.

<a id="finding-a-session-instead-of-always-creating-one"></a>

## Find or create a session

The example only looks up a session. If your application creates a session
after an unsuccessful lookup, another client may create the same name between
those operations. Handle the creation error instead of assuming the lookup
reserves the name.

For a complete program that starts and owns its server, see
[Capture pane output](/examples/capture-pane-output/). Continue with
[Sending keys](/guides/sending-keys/) once you have a pane handle.
