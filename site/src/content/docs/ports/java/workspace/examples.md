---
title: "Java workspace examples"
description: "Inspect the session returned by the Java workspace builder."
port: java
product: workspace
sidebar:
  label: Examples
  order: 3
tableOfContents: true
---

The module README builds a session with two windows and verifies the returned
window and pane counts. The port's `docs-tests` project collects Java README
fences and runs them against real tmux.

## Build a described layout

Within an application that already has a `Server`, import `Workspace` and
`WorkspaceBuilder` from [`io.github.libtmux.workspace`](https://github.com/libtmux/libtmux-java/tree/4f057d367a25dee818d70876fa283fc503a3a7eb/libtmux-workspace/src/main/java/io/github/libtmux/workspace), and `Session` from
[`io.github.libtmux`](/reference/java/). This excerpt uses the same configuration as the module's
result example:

```java
Workspace workspace = WorkspaceBuilder.parse("""
        session_name: built
        windows:
          - window_name: editor
            layout: even-horizontal
            panes:
              - shell_command: echo one
              - shell_command: echo two
          - window_name: server
            panes:
              - echo three
        """);
Session session = WorkspaceBuilder.build(server, workspace);
System.out.println(session.windows().size());
System.out.println(session.windows().get(0).panes().size());
```

The output is two windows and two panes in the first window. Use the
[guide](../guides/) for the complete server setup and cleanup. The builder
creates a new session, so the requested name must be available.

## Verification

From a prepared source checkout, run the documentation example project:

```console
$ ./gradlew :docs-tests:test
```

The module README also exercises invalid layouts and creating a workspace
beside an existing unrelated session. Those checks cover configuration
behavior; they do not prove that arbitrary commands launched in a pane have
finished or become ready.

[Collected README examples](https://github.com/libtmux/libtmux-java/blob/4f057d367a25dee818d70876fa283fc503a3a7eb/libtmux-workspace/README.md)
