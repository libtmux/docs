---
title: List sessions through MCP
description: Connect a Rust MCP client to an inspection server and read structured session metadata.
port: rs
product: mcp
sidebar:
  group: Examples
  order: 10
---

This program connects an `rmcp` client to an embedded `tmux-mcp` server.
It discovers the tools, calls [list_sessions](../../tools/list_sessions/),
and reads the session names from structured content.

It creates a private tmux server with two sessions running `cat`, then stops
that server before exiting. The socket lives in a temporary directory under
`/tmp/libtmux-rs-dev/`; the program does not select a server from your shell's
`TMUX` variable or load your tmux configuration.

## Run the example

Use Git, Rust 1.97.1, and tmux 3.2a or newer on Linux or macOS. Both libtmux
crates below use the source revision documented by the MCP reference.
The example was run on Linux with tmux 3.2a and 3.7c.

Create a directory for the program:

```console
$ mkdir inspect-mcp-sessions
```

```console
$ cd inspect-mcp-sessions
```

```console
$ mkdir src
```

Save this as `Cargo.toml`:

```toml title="Cargo.toml"
[package]
name = "inspect-mcp-sessions"
version = "0.1.0"
edition = "2024"
publish = false

[dependencies]
rmcp = { version = "=3.1.2", features = ["client", "server", "transport-io"] }
serde_json = "=1.0.151"
tempfile = "=3.27.0"

[dependencies.libtmux]
git = "https://github.com/libtmux/libtmux-rs"
rev = "a6fc2a65674177b92b17fa380757155d2ba150fd"

[dependencies.tmux-mcp]
git = "https://github.com/libtmux/libtmux-rs"
rev = "a6fc2a65674177b92b17fa380757155d2ba150fd"

[dependencies.tokio]
version = "=1.53.1"
features = ["io-util", "macros", "net", "rt-multi-thread", "time"]
```

Save this as `src/main.rs`:

```rust title="src/main.rs"
use std::error::Error;
use std::io::ErrorKind;
use std::path::Path;
use std::time::Duration;

use libtmux::{NewSessionOptions, Server};
use rmcp::model::CallToolRequestParams;
use rmcp::service::QuitReason;
use rmcp::{Peer, RoleClient, ServiceExt as _};
use tmux_mcp::{Selection, TmuxTools};
use tokio::time::timeout;

type ExampleError = Box<dyn Error + Send + Sync>;

fn check(condition: bool, message: &str) -> Result<(), ExampleError> {
    if condition {
        Ok(())
    } else {
        Err(message.into())
    }
}

async fn inspect(client: &Peer<RoleClient>) -> Result<(), ExampleError> {
    let offered = client.list_all_tools().await?;
    check(
        offered.iter().any(|tool| tool.name == "list_sessions"),
        "list_sessions was not offered",
    )?;
    check(
        !offered.iter().any(|tool| tool.name == "send_keys"),
        "send_keys was offered by the inspection server",
    )?;

    let request = CallToolRequestParams::new("list_sessions")
        .with_arguments(Default::default());
    let result = client.call_tool(request).await?;
    if result.is_error == Some(true) {
        let body = serde_json::to_string(&result)?;
        return Err(format!("list_sessions failed: {body}").into());
    }
    let data = result
        .structured_content
        .ok_or("list_sessions returned no structured content")?;
    let sessions = data["sessions"]
        .as_array()
        .ok_or("structured content has no sessions array")?;
    let mut names = Vec::new();
    for session in sessions {
        names.push(session["name"].as_str().ok_or("session has no name")?);
        check(
            session["id"].as_str().is_some_and(|id| id.starts_with('$')),
            "session has no tmux ID",
        )?;
    }
    names.sort_unstable();
    check(names == ["build", "editor"], "unexpected session list")?;
    for name in names {
        println!("session: {name}");
    }
    Ok(())
}

fn record_close(
    label: &str,
    result: Result<Option<QuitReason>, tokio::task::JoinError>,
    failures: &mut Vec<String>,
) {
    match result {
        Ok(Some(QuitReason::Cancelled | QuitReason::Closed)) => {}
        Ok(Some(reason)) => failures.push(format!("{label}: {reason:?}")),
        Ok(None) => {
            failures.push(format!("{label}: cleanup deadline exceeded"))
        }
        Err(error) => failures.push(format!("{label}: {error}")),
    }
}

async fn exchange(server: &Server) -> Result<(), ExampleError> {
    let tools = TmuxTools::builder(server.clone())
        .caller(None)
        .selection(Selection::parse(Some("inspect"), None, None)?)
        .build();
    let (client_io, server_io) = tokio::io::duplex(1 << 20);
    let startup = async {
        tokio::try_join!(
            async { ().serve(client_io).await.map_err(ExampleError::from) },
            async { tools.serve(server_io).await.map_err(ExampleError::from) },
        )
    };
    let started = timeout(Duration::from_secs(5), startup).await??;
    let (mut client, mut service) = started;
    let inspection = inspect(client.peer());
    let outcome = timeout(Duration::from_secs(10), inspection).await;

    let mut failures = Vec::new();
    match outcome {
        Ok(Ok(())) => {}
        Ok(Err(error)) => failures.push(format!("MCP request: {error}")),
        Err(error) => failures.push(format!("MCP request deadline: {error}")),
    }
    record_close(
        "MCP client cleanup",
        client.close_with_timeout(Duration::from_secs(5)).await,
        &mut failures,
    );
    record_close(
        "MCP server cleanup",
        service.close_with_timeout(Duration::from_secs(5)).await,
        &mut failures,
    );
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; ").into())
    }
}

async fn demonstrate(server: &Server) -> Result<(), ExampleError> {
    for name in ["build", "editor"] {
        server
            .new_session(NewSessionOptions::new(name).command("cat"))
            .await?;
    }
    exchange(server).await
}

async fn wait_until_stopped(socket: &Path) -> Result<(), ExampleError> {
    loop {
        match tokio::net::UnixStream::connect(socket).await {
            Ok(_) => tokio::time::sleep(Duration::from_millis(20)).await,
            Err(error)
                if matches!(
                    error.kind(),
                    ErrorKind::NotFound | ErrorKind::ConnectionRefused
                ) =>
            {
                return Ok(());
            }
            Err(error) => return Err(error.into()),
        }
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), ExampleError> {
    let root = std::path::Path::new("/tmp/libtmux-rs-dev");
    std::fs::create_dir_all(root)?;
    let directory = tempfile::Builder::new()
        .prefix("mcp-sessions-")
        .tempdir_in(root)?;
    std::fs::write(
        directory.path().join("owner"),
        std::process::id().to_string(),
    )?;
    let socket = directory.path().join("tmux.sock");
    let server = Server::builder()
        .socket_path(&socket)
        .config_file("/dev/null")
        .default_timeout(Duration::from_secs(5))
        .build()?;
    eprintln!("owned socket: {}", socket.display());
    let outcome = demonstrate(&server).await;

    // Stop the owned daemon before closing its command executor.
    let killed = server.kill().await;
    let stopping = wait_until_stopped(&socket);
    let stopped = timeout(Duration::from_secs(5), stopping).await;
    let closed = timeout(Duration::from_secs(5), server.shutdown()).await;
    let cleanup_failed = killed.is_err()
        || !matches!(&stopped, Ok(Ok(())))
        || !matches!(&closed, Ok(Ok(())));
    let mut failures = Vec::new();
    if let Err(error) = outcome {
        failures.push(format!("example: {error}"));
    }
    if let Err(error) = killed {
        failures.push(format!("daemon cleanup: {error}"));
    }
    match stopped {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            failures.push(format!("daemon stop verification: {error}"))
        }
        Err(error) => {
            failures.push(format!("daemon stop verification deadline: {error}"))
        }
    }
    match closed {
        Ok(Ok(())) => {}
        Ok(Err(error)) => failures.push(format!("executor cleanup: {error}")),
        Err(error) => {
            failures.push(format!("executor cleanup deadline: {error}"))
        }
    }
    if cleanup_failed {
        let retained = directory.keep();
        let kept = retained.display();
        failures.push(format!("inspect retained directory {kept}"));
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

Resolve the dependencies, then run the program:

```console
$ cargo +1.97.1 generate-lockfile
```

```console
$ cargo +1.97.1 run --locked --quiet
```

Keep `Cargo.lock` with the program to retain the resolved transitive versions.
The program prints the private socket path to stderr. Its stdout is:

```text
session: build
session: editor
```

## Read the result

The two protocol endpoints exchange JSON-RPC over an in-memory byte stream.
They perform the MCP handshake and tool discovery before the call. The
server offers `inspect`; the program checks that discovery contains
`list_sessions` and excludes `send_keys`.

A completed protocol request can still report a tool failure. The program
checks `isError` before reading `structuredContent`, then verifies the
returned names and tmux IDs. It reads metadata; it does not capture pane
output or send input through MCP.

The embedded server receives its selection in code. The
[client connection guide](../../guides/connect-client/) covers a separate
MCP process launched from a client's configuration, and
[Tool selection](../../topics/tool-selection/) explains the available groups.

## Shutdown

Handshake and request waits have deadlines. The program closes both MCP
endpoints after a successful or failed request, then stops its owned tmux
daemon, waits for its Unix socket to close, and shuts down the libtmux command
executor. It reports operation and cleanup failures together.

If daemon or executor cleanup fails, or the socket still accepts connections
at the deadline, it retains the temporary directory and prints its path for
inspection. The program exits with an error.
