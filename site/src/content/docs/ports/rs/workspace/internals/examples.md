---
title: "Rust workspace builder examples"
description: "Internal examples for building and inspecting workspaces through the Rust API."
port: rs
product: workspace
sidebar:
  group: Internals
  label: Examples
  order: 3
tableOfContents: true
---

This example builds a workspace on libtmux's isolated test server, captures
its structure, and shuts the server down. It follows the crate's README
examples, which are included in the crate's documentation tests.

## Build and freeze

Use `tmux-workspace`, a matching `libtmux` with its `test-support` feature,
and Tokio with `macros` and `rt-multi-thread`. The test-support feature exposes
`TestServer`; tmux must be available on the host.

```rust
use libtmux::test::TestServer;
use tmux_workspace::{freeze, Workspace, WorkspaceBuilder};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let workspace = Workspace::from_yaml(
        "session_name: dev
windows:
  - window_name: editor
    panes: [/bin/sh, /bin/sh]
",
    )?;
    let guard = TestServer::new().await?;
    let session = WorkspaceBuilder::new(guard.server())
        .build(&workspace)
        .await?;
    assert_eq!(session.windows().await?.len(), 1);

    let captured = freeze(&session).await?;
    assert_eq!(Workspace::from_yaml(&captured.to_yaml())?, captured);
    guard.shutdown().await?;
    Ok(())
}
```

The round trip checks serialization of the captured workspace. It does not
assert that freezing reproduced the commands in the original YAML.

## Verification

The crate includes its README with `include_str!`, so its Rust examples are
collected as documentation tests. In a prepared source checkout, run:

```console
$ cargo test -p tmux-workspace --doc
```

This page combines the README's build and freeze calls. Run the page example
when changing its sequence as well as the upstream documentation tests.

[Build and freeze examples](https://github.com/libtmux/libtmux-rs/blob/9331cdf556ea7a1f2589e9c3e6cece6ccdc7765c/crates/tmux-workspace/README.md)
