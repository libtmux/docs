---
title: "Use the Rust workspace builder"
description: "Use the in-development Rust workspace builder from application code."
port: rs
product: workspace
sidebar:
  group: Internals
  label: Guides
  order: 2
tableOfContents: true
---

Build a workspace by parsing its YAML and passing it to `WorkspaceBuilder`.
Install tmux first, then add the crate to a Rust project:

```console
$ cargo add tmux-workspace \
    --git https://github.com/libtmux/libtmux-rs \
    --rev c84ede6448c32bf72aae7126e16e04540d2009aa
```

The runnable [example](../examples/) also uses `libtmux-tokio`'s isolated test server.
Enable its `test-support` feature:

```console
$ cargo add libtmux-tokio \
    --git https://github.com/libtmux/libtmux-rs \
    --rev c84ede6448c32bf72aae7126e16e04540d2009aa \
    --features test-support
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

In an async application, read the file with [`std::fs::read_to_string`](https://doc.rust-lang.org/std/fs/fn.read_to_string.html), parse it
with `Workspace::from_yaml`, and construct `WorkspaceBuilder::new(&server)`
using your `libtmux_tokio::Server` handle. `build(&workspace).await` returns the
newly
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

[Crate usage and dependencies](https://github.com/libtmux/libtmux-rs/blob/c84ede6448c32bf72aae7126e16e04540d2009aa/crates/tmux-workspace/README.md)
