---
title: Rust workspace builder examples
description: Build, inspect, and capture a workspace on a private tmux server with Rust.
port: rs
product: workspace
aliases: [examples/workspace-from-file]
sidebar:
  group: Internals
  label: Examples
  order: 3
tableOfContents: true
---

Read a workspace file, create two windows and three panes, then capture the
session as YAML. The example stops its private server after success or failure.
The `/bin/cat` commands keep panes open without another application or log file.

## Prepare the project

Use Rust 1.97.1 and tmux 3.3a or newer. These commands use a Unix shell.
Cargo installs `libtmux` and `tmux-workspace` 0.1.2 from crates.io
([source](https://github.com/libtmux/libtmux-rs/tree/15cfa2b1845d9894c93d8025d8b83e75d756f073)).
Create an empty project:

```console
$ mkdir rust-workspace-example && cd rust-workspace-example && \
    mkdir src
```

Create the project manifest. The program starts a private
[`Server`](../../../reference/server-server/) on a socket in a temporary
directory; in an application, connect to the tmux server you manage instead.

```toml title="Cargo.toml"
[package]
name = "workspace-example"
version = "0.1.0"
edition = "2024"

[dependencies]
libtmux = "=0.1.2"
tmux-workspace = { version = "=0.1.2", default-features = false }
tempfile = "3.27.0"
tokio = { version = "=1.53.1", features = ["macros", "rt-multi-thread", "time"] }
```

Create the workspace file beside `Cargo.toml`:

```yaml title="workspace.yaml"
session_name: workspace-example
windows:
  - window_name: editor
    layout: even-horizontal
    panes: [/bin/cat, /bin/cat]
  - window_name: logs
    panes: [/bin/cat]
```

## Build and freeze

Create the complete program below. It reads and validates the file before
starting tmux, bounds workspace operations to 15 seconds, and explicitly
checks server shutdown even when an earlier operation fails.

```rust title="src/main.rs"
use std::error::Error;
use std::time::Duration;

use libtmux::Server;
use tmux_workspace::{Workspace, WorkspaceBuilder, freeze};
use tokio::time::timeout;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let source = std::fs::read_to_string("workspace.yaml")?;
    let workspace = Workspace::from_yaml(&source)?;
    let directory = tempfile::tempdir()?;
    let server = Server::builder()
        .socket_path(directory.path().join("tmux.sock"))
        .config_file("/dev/null")
        .build()?;
    let result = timeout(Duration::from_secs(15), async {
        let session = WorkspaceBuilder::new(&server)
            .build(&workspace)
            .await?;
        let windows = session.windows().await?;
        let panes = session.panes().await?;
        if windows.len() != 2 || panes.len() != 3 {
            return Err("expected two windows and three panes".into());
        }
        let captured = freeze(&session).await?;
        if Workspace::from_yaml(&captured.to_yaml())? != captured {
            return Err("captured workspace did not survive its YAML round trip".into());
        }
        println!("built: {} windows", windows.len());
        println!("panes: {}", panes.len());
        println!("captured workspace: YAML round trip passed");
        Ok::<_, Box<dyn Error>>(())
    })
    .await
    .map_err(|error| -> Box<dyn Error> { error.into() })
    .and_then(|result| result);

    // Stop the tmux server this program started, then release the client.
    let killed = server.kill().await;
    let closed = server.shutdown().await;
    let cleanup = killed.and(closed);
    match (result, cleanup) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) => Err(error),
        (Ok(()), Err(error)) => Err(error.into()),
        (Err(operation), Err(cleanup)) => {
            Err(format!("workspace failed: {operation}; cleanup failed: {cleanup}").into())
        }
    }
}
```

`build` returns after constructing the session and sending its pane commands.
Those commands may still be running. Check application output or another
readiness signal before depending on an application inside a pane.

`freeze` captures the current session structure and observed pane commands.
The YAML round trip checks that this captured value can be serialized and
parsed again. It cannot recover the original command arguments or guarantee
that the captured workspace recreates each application.

## Verification

Run the program from the project directory:

```console
$ cargo +1.97.1 run --quiet
```

Expected output:

```text
built: 2 windows
panes: 3
captured workspace: YAML round trip passed
```

The program removes its private server before returning. If an operation and
shutdown both fail, the error includes both failures. For a persistent
workspace, let your application retain an explicitly selected server and
choose its own shutdown point.

<a id="where-this-comes-from"></a>
<a id="source-inclusion"></a>

[Builder source](https://github.com/libtmux/libtmux-rs/blob/15cfa2b1845d9894c93d8025d8b83e75d756f073/crates/tmux-workspace/src/lib.rs);
[capture source](https://github.com/libtmux/libtmux-rs/blob/15cfa2b1845d9894c93d8025d8b83e75d756f073/crates/tmux-workspace/src/freeze.rs).
