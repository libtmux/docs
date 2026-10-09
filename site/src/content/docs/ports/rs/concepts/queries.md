---
port: rs
route: concepts/queries
title: Filtering and queries
description: Filter captured Rust objects, handle missing and ambiguous results, and refresh snapshots when tmux changes.
sidebar:
  label: Filtering and queries
  group: Concepts
  order: 4
tableOfContents: true
---

Read sessions, windows, or panes once, then filter their captured values in Rust.
[`matching()`](../../reference/query-queryiteratorext-matching/) evaluates a typed
predicate locally; it does not ask tmux for another listing. Use
[`exactly_one()`](../../reference/query-queryiteratorext-exactly_one/) when the
next operation needs one unambiguous target.

## Setup and run

Use an empty directory with Git, rustup with the 1.97.1 toolchain installed,
tmux 3.2a or newer, and a Unix environment. Each program below creates its own private server, uses `cat` to
keep its panes alive, and stops that server before exiting. No existing session,
socket, or environment variable is required.

Save this file as `Cargo.toml`, then save the three programs below beside it.
Each has its own entry point and can run independently.

```toml title="Cargo.toml"
[package]
name = "libtmux-query-examples"
version = "0.0.0"
edition = "2024"
publish = false

[workspace]
exclude = ["libtmux-source"]

[dependencies]
libtmux = { path = "libtmux-source/crates/libtmux" }
tempfile = "=3.27.0"
tokio = { version = "=1.53.1", features = ["macros", "rt", "time"] }

[[bin]]
name = "matching"
path = "matching.rs"

[[bin]]
name = "cardinality"
path = "cardinality.rs"

[[bin]]
name = "refresh"
path = "refresh.rs"
```

Fetch the library revision used by these programs:

```console
$ git clone https://github.com/libtmux/libtmux-rs libtmux-source &&
  git -C libtmux-source checkout e9be0b6f6d22cd2eb79b0ec08964f82e717e5fe4
```

The `query` feature is enabled by default. If your application disables default
features, enable `query` explicitly. These examples do not need `derive`,
`serde`, or `test-support`. `derive` adds typed fields for your own data, while
`serde` adds the versioned query-document format.

Each tmux command has a five-second limit, and the main operation has a
ten-second deadline. Cleanup still runs after an operation fails. A cleanup
failure reports the private directory and retains it for inspection instead of
hiding the error or removing the address of a possibly running server.

<a id="go-rust-java-c-typed-fields-that-fail-queries-at-compile-time"></a>
<a id="typed-and-local-filters"></a>

## Match names and combine conditions

Import [`Filterable`](../../reference/query-filterable/) to call
`Session::filter_fields()` or `Pane::filter_fields()`. The returned fields
construct [`FilterExpr`](../../reference/query-filterexpr/) values. Text fields
support text operations; boolean fields support boolean equality and membership.
A boolean field has no string-prefix or numeric-comparison operation.

Text matching is case sensitive unless the method ends in `_ignore_case`.
Compose expressions with `and`, `or`, and `not`. Use ordinary [`Iterator::filter`](https://doc.rust-lang.org/std/iter/trait.Iterator.html#method.filter)
for a local closure, such as a condition that uses other application state.

| Need | Text-field operation |
| --- | --- |
| An exact name | `eq("prod-api")` |
| Part of a name | `contains("api")` |
| A prefix or suffix | `starts_with("prod-")`, `ends_with("api")` |
| Case-insensitive equality | `eq_ignore_case("PROD-API")` |
| Membership in known names | `is_in(["prod-api", "dev-api"])` |
| A regular expression | `regex("^prod-")` |

The program creates `prod-api` and `dev-api`. It combines a prefix and suffix,
checks OR and case-insensitive matching, compares a native closure, and then
filters panes by their boolean `pane_active` field. That flag describes the
active pane in each window, so both one-pane windows have a match.

```rust title="matching.rs"
//! Filter native snapshots with typed field expressions.

use std::error::Error;
use std::time::Duration;

use libtmux::query::{Filterable as _, QueryIteratorExt as _};
use libtmux::{NewSessionOptions, Pane, Server, Session};

type ExampleError = Box<dyn Error>;

fn check(condition: bool, message: &str) -> Result<(), ExampleError> {
    if condition {
        Ok(())
    } else {
        Err(message.into())
    }
}

async fn demonstrate(server: &Server) -> Result<(), ExampleError> {
    server
        .new_session(NewSessionOptions::new("prod-api").command("cat"))
        .await?;
    server
        .new_session(NewSessionOptions::new("dev-api").command("cat"))
        .await?;
    let sessions = server.sessions().await?;
    let fields = Session::filter_fields();
    let production = fields
        .session_name
        .starts_with("prod-")
        .and(fields.session_name.ends_with("api"));
    let selected = sessions.iter().matching(&production).exactly_one()?;
    check(
        selected.name().as_bytes() == b"prod-api",
        "wrong filtered session",
    )?;
    check(sessions.len() == 2, "filtering changed the source snapshot")?;
    let either = fields
        .session_name
        .eq("prod-api")
        .or(fields.session_name.eq("dev-api"));
    check(
        sessions.iter().matching(&either).count() == 2,
        "OR did not select both sessions",
    )?;
    let insensitive = fields.session_name.eq_ignore_case("PROD-API");
    check(
        sessions.iter().matching(&insensitive).count() == 1,
        "case-insensitive equality did not match",
    )?;
    let native = sessions
        .iter()
        .filter(|session| session.name().as_bytes().starts_with(b"prod-"));
    check(native.count() == 1, "native predicate disagreed")?;
    let regex = fields.session_name.regex("^prod-")?;
    check(
        sessions.iter().matching(&regex).count() == 1,
        "regex did not match",
    )?;
    check(
        fields.session_name.regex("(").is_err(),
        "invalid regex was accepted",
    )?;
    println!("query: {}", selected.name().to_string_lossy());

    let panes = server.panes().await?;
    let pane_fields = Pane::filter_fields();
    let active = pane_fields.pane_active.eq(true);
    let count = panes.iter().matching(&active).count();
    check(count == 2, "expected one active pane per window")?;
    println!("active panes: {count}");
    Ok(())
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), ExampleError> {
    let root = std::path::Path::new("/tmp/libtmux-rs-dev");
    std::fs::create_dir_all(root)?;
    let directory = tempfile::Builder::new()
        .prefix("api-query-")
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
$ cargo +1.97.1 run --quiet --bin matching
```

Expected output:

```text
query: prod-api
active panes: 2
```

A regex is validated when the expression is constructed. `regex("(")` returns
an error; the program checks that refusal. Rust regex syntax excludes lookaround
and backreferences. Text predicates require valid UTF-8 in the candidate;
invalid bytes do not match a text predicate, although an outer `not` can invert
that result. Use `TmuxText::as_bytes()` when your own predicate must inspect raw
bytes without a lossy conversion.

Calling [`matching()`](../../reference/query-queryiteratorext-matching/)
on a slice iterator borrows the source collection and yields references in
its original order. It is lazy: consume it with a count, collection, or result
helper. It neither changes the captured objects nor eagerly creates another
vector. Use `into_iter().matching_owned(...)` when selected values should move
out of the original collection.

<a id="the-cardinality-contract-side-by-side"></a>
<a id="result-counts"></a>

## Handle zero, one, and several results

Choose the result contract before sending input or deleting an object. Taking
[`next()`](https://doc.rust-lang.org/std/iter/trait.Iterator.html#tymethod.next) would silently accept the first match in an ambiguous collection.

| Matches | `exactly_one()` | `one_or_none()` |
| --- | --- | --- |
| None | `Err(ExactlyOneError::NoItems)` | [`Ok(None)`](https://doc.rust-lang.org/std/result/enum.Result.html#variant.Ok) |
| One | [`Ok(item)`](https://doc.rust-lang.org/std/result/enum.Result.html#variant.Ok) | [`Ok(Some(item))`](https://doc.rust-lang.org/std/result/enum.Result.html#variant.Ok) |
| Several | `Err(ExactlyOneError::MultipleItems)` | [`Err(MultipleItemsError)`](../../reference/query-multipleitemserror/) |

Both helpers preserve the iterator's item type and pull at most two items.
With a [slice iterator](https://doc.rust-lang.org/std/primitive.slice.html#method.iter),
a successful lookup returns a borrowed object. Neither helper issues tmux
commands or refreshes a stale snapshot.

This independent program checks all three result counts. The missing optional
session is a normal [`None`](https://doc.rust-lang.org/std/option/enum.Option.html#variant.None); multiple sessions still produce an error.

```rust title="cardinality.rs"
//! Distinguish no match, one match and multiple matches.

use std::error::Error;
use std::time::Duration;

use libtmux::query::{ExactlyOneError, Filterable as _, MultipleItemsError, QueryIteratorExt as _};
use libtmux::{NewSessionOptions, Server, Session};

type ExampleError = Box<dyn Error>;

fn check(condition: bool, message: &str) -> Result<(), ExampleError> {
    if condition {
        Ok(())
    } else {
        Err(message.into())
    }
}

async fn demonstrate(server: &Server) -> Result<(), ExampleError> {
    server
        .new_session(NewSessionOptions::new("work").command("cat"))
        .await?;
    server
        .new_session(NewSessionOptions::new("review").command("cat"))
        .await?;
    let sessions = server.sessions().await?;
    let fields = Session::filter_fields();
    let work = fields.session_name.eq("work");
    let missing = fields.session_name.eq("missing");
    check(
        sessions
            .iter()
            .matching(&work)
            .exactly_one()?
            .name()
            .as_bytes()
            == b"work",
        "wrong single match",
    )?;
    check(
        sessions.iter().matching(&missing).one_or_none()?.is_none(),
        "missing match was present",
    )?;
    check(
        matches!(
            sessions.iter().matching(&missing).exactly_one(),
            Err(ExactlyOneError::NoItems)
        ),
        "missing match did not report NoItems",
    )?;
    check(
        matches!(
            sessions.iter().exactly_one(),
            Err(ExactlyOneError::MultipleItems)
        ),
        "ambiguous match was accepted",
    )?;
    check(
        matches!(sessions.iter().one_or_none(), Err(MultipleItemsError)),
        "optional lookup accepted multiple matches",
    )?;
    println!("cardinality: none, one, multiple");
    Ok(())
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), ExampleError> {
    let root = std::path::Path::new("/tmp/libtmux-rs-dev");
    std::fs::create_dir_all(root)?;
    let directory = tempfile::Builder::new()
        .prefix("api-cardinality-")
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
$ cargo +1.97.1 run --quiet --bin cardinality
```

Expected output:

```text
cardinality: none, one, multiple
```

Propagate the error with `?` when absence or ambiguity should stop your task.
Match [`ExactlyOneError`](../../reference/query-exactlyoneerror/) when the two
failure cases need different application behavior. An optional lookup only
relaxes the absent-result case; it does not choose between several candidates.

## Refresh captured state

A listing captures values at the time it runs. Renaming a session refreshes the
handle used for the rename, but another handle obtained earlier keeps its old
snapshot. A local filter over that earlier collection still sees the old name.

[`refreshed()`](../../reference/session-session-refreshed/) returns a new handle
with current values and preserves the original. Use
[`refresh()`](../../reference/session-session-refresh/) with a mutable handle to
replace its values in place. Both can fail if the session disappeared or its
listing could not be read.

The program selects `work`, renames it through another handle, and compares the
captured name with a refreshed copy and a new server-wide listing.

```rust title="refresh.rs"
//! Refresh captured values without replacing the original snapshot.

use std::error::Error;
use std::time::Duration;

use libtmux::query::{Filterable as _, QueryIteratorExt as _};
use libtmux::{NewSessionOptions, Server, Session};

type ExampleError = Box<dyn Error>;

fn check(condition: bool, message: &str) -> Result<(), ExampleError> {
    if condition {
        Ok(())
    } else {
        Err(message.into())
    }
}

async fn demonstrate(server: &Server) -> Result<(), ExampleError> {
    let mut session = server
        .new_session(NewSessionOptions::new("work").command("cat"))
        .await?;
    let captured = server.sessions().await?;
    let fields = Session::filter_fields();
    let old_name = fields.session_name.eq("work");
    let selected = captured.iter().matching(&old_name).exactly_one()?;

    session.rename("renamed").await?;
    check(
        session.name().as_bytes() == b"renamed",
        "rename did not refresh its receiver",
    )?;
    check(
        selected.name().as_bytes() == b"work",
        "captured handle changed itself",
    )?;
    check(
        captured.iter().matching(&old_name).count() == 1,
        "snapshot query became live",
    )?;

    let fresh = selected.refreshed().await?;
    check(
        fresh.id() == selected.id(),
        "refresh changed the session identity",
    )?;
    check(
        fresh.name().as_bytes() == b"renamed",
        "refresh retained the old name",
    )?;
    check(
        selected.name().as_bytes() == b"work",
        "refreshed changed its original",
    )?;
    println!(
        "snapshot: {} -> {}",
        selected.name().to_string_lossy(),
        fresh.name().to_string_lossy()
    );

    let current = server.sessions().await?;
    check(
        current.iter().matching(&old_name).count() == 0,
        "fresh listing kept the old name",
    )?;
    println!(
        "fresh listing: {}",
        current.iter().exactly_one()?.name().to_string_lossy()
    );
    Ok(())
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), ExampleError> {
    let root = std::path::Path::new("/tmp/libtmux-rs-dev");
    std::fs::create_dir_all(root)?;
    let directory = tempfile::Builder::new()
        .prefix("query-refresh-")
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
$ cargo +1.97.1 run --quiet --bin refresh
```

Expected output:

```text
snapshot: work -> renamed
fresh listing: renamed
```

A filter result is not a reservation on the tmux object. The session can change
or disappear between the listing and a later operation; handle that operation's
error even after a successful lookup. Use a fresh listing when you need a new
set of objects, or refresh a selected handle when you need its current fields.

## Keep local queries separate from tmux commands

Typed query expressions describe captured data. They do not turn into tmux
format filters, subscribe to changes, or fetch related objects. Relation
predicates inspect only relations already loaded in the candidate: an empty
collection makes `any` false and `all` and `none` true; an absent to-one relation
makes `is` false.

Use [object listings](../server-session-window-pane/) to obtain the data your
workflow needs, and [command transports](../transports/) to choose how later
operations reach tmux. A serialized query remains a local expression; enabling
`serde` does not make it a remote tmux query.

The [query module](https://github.com/libtmux/libtmux-rs/blob/e9be0b6/crates/libtmux/src/query.rs)
and [session refresh methods](https://github.com/libtmux/libtmux-rs/blob/e9be0b6/crates/libtmux/src/session.rs)
record these contracts for the library revision used above.
