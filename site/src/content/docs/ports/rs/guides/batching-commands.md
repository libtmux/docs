---
port: rs
route: guides/batching-commands
title: Batch commands with a plan
description: Record Rust operations, compare planners, inspect outcomes, and retain ownership of partial changes.
sidebar:
  label: Batching commands
  group: Guides
  order: 7
tableOfContents: true
---

Use a [`Plan`](../../reference/plan-plan/) when you know the operations before
you run them. Recording a plan does not contact tmux. You can inspect its steps,
validate its dependencies, then select a planner for execution.

This program creates a window and sends two lines to its pane. It repeats that
work with three planners, verifies the captured lines, and then checks that a
refused command stops a later operation. Each run uses a different window name
on its own private server.

## Setup and run

Use an empty directory with Git, rustup with the 1.97.1 toolchain installed,
tmux 3.2a or newer, and a Unix environment. The program creates a private socket under `/tmp/libtmux-rs-dev`,
starts `cat` in its panes, and stops only the server it created. No existing
session, socket, or environment variable is required.

Save this file as `Cargo.toml`:

```toml title="Cargo.toml"
[package]
name = "libtmux-batching-example"
version = "0.0.0"
edition = "2024"
publish = false

[workspace]
exclude = ["libtmux-source"]

[dependencies]
libtmux = { path = "libtmux-source/crates/libtmux", default-features = false, features = ["plan"] }
tempfile = "=3.27.0"
tokio = { version = "=1.53.1", features = ["macros", "rt", "time"] }

[[bin]]
name = "batching"
path = "batching.rs"
```

Fetch the library revision used by the example:

```console
$ git clone https://github.com/libtmux/libtmux-rs libtmux-source &&
  git -C libtmux-source checkout e9be0b6f6d22cd2eb79b0ec08964f82e717e5fe4
```

Only the `plan` feature is enabled. `control-mode` is unnecessary for these
subprocess plans, and the program uses ordinary `Server` construction rather
than a testing fixture.

Save the complete program as `batching.rs`:

```rust title="batching.rs"
use std::error::Error;
use std::time::Duration;

use libtmux::plan::{NewWindow, Outcome, Plan, Planner, SendKeys};
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
    let session = server
        .new_session(NewSessionOptions::new("work").command("cat"))
        .await?;

    for (name, planner, expected) in [
        ("sequential", Planner::Sequential, 3),
        ("folding", Planner::Folding, 2),
        ("marked", Planner::Marked, 1),
    ] {
        let mut plan = Plan::new();
        let window = plan.add(
            NewWindow::new(session.id().clone())
                .name(name)
                .command("cat")
                .focus(),
        );
        plan.add(SendKeys::new(window.pane()).text("one").enter());
        plan.add(SendKeys::new(window.pane()).text("two").enter());
        plan.validate()?;

        let result = plan.run(server, planner).await?;
        if !result.is_complete() {
            return Err(format!("{name} did not complete: {:?}", result.operations()).into());
        }
        check(result.dispatches() == expected, "unexpected dispatch count")?;

        let windows = session.windows().await?;
        let created = windows
            .iter()
            .find(|window| window.name().as_bytes() == name.as_bytes())
            .ok_or("created window is missing")?;
        let panes = created.panes().await?;
        let pane = panes.first().ok_or("created window has no pane")?;
        loop {
            let lines = pane.capture().await?;
            if lines.iter().any(|line| line.as_bytes() == b"one")
                && lines.iter().any(|line| line.as_bytes() == b"two")
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        println!("{name}: {} dispatches; one, two", result.dispatches());
    }

    // Index zero is occupied by the session's original window.
    let mut refused = Plan::new();
    refused.add(NewWindow::new(session.id().clone()).index(0));
    refused.add(NewWindow::new(session.id().clone()).name("must-not-exist"));
    let result = refused.run(server, Planner::Sequential).await?;
    check(
        !result.is_complete(),
        "tmux should refuse the occupied index",
    )?;
    check(
        result.operations()[0].outcome() == Outcome::Failed
            && result.operations()[1].outcome() == Outcome::Skipped,
        "the failed and skipped operations were not distinguished",
    )?;
    check(
        session
            .windows()
            .await?
            .iter()
            .all(|window| window.name().as_bytes() != b"must-not-exist"),
        "the operation after the failure ran",
    )?;
    println!("refused plan: failed, skipped");
    Ok(())
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), ExampleError> {
    let root = std::path::Path::new("/tmp/libtmux-rs-dev");
    std::fs::create_dir_all(root)?;
    let directory = tempfile::Builder::new()
        .prefix("docs-batching-")
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
$ cargo +1.97.1 run --quiet --bin batching
```

Expected output:

```text
sequential: 3 dispatches; one, two
folding: 2 dispatches; one, two
marked: 1 dispatches; one, two
refused plan: failed, skipped
```

## References to newly created objects

`Plan::add(NewWindow::new(...))` returns a window slot, not a live `Window`.
Its `pane()` points to the first pane that operation will create. The later
`SendKeys` operations use that typed reference, so the program does not guess
an ID or query tmux between recording steps.

Slots belong to their creating plan and must refer to an earlier compatible
operation. [`validate()`](../../reference/plan-plan-validate/) checks those
relationships before execution. `run()` validates them again; a rejected
recording dispatches no recorded operation. Some version-sensitive preflight
checks may still query metadata.

## Choose the evidence you need

| Planner | Grouping | Failure evidence |
| --- | --- | --- |
| `Sequential` | One invocation per operation | Separate status for each dispatched operation |
| `Folding` | Compatible neighboring operations share an invocation | One status for a combined group |
| `Marked` | Also combines suitable focused creation with operations using its new pane | A returned created ID proves that creation; other failed group members may remain unknown |

The example focuses the new window deliberately: the marked planner can then
address the pane created by that step without another process. The three,
two, and one counts describe this specific three-operation plan.
[`dispatches()`](../../reference/plan-run-planresult/) excludes metadata and
preflight probes; it is not a count of every tmux process the application
starts. Setup, verification, and cleanup also issue commands.

Folding preserves the intended successful work. It reduces how precisely a
failed combined invocation can be attributed. Measure real workload latency
before selecting it for speed, and do not report a successful plan as proof
that a program inside a pane finished. This example separately waits for its
expected captured lines.

## Handle refusal and partial effects

[`PlanResult::is_complete()`](../../reference/plan-run-planresult-is_complete/)
is true only when every operation is known to have completed. A tmux refusal
is returned inside [`Ok(PlanResult)`](../../reference/plan-run-planresult/), so checking only the outer `Result` is
insufficient. `operations()` retains recording order.

| Outcome | What it establishes |
| --- | --- |
| `Complete` | tmux accepted the operation |
| `Failed` | The individually attributable operation was refused |
| `Skipped` | The operation was not dispatched or did not run after an earlier failure |
| `Unknown` | A failed combined invocation does not identify this member's outcome |

The final two operations deliberately try an occupied window index and then
create `must-not-exist`. Sequential execution identifies the first as `Failed`
and the second as `Skipped`; the program also verifies that no later window
appeared. A combined failure can instead produce `Unknown` members. Do not
silently treat unknown as success or infer that none of the group ran.

An invalid plan, unreachable tmux, or transport failure returns [`Err`](https://doc.rust-lang.org/std/result/enum.Result.html#variant.Err) rather
than a normal refusal report. Cancellation can leave dispatched operations
applied while losing the report. Inspect state before retrying; re-running a
plan runs the whole recording again and is not a rollback or resume operation.

## Cleanup and other routes

Each command has a five-second limit, and the workload has a ten-second
deadline. The program stops its owned daemon and closes its executor even if
a plan or assertion fails. A cleanup failure preserves the private directory
and reports its path.

Plans can also run through control mode when both features are enabled:
`run_over_control_mode(&sender)` sends recorded operations over that connection,
or `run(&routed, planner)` uses a server returned by `over_control_mode()`.
Blocking plan `Pause` operations are refused on a control connection before
recorded commands are sent. See [Control mode](../control-mode/) for connection
ownership and notification draining.

Source contracts: [Plan](https://github.com/libtmux/libtmux-rs/blob/e9be0b6f6d22cd2eb79b0ec08964f82e717e5fe4/crates/libtmux/src/plan.rs),
[planners](https://github.com/libtmux/libtmux-rs/blob/e9be0b6f6d22cd2eb79b0ec08964f82e717e5fe4/crates/libtmux/src/plan/planner.rs),
and [execution and outcomes](https://github.com/libtmux/libtmux-rs/blob/e9be0b6f6d22cd2eb79b0ec08964f82e717e5fe4/crates/libtmux/src/plan/run.rs)
at the displayed library revision.
