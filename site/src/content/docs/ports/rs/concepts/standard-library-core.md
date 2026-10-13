---
port: rs
route: concepts/standard-library-core
title: Try a standard-library core and Tokio adapter
description: >-
  Run an offline tmux request builder and a live Tokio client using the same
  dependency-free core.
sidebar:
  label: 'Standard-library core experiment'
  group: Concepts
  order: 4
tableOfContents: true
noindex: true
---

This [runnable prototype][prototype] splits pane values and capture requests
into a dependency-free core, with live handles in a separate Tokio package.
It supports pane listing and capture. It is an experiment, not a replacement
for the published client.

| Package | What belongs there |
| --- | --- |
| `libtmux` | Pane IDs, detached snapshots, capture requests, and captured bytes. No dependencies. |
| `libtmux-tokio` | Concrete server and pane handles, plus asynchronous execution. |

## Run it without Tokio

Check out the experiment branch:

```console
$ git clone --branch standard-library-core https://github.com/libtmux/libtmux-rs.git
```

Enter its standalone Cargo workspace:

```console
$ cd libtmux-rs/experiments/standard-library-core
```

Build a capture request and decode captured bytes without starting tmux:

```console
$ cargo run --locked -p split-demo --bin offline
```

The [offline program][offline] uses only the core. Its dependency graph is
small enough to inspect directly:

```console
$ cargo tree --locked -p split-demo
```

## Capture a live pane

With tmux 3.2a or newer on `PATH`, enable the adapter:

```console
$ cargo run --locked -p split-demo --features live --bin live
```

The [live program][live] starts an isolated server, prints a message in a pane,
then captures it through the Tokio adapter. It also reads a detached snapshot
after shutting down the runtime. It kills its own server and removes its
socket under `/tmp/libtmux-rs-dev/` when finished.

Set `LIBTMUX_TEST_TMUX` to choose a different tmux executable. Both programs
print human-readable output to stdout, report errors to stderr, and exit zero
on success or one on failure.

The [offline consumer][offline] builds a capture request synchronously. The
[live consumer][live] passes that same core type to the adapter and receives
captured bytes. Both links contain complete programs. Server and pane handles
have concrete types; a runtime type parameter does not spread through the API.

## What the experiment decides

A strict core can own useful values and requests while the adapter owns I/O.
The core has no optional, build, target, or test dependencies either. The
workspace's [check script][checks] verifies the dependency graph and runs both
programs:

```console
$ bash check.sh
```

The adapter bounds each output pipe to 2 MiB and gives each command five
seconds. It handles direct child processes only. A full migration must retain
the published client's supervision, cancellation, process-group cleanup, and
control-mode behaviour; this small adapter does not establish that parity.

[Quinn][quinn] and [Tokio Tungstenite][tungstenite] show how protocol logic and
runtime adapters can live in separate packages. Their cores still have
external dependencies. Zero dependencies is a stronger requirement: regex
matching would need a companion package, and Serde would need wrappers or wire
types for core values because of Rust's [orphan rules][orphan]. Those
integrations remain outside this prototype.

[prototype]: https://github.com/libtmux/libtmux-rs/tree/d7541fbace16d6a45882cd0af0ea6880f9c21748/experiments/standard-library-core
[offline]: https://github.com/libtmux/libtmux-rs/blob/d7541fbace16d6a45882cd0af0ea6880f9c21748/experiments/standard-library-core/demo/src/offline.rs
[live]: https://github.com/libtmux/libtmux-rs/blob/d7541fbace16d6a45882cd0af0ea6880f9c21748/experiments/standard-library-core/demo/src/live.rs
[checks]: https://github.com/libtmux/libtmux-rs/blob/d7541fbace16d6a45882cd0af0ea6880f9c21748/experiments/standard-library-core/check.sh
[quinn]: https://github.com/quinn-rs/quinn/tree/eaec0db4bcb698f76df736d89938743c88a2ad5f/quinn-proto
[tungstenite]: https://github.com/snapview/tokio-tungstenite/tree/6ee9b33f76d35f9cc7125c3c7511bce4b1e829c4
[orphan]: https://doc.rust-lang.org/error_codes/E0117.html
