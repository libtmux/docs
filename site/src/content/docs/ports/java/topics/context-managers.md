---
port: java
route: topics/context-managers
title: Ownership and cleanup
description: Scope-based cleanup for tmux objects, and when your program must kill them explicitly.
sidebar:
  label: Ownership and cleanup
  group: Topics
  order: 4
tableOfContents: true
---

A tmux session, window, or pane normally remains until you kill it. Scope-based
cleanup can kill it when your code leaves a block, including after an exception.
See [Workspaces](/concepts/workspaces/) for a temporary layout example.

<a id="java-server-is-closeable-but-closing-one-doesnt-kill-it"></a>

## Closing a server connection

Java's `Server` implements `AutoCloseable`. Exiting `try (Server server =
Server.open(config))` releases the owned transport while tmux and its sessions
remain running. Kill sessions, windows, panes, or the server explicitly when
your program owns their cleanup.

```java
ServerConfig config = ServerConfig.builder()
        .endpoint(ServerEndpoint.socketPath(socket))
        .build();

try (Server server = Server.open(config)) {
    Session session = server.newSession("demo");
    Window window = session.newWindow("build");
    Pane pane = window.split();

    pane.sendLine("echo hello from libtmux");
    // session, window, and pane all outlive this block: only the
    // connection this `server` handle held is released on the way out.
}
```

<a id="what-this-means-in-practice"></a>

## Testing cleanup

Use explicit cleanup for objects whose handles have no disposal hook. For an
entire disposable test server, prefer your port's test fixture or server guard;
see [Testing with libtmux](/guides/testing-with-libtmux/).
