---
port: rs
route: concepts/server-session-window-pane
title: Server, session, window, pane
description: How tmux servers, sessions, windows, panes and attached clients relate to each other.
sidebar:
  label: Server, session, window, pane
  group: Concepts
  order: 2
tableOfContents: true
---

libtmux models tmux's server, session, window, and pane objects:

```
Server
├── Session
│   └── Window
│       └── Pane
└── Client (attached view)
```

A [`Server`](../../reference/libtmux_tokio-server-server/) contains sessions. Each [`Session`](../../reference/libtmux_tokio-session-session/) contains links to windows, and each
[`Window`](../../reference/libtmux_tokio-window-window/) contains panes. Commands run inside a [`Pane`](../../reference/libtmux_tokio-pane-pane/), where you send input and
capture output. A window can be linked to more than one session.

Both `libtmux` and `libtmux_tokio` expose this hierarchy. `libtmux` performs
blocking I/O; `libtmux_tokio` provides the async handles used below. Choose the
package when constructing your server; the two handle types are distinct.
See [Standard-library core](../standard-library-core/) for complete examples
of both clients.

## Stable identity, not name or index

tmux assigns a unique ID to each session, window, and pane at creation. The ID
remains stable for that object's lifetime even if its name or index changes:

| Object | ID prefix | Example |
|--------|-----------|---------|
| Session | `$` | `$13` |
| Window | `@` | `@3243` |
| Pane | `%` | `%5433` |
| Server | - | identified by socket name or path instead |

Use stable IDs to identify the same tmux object across reads. Names and indexes
can change while a program is running.

Read the hierarchy:

```rust
// Three tmux commands total, not one per object: walking down would cost a
// command per session and per window.
for branch in server.hierarchy().await? {
    let session = &branch.session;
    println!("{session} {} ({} windows)",
        session.name().to_string_lossy(), session.window_count());

    for built in &branch.windows {
        let window = &built.window;
        println!("  {window} {}", window.name().to_string_lossy());

        for pane in &built.panes {
            println!("    {pane}");
        }
    }
}
```

## Client: a view, not a child

A [`Client`](../../reference/libtmux_tokio-client-client/) represents a terminal attached to a session. Several clients can view
the same server, and each can switch sessions or windows independently. Client
fields describe the view at the time of the read.

A [control-mode connection](../transports/) is also a client. It appears in
`list-clients`, counts toward `session_attached`, and affects
attachment-dependent behavior such as `destroy-unattached`. Closing the last
attached client can therefore destroy a session configured with that option.
