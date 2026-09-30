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

Use Rust 1.97.1, Git, and tmux 3.2a or newer. These commands use a Unix shell.
Create an empty project and fetch the source revision used by this example:

```console
$ mkdir rust-workspace-example && cd rust-workspace-example && \
    mkdir src
```

```console
$ git init libtmux-source && \
    git -C libtmux-source remote add origin https://github.com/libtmux/libtmux-rs.git && \
    git -C libtmux-source fetch --depth=1 origin d4e08b4eaab62ef4eeedab79b47973ae9a1de310 && \
    git -C libtmux-source checkout --detach FETCH_HEAD
```

Create the project manifest. Both library crates use that source tree. The
`test-support` feature provides the public `TestServer` helper, which creates
and owns the isolated server used by this example.

```toml title="Cargo.toml"
[package]
name = "workspace-example"
version = "0.1.0"
edition = "2024"

[dependencies]
libtmux = { path = "libtmux-source/crates/libtmux", features = ["test-support"] }
tmux-workspace = { path = "libtmux-source/crates/tmux-workspace", default-features = false }
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

use libtmux::test::TestServer;
use tmux_workspace::{Workspace, WorkspaceBuilder, freeze};
use tokio::time::timeout;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let source = std::fs::read_to_string("workspace.yaml")?;
    let workspace = Workspace::from_yaml(&source)?;
    let guard = TestServer::new().await?;
    let result = timeout(Duration::from_secs(15), async {
        let session = WorkspaceBuilder::new(guard.server())
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

    let cleanup = guard.shutdown().await;
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
$ cargo run --quiet
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

[Builder source](https://github.com/libtmux/libtmux-rs/blob/d4e08b4eaab62ef4eeedab79b47973ae9a1de310/crates/tmux-workspace/src/lib.rs);
[capture source](https://github.com/libtmux/libtmux-rs/blob/d4e08b4eaab62ef4eeedab79b47973ae9a1de310/crates/tmux-workspace/src/freeze.rs).
