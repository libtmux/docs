---
title: Rust MCP examples
description: List sessions through the Rust MCP server and inspect implementation examples.
port: rs
product: mcp
sidebar:
  label: Examples
  order: 3
---

Connect the server using the [setup guide](../guides/), then call
[`list_sessions`](../tools/list_sessions/) from your MCP client.

## List sessions

This is the `params` object for an MCP `tools/call` request. Send it
through the connected client:

```json
{
  "name": "list_sessions",
  "arguments": {}
}
```

Use the returned session IDs when choosing a window or pane. The
[tool reference](../tools/list_sessions/) describes this port's result
and optional arguments.

## Internals

The following examples are for applications that embed or extend the server.
Installing and connecting an MCP client does not require this code.

The crate includes a complete stdio server with its tier chosen in Rust
code. Use it when the offered surface is part of the embedding
application's policy.

### Embed a read-only surface

```rust file="crates/tmux-mcp/examples/readonly.rs"
```

The example waits until the transport ends. It selects libtmux's ambient
server, so choose the tmux environment before launching it. Application
code can instead construct a `Server` for its own endpoint.

### Run the source example

From the Rust repository with its toolchain and tmux installed:

```console
$ cargo run \
    -p tmux-mcp \
    --example readonly
```

The process speaks MCP on stdin and stdout. It writes the selected tool
count to stderr.

To inspect the default mutating tier's tools and output schemas without
starting a tmux server:

```console
$ cargo run \
    -p tmux-mcp \
    --example surface
```

The [readonly source](https://github.com/libtmux/libtmux-rs/blob/9331cdf556ea7a1f2589e9c3e6cece6ccdc7765c/crates/tmux-mcp/examples/readonly.rs)
and [surface source](https://github.com/libtmux/libtmux-rs/blob/9331cdf556ea7a1f2589e9c3e6cece6ccdc7765c/crates/tmux-mcp/examples/surface.rs)
are shipped crate examples. The crate's test suite also drives an isolated
real tmux server. Rendering this source is not an execution of the example.

See [Topics](../topics/) before using background jobs or destructive plans.
