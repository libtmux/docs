---
port: rs
route: concepts/transports
title: Subprocesses, plans, and control mode
description: Choose how Rust commands reach tmux and understand completion, failures, cancellation, and connection ownership.
sidebar:
  label: Command transports
  group: Concepts
  order: 3
tableOfContents: true
---

Ordinary [`Server`](../../reference/server-server/) calls use tmux subprocesses.
No optional Cargo feature is required for that route. Add `plan` to record and
group commands, or `control-mode` to use a persistent connection for commands
and notifications.

<a id="where-each-port-draws-the-line"></a>
<a id="what-this-costs-in-practice"></a>

## Available transports

| Your task | Rust API | Cargo feature |
| --- | --- | --- |
| List objects, create a session, send keys, or capture a pane | Ordinary `Server`, `Session`, `Window`, and `Pane` methods | None |
| Send a known command sequence in one invocation | `Server::chain(CommandChain)` | None |
| Describe operations, validate dependencies, and choose how to group them | `Plan` with `Planner::Sequential`, `Folding`, or `Marked` | `plan` |
| Attach a persistent command and event connection | `ControlMode::attach` | `control-mode` |
| Route typed object methods through that connection | `Server::over_control_mode` | `control-mode` |

Choose based on whether your application needs occasional command results,
a known batch of changes, or an ongoing connection. Start with ordinary calls
unless another route solves a measured problem. Fewer process starts alone do
not establish an end-to-end latency improvement.

<a id="sending-a-command"></a>

## Ordinary calls and command results

A `Server` is a handle to a tmux endpoint. Constructing it does not start a
daemon; creating the first session does. A typed call can dispatch more than
one command, for example to read the state of an object it just created.
Do not equate one Rust method call with exactly one subprocess.

Typed operations report their documented failures through `Result`. The lower
level [`Server::cmd`](../../reference/server-server-cmd/) instead returns a
[`CommandResult`](../../reference/command-commandresult/): reaching tmux and
tmux accepting the command are separate outcomes. Check `success()` or the
exit status before treating its output as a successful operation.

The complete program below lists its session, then asks whether a missing
session exists. `cmd()` returns [`Ok`](https://doc.rust-lang.org/std/result/enum.Result.html#variant.Ok) with an unsuccessful command result for
the refused `has-session`; a missing executable, timeout, or capture failure
would return [`Err`](https://doc.rust-lang.org/std/result/enum.Result.html#variant.Err) instead.

## Setup and run

Use an empty directory with Git, rustup with the 1.97.1 toolchain installed,
tmux 3.2a or newer, and a Unix environment. The program creates a private socket under `/tmp/libtmux-rs-dev`,
starts `cat` in its panes, and stops only the server it created. No existing
session, socket, or environment variable is required.

Save this file as `Cargo.toml`:

```toml title="Cargo.toml"
[package]
name = "libtmux-subprocess-example"
version = "0.0.0"
edition = "2024"
publish = false

[workspace]
exclude = ["libtmux-source"]

[dependencies]
libtmux = { path = "libtmux-source/crates/libtmux", default-features = false }
tempfile = "=3.27.0"
tokio = { version = "=1.53.1", features = ["macros", "rt", "time"] }

[[bin]]
name = "subprocess"
path = "subprocess.rs"
```

Fetch the library revision used by the example:

```console
$ git clone https://github.com/libtmux/libtmux-rs libtmux-source &&
  git -C libtmux-source checkout e9be0b6f6d22cd2eb79b0ec08964f82e717e5fe4
```

This dependency disables all default features to show that subprocess calls
do not depend on `query`, `plan`, or `control-mode`.

Save the complete program as `subprocess.rs`:

```rust title="subprocess.rs"
use std::error::Error;
use std::time::Duration;

use libtmux::{Command, NewSessionOptions, Server};

type ExampleError = Box<dyn Error>;

async fn demonstrate(server: &Server) -> Result<(), ExampleError> {
    server
        .new_session(NewSessionOptions::new("work").command("cat"))
        .await?;

    let sessions = server.sessions().await?;
    if sessions.len() != 1 || sessions[0].name().as_bytes() != b"work" {
        return Err("expected only the work session".into());
    }
    println!("sessions: work");

    // Transport success and a successful tmux command are separate results.
    let missing = server
        .cmd(Command::new("has-session").arg("-t").arg("missing"))
        .await?;
    if missing.success() {
        return Err("the missing session unexpectedly exists".into());
    }
    println!("missing session: tmux refused the command");
    Ok(())
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), ExampleError> {
    let root = std::path::Path::new("/tmp/libtmux-rs-dev");
    std::fs::create_dir_all(root)?;
    let directory = tempfile::Builder::new()
        .prefix("docs-subprocess-")
        .tempdir_in(root)?;
    std::fs::write(
        directory.path().join("owner"),
        std::process::id().to_string(),
    )?;
    let server = Server::builder()
        .socket_path(directory.path().join("tmux.sock"))
        .config_file("/dev/null")
        .default_timeout(Duration::from_secs(5))
        .build()?;
    let outcome = tokio::time::timeout(Duration::from_secs(10), demonstrate(&server)).await;

    // Stop the owned daemon before closing the client executor.
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
        failures.push(format!("daemon cleanup: {error}"));
    }
    if let Err(error) = closed {
        failures.push(format!("executor cleanup: {error}"));
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

```console
$ cargo +1.97.1 run --quiet --bin subprocess
```

Expected output:

```text
sessions: work
missing session: tmux refused the command
```

<a id="why-fold-several-commands-into-one-invocation"></a>

## Group a known sequence

[`Server::chain`](../../reference/server-server-chain/) sends a `CommandChain`
as one invocation. It gives the group one exit status and merged output. tmux
stops at the first refused command; it does not undo earlier commands.

A [`Plan`](../../reference/plan-plan/) adds recorded operations, typed references
to objects created earlier in the plan, validation, and per-operation reports.
The planner can retain separate invocations or combine compatible neighbors.
A failed combined invocation may leave individual outcomes `Unknown`.
[`Ok(PlanResult)`](../../reference/plan-run-planresult/) therefore does not mean every operation succeeded.

[Batch commands with a plan](../../guides/batching-commands/) runs one workload
with each planner, checks the resulting pane output, and handles a refused
operation. It explains which counts and failure details the result can prove.

<a id="a-control-client-is-a-real-client"></a>

## Notifications and commands are separable

Attaching [`ControlMode`](../../reference/control-controlmode/) opens another
real tmux client. It appears in `list-clients` and affects attachment counts,
client hooks, and options such as `destroy-unattached`.

The original `Server` continues to use subprocesses. Calling
[`over_control_mode()`](../../reference/server-server-over_control_mode/) returns
another handle; typed objects obtained through that handle inherit its route.
The sender must address the same endpoint. Setup may probe the tmux version
through the process route; later routed calls use the connection.

[Send commands over control mode](../../guides/control-mode/) provides a
complete program that sends input, captures output, drains notifications, and
closes the connection while keeping the daemon alive until final cleanup.

## Deadlines, partial effects, and cleanup

`ServerBuilder::default_timeout` bounds ordinary subprocess commands and the
opening control handshake. A connected sender has its own
[`reply_timeout`](../../reference/control-controlsender-reply_timeout/), initially
copied from that server limit. The control guide sets it explicitly.

A timeout or cancelled future does not roll back an accepted mutation. Inspect
the server before repeating a creation or another operation that is unsafe to
run twice. A plan can be partly applied, and dropping its future also loses the
returned report of which steps completed.

[`Server::shutdown`](../../reference/server-server-shutdown/) closes the client
executor and its connections; it does not kill the daemon. Use
[`Server::kill`](../../reference/server-server-kill/) only when your application
owns that daemon. The example bounds each command to five seconds and its work
to ten seconds, then attempts both daemon and executor cleanup. A cleanup
failure reports and retains the private directory for inspection.

<a id="choosing-a-lane"></a>

## Read the implementation contract

These examples use the public APIs at
[`libtmux@0.1.0-alpha.15`](https://github.com/libtmux/libtmux-rs/tree/e9be0b6f6d22cd2eb79b0ec08964f82e717e5fe4).
The pinned [Server contract](https://github.com/libtmux/libtmux-rs/blob/e9be0b6f6d22cd2eb79b0ec08964f82e717e5fe4/crates/libtmux/src/server.rs)
describes command outcomes, shutdown, and routing. The guides above explain
plans and persistent connections as separate application workflows.
