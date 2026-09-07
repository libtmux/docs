---
title: "Build a Rust workspace"
description: "Install tmux-workspace and create a session with its async builder."
port: rs
product: workspace
sidebar:
  label: Guides
  order: 2
tableOfContents: true
---

Build a workspace by parsing its YAML and passing it to `WorkspaceBuilder`.
Install tmux first, then add the crate to a Rust project:

```console
$ cargo add tmux-workspace@0.1.0-alpha.9
```

The runnable [example](../examples/) also uses libtmux's isolated test server.
Enable its `test-support` feature:

```console
$ cargo add libtmux@0.1.0-alpha.9 --features test-support
```

Add the Tokio runtime used by the example:

```console
$ cargo add tokio --features macros,rt-multi-thread
```

## Describe the session

Save this description as `dev.yaml`:

```yaml
session_name: dev
windows:
  - window_name: editor
    panes: [/bin/sh, /bin/sh]
```

In an async application, read the file with `std::fs::read_to_string`, parse it
with `Workspace::from_yaml`, and construct `WorkspaceBuilder::new(&server)`
using your libtmux server handle. `build(&workspace).await` returns the newly
created session.

## Preview before creating

Call `plan(&workspace)` on the builder before execution. Iterate over the
plan's `preview()` if you need to show the commands to an operator. Planning
itself does not test current session-name availability or execute commands.

If the requested session already exists, choose another name or explicitly
remove a session you own. Do not treat the error as a request to adopt it.
After a partial build failure, inspect the server before retrying.

## Save a live layout

Use `freeze(&session).await` to produce a new `Workspace`, then write its
`to_yaml()` output to a file. Review the resulting command descriptions before
loading the file later. [Topics](../topics/) explains what the export can
recover.

[Crate usage and dependencies](https://github.com/libtmux/libtmux-rs/blob/9331cdf556ea7a1f2589e9c3e6cece6ccdc7765c/crates/tmux-workspace/README.md)
